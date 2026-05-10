"use strict";
// BD Baseball deterministic show generator.
//
// Pure functions only. No DOM, no fetch, no clocks — every output is a function
// of (snapshot, options). Exposes the same surface to:
//   - browsers via window.BDShowGenerator
//   - Node tests via module.exports
//
// Design: the generator turns a verified MLB snapshot into a timed rundown of
// segments and a spoken host/teleprompter script. The producer picks a preset
// length and (optionally) which configured teams to feature; the generator
// allocates segment durations, pulls relevant verified notes, and emits copy.

const PRESETS = {
  quick: { label: "15-min Quick Hit", totalMinutes: 15 },
  standard: { label: "25-min Standard Show", totalMinutes: 25 },
  deep: { label: "35-min Deep Show", totalMinutes: 35 },
};

const TEAM_DISPLAY = {
  athletics: "Athletics",
  rockies: "Colorado Rockies",
  tigers: "Detroit Tigers",
};

// Segment time allocation per preset, in minutes.
// Sums equal totalMinutes; team segment is per team and replicated.
// `bdBets` is conditionally inserted before the closer when picks exist; if
// the feed is absent the segment is skipped and the rundown still hits its
// preset target.
const SEGMENT_BUDGETS = {
  quick: {
    opener: 1,
    league: 3,
    slate: 3,
    transactions: 2,
    teamEach: 2,
    bdBets: 1,
    closer: 1,
  },
  standard: {
    opener: 2,
    league: 4,
    slate: 5,
    transactions: 3,
    teamEach: 3,
    bdBets: 2,
    closer: 2,
  },
  deep: {
    opener: 2,
    league: 6,
    slate: 8,
    transactions: 4,
    teamEach: 4,
    bdBets: 3,
    closer: 3,
  },
};

function teamLabel(key) {
  return TEAM_DISPLAY[key] || (typeof key === "string" ? key.charAt(0).toUpperCase() + key.slice(1) : "Team");
}

// Strip the "Standings: " / "Probable: " prefix the snapshot writes so the
// host copy reads naturally instead of like a CSV dump.
function stripPrefix(s) {
  if (typeof s !== "string") return "";
  return s.replace(/^Standings:\s*/i, "")
          .replace(/^Probable:\s*/i, "")
          .replace(/^League tx:\s*\d{4}-\d{2}-\d{2}:\s*/i, "")
          .replace(/^[A-Za-z .']+ tx:\s*\d{4}-\d{2}-\d{2}:\s*/i, "");
}

function isProbable(note) { return typeof note === "string" && /^Probable:/i.test(note); }
function isStandings(note) { return typeof note === "string" && /^Standings:/i.test(note); }
function isTx(note) { return typeof note === "string" && /tx:\s*\d{4}-\d{2}-\d{2}:/i.test(note); }

// Sort standings by win pct descending, parsed from "PCT .NNN".
function rankStandings(notes) {
  const pctRe = /PCT\s+\.(\d+)/;
  return notes.slice().sort((a, b) => {
    const ma = pctRe.exec(a); const mb = pctRe.exec(b);
    const va = ma ? parseInt(ma[1], 10) : -1;
    const vb = mb ? parseInt(mb[1], 10) : -1;
    return vb - va;
  });
}

function partitionLeagueNotes(verified) {
  const list = Array.isArray(verified) ? verified : [];
  return {
    standings: list.filter(isStandings),
    probables: list.filter(isProbable),
    other: list.filter((n) => !isStandings(n) && !isProbable(n) && !isTx(n)),
  };
}

// Pick the strongest opener hook. Priority: top of standings story > marquee
// matchup > a configured team in the slate today > generic.
function buildOpener(snapshot, opts) {
  // The opener is the lead of the show — drive it from the storyline stack
  // so today's strongest baseball angle leads, not whatever happened to be
  // first in the standings array.
  const stack = buildShowStack(snapshot, { teams: (opts && opts.teams) || [], limit: 4 });
  const lines = [];
  const lead = stack[0];
  if (!lead || lead.kind === "empty") {
    lines.push("We're working from the verified MLB snapshot this morning, but the slate is quiet — quick check-in coming up.");
    return lines;
  }
  lines.push(lead.headline + ".");
  if (lead.detail) lines.push(lead.detail);
  // Add up to two more storyline tease lines so the opener has texture.
  for (let i = 1; i < stack.length && lines.length < 4; i++) {
    const s = stack[i];
    if (s.kind === "empty" || s.kind === "bd_bets") continue;
    lines.push("Also today — " + s.headline + ".");
  }
  return lines;
}

function buildLeagueSegment(snapshot) {
  const league = (snapshot && snapshot.league) || {};
  const parts = partitionLeagueNotes(league.verified_notes);
  const ranked = rankStandings(parts.standings).slice(0, 5);
  const lines = [];
  if (ranked.length) {
    lines.push("Quick standings check.");
    ranked.forEach((s) => lines.push(stripPrefix(s) + "."));
  } else {
    lines.push("No verified standings rows in this snapshot.");
  }
  return lines;
}

function buildSlateSegment(snapshot, opts) {
  const league = (snapshot && snapshot.league) || {};
  const parts = partitionLeagueNotes(league.verified_notes);
  const probables = parts.probables.slice();
  const teams = (opts && opts.teams) || [];
  const display = teams.map(teamLabel);
  // Pull focus team probables to the top so the host hits them first.
  probables.sort((a, b) => {
    const ai = display.some((d) => a.indexOf(d) !== -1) ? 0 : 1;
    const bi = display.some((d) => b.indexOf(d) !== -1) ? 0 : 1;
    return ai - bi;
  });
  const lines = [];
  if (probables.length === 0) {
    lines.push("No verified probable matchups in this snapshot.");
    return lines;
  }
  lines.push("Today's slate — verified probables.");
  const cap = Math.min(probables.length, 8);
  for (let i = 0; i < cap; i++) {
    lines.push(stripPrefix(probables[i]) + ".");
  }
  if (probables.length > cap) {
    lines.push("Plus " + (probables.length - cap) + " more on the wire.");
  }
  return lines;
}

// Pick out injury / DL / activate / claim moves first; ignore the long tail of
// minor / college moves that bloat the league wire.
function isHighSignalTransaction(t) {
  if (typeof t !== "string") return false;
  return /(injured list|activated|recalled|optioned|designated|signed|released|claimed|free agent|reinstated)/i.test(t);
}

// The MLB feed includes thousands of college / indie / minor moves. We bias the
// transactions segment toward MLB-team rows by filtering out clearly non-MLB
// affiliations (Kansas Jayhawks, Fresno State, Mexican League clubs, etc.).
function isLikelyMlbTransaction(t) {
  if (typeof t !== "string") return false;
  if (!/^League tx:/i.test(t)) return true;
  const blocklist = [
    "Jayhawks",
    "Bulldogs",
    "Spartans",
    "Cougars",
    "Crusaders",
    "RidgeYaks",
    "Aguila",
    "Sultanes",
    "Bravos",
    "Toros",
    "Conspiradores",
    "Veracruz",
    "Tijuana",
    "Monterrey",
    "Leon",
    "Queretaro",
  ];
  return !blocklist.some((b) => t.indexOf(b) !== -1);
}

function buildTransactionsSegment(snapshot, opts) {
  const league = (snapshot && snapshot.league) || {};
  const all = Array.isArray(league.transactions) ? league.transactions : [];
  const teams = (opts && opts.teams) || [];
  const teamBlocks = (snapshot && snapshot.teams) || {};

  // Per-team team-level moves, then a league injury/news roll-up.
  const teamMoves = [];
  teams.forEach((t) => {
    const block = teamBlocks[t] || {};
    const verified = Array.isArray(block.verified_notes) ? block.verified_notes : [];
    verified.filter(isTx).forEach((m) => teamMoves.push(m));
  });

  const leagueHighSignal = all
    .filter(isHighSignalTransaction)
    .filter(isLikelyMlbTransaction);

  const lines = [];
  if (teamMoves.length === 0 && leagueHighSignal.length === 0) {
    lines.push("No verified transactions in this window.");
    return lines;
  }
  if (teamMoves.length) {
    lines.push("Transactions — focus teams.");
    teamMoves.slice(0, 6).forEach((m) => lines.push(stripPrefix(m) + "."));
  }
  if (leagueHighSignal.length) {
    lines.push("Around the league.");
    leagueHighSignal.slice(0, 6).forEach((m) => lines.push(stripPrefix(m) + "."));
  }
  return lines;
}

function buildTeamSegment(teamKey, snapshot) {
  const block = ((snapshot && snapshot.teams) || {})[teamKey] || {};
  const verified = Array.isArray(block.verified_notes) ? block.verified_notes : [];
  const standings = verified.filter(isStandings);
  const probables = verified.filter(isProbable);
  const tx = verified.filter(isTx);
  const lines = [];
  lines.push("Now — " + teamLabel(teamKey) + ".");
  if (standings.length) {
    lines.push("Where they sit: " + stripPrefix(standings[0]) + ".");
  }
  if (probables.length) {
    lines.push("Next up on the schedule: " + stripPrefix(probables[0]) + ".");
    if (probables.length > 1) {
      lines.push("Then: " + stripPrefix(probables[1]) + ".");
    }
  }
  const lane = newsLane(snapshot, teamKey);
  if (lane.length) { lines.push("News to watch: " + (lane[0].headline || "No headline") + "."); }
  if (tx.length) {
    lines.push("Recent moves:");
    tx.slice(0, 4).forEach((m) => lines.push("• " + stripPrefix(m) + "."));
  }
  if (lines.length === 1) {
    lines.push("No verified notes in this snapshot for " + teamLabel(teamKey) + ".");
  }
  return lines;
}


function newsLane(snapshot, teamKey) {
  const news = (snapshot && snapshot.news) || {};
  const league = (news && news.league_news && Array.isArray(news.league_news.items)) ? news.league_news.items : (Array.isArray(news) ? news : []);
  const team = (news.teams && news.teams[teamKey] && Array.isArray(news.teams[teamKey].items)) ? news.teams[teamKey].items : [];
  return team.length ? team : league;
}

function buildCloser(snapshot, opts) {
  const league = (snapshot && snapshot.league) || {};
  const parts = partitionLeagueNotes(league.verified_notes);
  const watch = Array.isArray(league.watch) ? league.watch : parts.probables;
  const teams = (opts && opts.teams) || [];
  const display = teams.map(teamLabel);

  const lines = [];
  lines.push("Watch list before we go.");
  const focus = watch.filter((w) => display.some((d) => w.indexOf(d) !== -1));
  const others = watch.filter((w) => !display.some((d) => w.indexOf(d) !== -1));
  const ordered = focus.concat(others).slice(0, 4);
  if (ordered.length === 0) {
    lines.push("Nothing flagged in the verified watch list.");
  } else {
    ordered.forEach((w) => lines.push(stripPrefix(w) + "."));
  }
  lines.push("That's the rundown — back to you.");
  return lines;
}

// BD Bets is editorial intel — model picks/notes from Matt's own BD Bets
// project, NOT a sportsbook integration. The show generator uses it as a
// "model lean" / "watch the number" segment, never as wagering instructions.
function getBdBetsPicks(snapshot) {
  const sec = snapshot && snapshot.bd_bets;
  if (!sec || typeof sec !== "object") return [];
  const picks = Array.isArray(sec.picks) ? sec.picks : [];
  return picks.filter((p) => p && typeof p === "object" && p.away_team && p.home_team && p.pick);
}

function getBdBetsInsights(snapshot) {
  const sec = snapshot && snapshot.bd_bets;
  if (!sec || typeof sec !== "object") return [];
  return Array.isArray(sec.insights) ? sec.insights.filter((s) => typeof s === "string" && s.trim()) : [];
}

function formatBdBetsLine(p) {
  const conf = p.confidence ? " (" + p.confidence + ")" : "";
  const edge = p.edge ? " — edge " + p.edge : "";
  const matchup = p.away_team + " @ " + p.home_team;
  return matchup + " — " + p.market + ": " + p.pick + conf + edge;
}

function buildBdBetsSegment(snapshot) {
  const picks = getBdBetsPicks(snapshot);
  const insights = getBdBetsInsights(snapshot);
  const lines = [];
  if (!picks.length && !insights.length) {
    lines.push("No BD Bets picks connected for this slate.");
    return lines;
  }
  const top = selectTopBdBetsAngles(picks, 5);
  lines.push("BD Bets angle — model leans, not wagering instructions.");
  top.forEach((p) => {
    lines.push(formatBdBetsLine(p) + ".");
    if (p.model_note) lines.push("Model note: " + p.model_note);
  });
  if (picks.length > top.length) {
    const extra = picks.length - top.length;
    lines.push("Plus " + extra + " more pick" + (extra === 1 ? "" : "s") + " in the BD Bets feed.");
  }
  if (insights.length) {
    lines.push("Watch the number:");
    insights.slice(0, 3).forEach((s) => lines.push("• " + s));
  }
  return lines;
}

// Score and rank BD Bets picks for show-prep use. Highest-edge / highest-
// confidence open picks bubble to the top. Settled picks (win/loss/push) are
// kept but ranked below open picks so today's leans lead. Returns a fresh
// array of at most `limit` picks (default 5) — the caller decides how many
// to surface.
function _bdBetsConfidenceScore(c) {
  if (typeof c !== "string") return 0;
  const s = c.trim().toLowerCase();
  if (s === "high") return 3;
  if (s === "medium") return 2;
  if (s === "low") return 1;
  const n = parseFloat(s);
  if (!isNaN(n)) {
    if (n >= 0.66) return 3;
    if (n >= 0.33) return 2;
    if (n > 0) return 1;
  }
  return 0;
}
function _bdBetsEdgeScore(e) {
  if (e == null || e === "") return 0;
  if (typeof e === "number") return e;
  const m = /-?\d+(?:\.\d+)?/.exec(String(e));
  return m ? parseFloat(m[0]) : 0;
}
function selectTopBdBetsAngles(picks, limit) {
  const list = Array.isArray(picks) ? picks.slice() : [];
  const cap = (typeof limit === "number" && limit > 0) ? limit : 5;
  const scored = list.map((p, idx) => {
    const status = (p && p.status ? String(p.status).toLowerCase() : "open");
    const isOpen = status === "open" || status === "";
    const score =
      _bdBetsConfidenceScore(p && p.confidence) * 10 +
      _bdBetsEdgeScore(p && p.edge);
    return { p: p, idx: idx, isOpen: isOpen, score: score };
  });
  scored.sort((a, b) => {
    if (a.isOpen !== b.isOpen) return a.isOpen ? -1 : 1;
    if (b.score !== a.score) return b.score - a.score;
    return a.idx - b.idx;
  });
  return scored.slice(0, cap).map((x) => x.p);
}

// --- Deterministic baseball storylines / show stack ---
//
// Build a ranked list of editorial angles for today's show. Order priority:
//   1. focus-team games on the slate today
//   2. marquee matchups (top-of-standings teams playing each other)
//   3. notable probable pitchers (focus team or top-standings team)
//   4. standings / division context
//   5. high-signal transactions / injuries
//   6. one compact BD Bets angle (only if a top angle exists)
// Pure function of (snapshot, options). Empty inputs -> empty stack with a
// single "no_data" entry, never invented content.

function _scoreboardGames(snapshot) {
  const sb = (snapshot && snapshot.scoreboard) || {};
  return Array.isArray(sb.games) ? sb.games : [];
}

function _teamMatchesAlias(name, key) {
  if (typeof name !== "string" || !name) return false;
  const n = name.toLowerCase();
  if (n.indexOf(key) !== -1) return true;
  const display = (TEAM_DISPLAY[key] || "").toLowerCase();
  return display && n.indexOf(display) !== -1;
}

function _gameInvolvesFocus(game, teamKeys) {
  if (!game) return false;
  return (teamKeys || []).some((k) => _teamMatchesAlias(game.away_team, k) || _teamMatchesAlias(game.home_team, k));
}

function _formatGameMatchup(game) {
  const away = (game && game.away_team) || "?";
  const home = (game && game.home_team) || "?";
  return away + " @ " + home;
}

function _formatProbables(game) {
  const pp = (game && game.probable_pitchers) || {};
  const a = pp.away || "TBD";
  const h = pp.home || "TBD";
  if (a === "TBD" && h === "TBD") return "";
  return a + " vs " + h;
}

function _topStandingsTeams(snapshot, n) {
  const league = (snapshot && snapshot.league) || {};
  const parts = partitionLeagueNotes(league.verified_notes);
  const ranked = rankStandings(parts.standings).slice(0, n || 5);
  return ranked.map((row) => {
    const m = /^Standings:\s+(.+?):\s+(\d+)-(\d+)/i.exec(row);
    return { line: row, team: m ? m[1] : "", wins: m ? parseInt(m[2], 10) : 0, losses: m ? parseInt(m[3], 10) : 0 };
  });
}

function _isNotableTransaction(line) {
  if (typeof line !== "string") return false;
  if (!isHighSignalTransaction(line)) return false;
  return isLikelyMlbTransaction(line);
}

function buildShowStack(snapshot, options) {
  const opts = Object.assign({ teams: [], limit: 8 }, options || {});
  const focusTeams = (opts.teams || []).filter((t) => typeof t === "string");
  const stack = [];
  const seenIds = {};
  function push(entry) {
    if (!entry || !entry.id || seenIds[entry.id]) return;
    seenIds[entry.id] = true;
    stack.push(entry);
  }

  const games = _scoreboardGames(snapshot);
  const league = (snapshot && snapshot.league) || {};
  const parts = partitionLeagueNotes(league.verified_notes);
  const probables = parts.probables.slice();
  const topStandings = _topStandingsTeams(snapshot, 5);
  const topTeamNames = topStandings.map((x) => x.team).filter(Boolean);

  // 1. Focus-team games today.
  focusTeams.forEach((tk) => {
    const game = games.find((g) => _gameInvolvesFocus(g, [tk]));
    if (game) {
      const probLine = _formatProbables(game);
      const headline = teamLabel(tk) + " in action — " + _formatGameMatchup(game);
      push({
        id: "focus_game_" + tk,
        kind: "focus_game",
        priority: 1,
        team: tk,
        headline: headline,
        detail: probLine ? "Probables: " + probLine + "." : (game.status_detail || "Scheduled."),
        game: game,
      });
    }
  });

  // 2. Marquee matchups: both clubs in top-5 standings.
  games.forEach((g) => {
    const aTop = topTeamNames.some((t) => _teamMatchesAlias(g.away_team, t.toLowerCase()) || (t && g.away_team && g.away_team.toLowerCase().indexOf(t.toLowerCase()) !== -1));
    const hTop = topTeamNames.some((t) => _teamMatchesAlias(g.home_team, t.toLowerCase()) || (t && g.home_team && g.home_team.toLowerCase().indexOf(t.toLowerCase()) !== -1));
    if (aTop && hTop) {
      const probLine = _formatProbables(g);
      push({
        id: "marquee_" + (g.id || (g.away_team + "@" + g.home_team)),
        kind: "marquee",
        priority: 2,
        headline: "Marquee matchup: " + _formatGameMatchup(g),
        detail: probLine ? "Probables: " + probLine + "." : "Both clubs in the upper tier of the standings.",
        game: g,
      });
    }
  });

  // 3. Notable probables (focus or top-standings) — only those not already
  // surfaced via a scoreboard game above.
  probables.slice(0, 12).forEach((p, idx) => {
    const stripped = stripPrefix(p);
    const display = focusTeams.map(teamLabel).concat(topTeamNames);
    const hits = display.some((d) => d && stripped.indexOf(d) !== -1);
    if (!hits) return;
    push({
      id: "probable_" + idx,
      kind: "probable",
      priority: 3,
      headline: "Notable probable — " + stripped,
      detail: "",
    });
  });

  // 4. Standings / division context — top of each division-ranked entry.
  if (topStandings.length) {
    push({
      id: "standings_top",
      kind: "standings",
      priority: 4,
      headline: "Top of the standings: " + stripPrefix(topStandings[0].line).replace(/\s*\[.*?\]\s*$/, ""),
      detail: topStandings.slice(1, 3).map((x) => stripPrefix(x.line).replace(/\s*\[.*?\]\s*$/, "")).join("; "),
    });
  }

  // 5. High-signal transactions / injuries.
  const tx = Array.isArray(league.transactions) ? league.transactions : [];
  const notable = tx.filter(_isNotableTransaction).slice(0, 3);
  notable.forEach((t, idx) => {
    push({
      id: "tx_" + idx,
      kind: "transaction",
      priority: 5,
      headline: "Transaction wire — " + stripPrefix(t),
      detail: "",
    });
  });

  // 6. One compact BD Bets angle, only if a top angle exists.
  const topBets = selectTopBdBetsAngles(getBdBetsPicks(snapshot), 1);
  if (topBets.length) {
    const p = topBets[0];
    push({
      id: "bd_bets_top",
      kind: "bd_bets",
      priority: 6,
      headline: "BD Bets angle — " + p.away_team + " @ " + p.home_team,
      detail: p.market + ": " + p.pick + (p.confidence ? " (" + p.confidence + ")" : "") +
              (p.model_note ? " — " + p.model_note : ""),
    });
  }

  // Honest empty state — never invent content.
  if (stack.length === 0) {
    return [{
      id: "no_data",
      kind: "empty",
      priority: 99,
      headline: "No verified storylines in this snapshot.",
      detail: "Slate may be empty or sources are unhealthy — re-check before air.",
    }];
  }

  // Stable sort by priority ascending, then by id for determinism.
  stack.sort((a, b) => {
    if (a.priority !== b.priority) return a.priority - b.priority;
    return a.id < b.id ? -1 : (a.id > b.id ? 1 : 0);
  });
  const limit = opts.limit || 8;
  // Reserve one slot for the BD Bets compact angle when present so the
  // baseball storylines never crowd it out of the visible stack — but it
  // still ranks last so baseball leads.
  const bd = stack.find((s) => s.kind === "bd_bets");
  if (bd && stack.length > limit) {
    const others = stack.filter((s) => s.kind !== "bd_bets").slice(0, limit - 1);
    return others.concat([bd]);
  }
  return stack.slice(0, limit);
}

// Map allocator: returns segments with title, durationMinutes, lines (for
// teleprompter), bullets (for rundown), and the lane keys consulted.
function generateRundown(snapshot, options) {
  const opts = Object.assign({ preset: "standard", teams: [] }, options || {});
  const presetKey = PRESETS[opts.preset] ? opts.preset : "standard";
  const preset = PRESETS[presetKey];
  const budget = SEGMENT_BUDGETS[presetKey];

  const segments = [];

  segments.push({
    id: "opener",
    title: "Cold Open / Hook",
    durationMinutes: budget.opener,
    lines: buildOpener(snapshot, opts),
    laneKeys: ["league_standings", "league_schedule", "league_transactions"],
  });

  segments.push({
    id: "league",
    title: "League Snapshot",
    durationMinutes: budget.league,
    lines: buildLeagueSegment(snapshot),
    laneKeys: ["league_standings"],
  });

  segments.push({
    id: "slate",
    title: "Today's Slate / Probables",
    durationMinutes: budget.slate,
    lines: buildSlateSegment(snapshot, opts),
    laneKeys: ["league_schedule"],
  });

  segments.push({
    id: "transactions",
    title: "Transactions & Injuries",
    durationMinutes: budget.transactions,
    lines: buildTransactionsSegment(snapshot, opts),
    laneKeys: ["league_transactions"].concat(
      (opts.teams || []).map((t) => t + "_transactions")
    ),
  });

  (opts.teams || []).forEach((t) => {
    segments.push({
      id: "team_" + t,
      title: teamLabel(t) + " — Homer Block",
      durationMinutes: budget.teamEach,
      lines: buildTeamSegment(t, snapshot),
      laneKeys: [t + "_standings", t + "_schedule", t + "_transactions"],
    });
  });

  // BD Bets segment: only included when picks exist. We don't reserve time
  // for it in presets that have no feed, to keep durations honest.
  if (getBdBetsPicks(snapshot).length > 0) {
    segments.push({
      id: "bd_bets",
      title: "BD Bets Angle",
      durationMinutes: budget.bdBets,
      lines: buildBdBetsSegment(snapshot),
      laneKeys: ["bd_bets"],
    });
  }

  segments.push({
    id: "closer",
    title: "Watch List / Close",
    durationMinutes: budget.closer,
    lines: buildCloser(snapshot, opts),
    laneKeys: ["league_schedule"],
  });

  const totalMinutes = segments.reduce((acc, s) => acc + s.durationMinutes, 0);

  return {
    presetKey: presetKey,
    presetLabel: preset.label,
    targetMinutes: preset.totalMinutes,
    totalMinutes: totalMinutes,
    teams: opts.teams.slice(),
    generatedAt: snapshot && snapshot.generated_at,
    segments: segments,
  };
}

// Confidence summary used in the teleprompter header. We only flag verified
// when the consulted lanes were verified; never use the word "unverified" if
// no actual unverified notes exist.
function summarizeConfidence(snapshot, segment) {
  const status = (snapshot && snapshot.source_status) || {};
  const lanes = Array.isArray(segment.laneKeys) ? segment.laneKeys : [];
  if (lanes.length === 0) return "verified snapshot";
  let verified = 0;
  let total = 0;
  lanes.forEach((k) => {
    if (status[k] !== undefined) {
      total += 1;
      if (status[k] === "verified") verified += 1;
    }
  });
  if (total === 0) return "no source health reported";
  if (verified === total) return "verified across " + total + " lane(s)";
  if (verified === 0) return "WARNING: source error / unverified — re-check before air";
  return verified + " of " + total + " lanes verified — re-check the rest";
}

function pad2(n) { return n < 10 ? "0" + n : "" + n; }

// Render a producer-facing rundown as plain text.
function renderRundownText(rundown) {
  const lines = [];
  lines.push("BD BASEBALL — RUNDOWN (" + rundown.presetLabel + ")");
  lines.push("Target: " + rundown.targetMinutes + " min  •  Allocated: " + rundown.totalMinutes + " min");
  if (rundown.generatedAt) lines.push("Snapshot: " + rundown.generatedAt);
  if (rundown.teams && rundown.teams.length) {
    lines.push("Focus teams: " + rundown.teams.map(teamLabel).join(", "));
  }
  lines.push("");
  let cumulative = 0;
  rundown.segments.forEach((seg, idx) => {
    const start = cumulative;
    cumulative += seg.durationMinutes;
    const end = cumulative;
    lines.push(
      pad2(idx + 1) + ". [" + pad2(start) + ":00–" + pad2(end) + ":00] " +
      seg.title + " (" + seg.durationMinutes + " min)"
    );
    seg.lines.forEach((l) => lines.push("    - " + l));
    lines.push("");
  });
  return lines.join("\n");
}

// Render a teleprompter / host script in spoken copy style.
function renderTeleprompter(rundown, snapshot) {
  const out = [];
  out.push("BD BASEBALL — HOST SCRIPT");
  out.push("Format: " + rundown.presetLabel + "  (" + rundown.totalMinutes + " min allocated)");
  if (rundown.generatedAt) out.push("Snapshot: " + rundown.generatedAt);
  out.push("");
  let cumulative = 0;
  rundown.segments.forEach((seg, idx) => {
    const start = cumulative;
    cumulative += seg.durationMinutes;
    out.push("== " + (idx + 1) + ". " + seg.title.toUpperCase() +
            " (" + start + "–" + cumulative + " min) ==");
    out.push("[Source confidence: " + summarizeConfidence(snapshot, seg) + "]");
    out.push("");
    seg.lines.forEach((l) => out.push(l));
    out.push("");
    if (idx < rundown.segments.length - 1) {
      out.push(transitionLine(seg, rundown.segments[idx + 1]));
      out.push("");
    }
  });
  return out.join("\n");
}

function transitionLine(current, next) {
  const map = {
    opener: "Let's get into it.",
    league: "From the standings to the slate —",
    slate: "Off the field now —",
    transactions: "Closer to home —",
    bd_bets: "Wrapping the show —",
    closer: "",
  };
  if (next.id && next.id.indexOf("team_") === 0) {
    return "[transition] Closer to home now —";
  }
  if (next.id === "bd_bets") {
    return "[transition] One angle from the BD Bets model —";
  }
  return "[transition] " + (map[current.id] || "Moving on.");
}

// --- Livestream metadata generation ---
//
// Produces a producer-facing livestream "package": a YouTube/Rumble-style
// title, short and long descriptions, and a teaser line. Inputs are the same
// snapshot + rundown the rest of the generator runs on, so output stays
// deterministic and never claims more than the verified notes support.

// Pull a YYYY-MM-DD show date from the snapshot. Falls back to today's UTC
// date if the snapshot doesn't include a parseable timestamp.
function showDateString(snapshot) {
  const ts = snapshot && snapshot.generated_at;
  if (typeof ts === "string" && /^\d{4}-\d{2}-\d{2}/.test(ts)) {
    return ts.slice(0, 10);
  }
  return "";
}

// Pretty US-style date for human-facing copy (e.g. "Friday, May 1, 2026").
// Pure: parses an ISO date string ourselves so output is locale-independent
// and tests are stable across machines.
const MONTHS = ["January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"];
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
function prettyDate(snapshot) {
  const d = showDateString(snapshot);
  if (!d) return "";
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d);
  if (!m) return d;
  const y = parseInt(m[1], 10);
  const mo = parseInt(m[2], 10);
  const da = parseInt(m[3], 10);
  const dt = new Date(Date.UTC(y, mo - 1, da));
  if (isNaN(dt.getTime())) return d;
  return WEEKDAYS[dt.getUTCDay()] + ", " + MONTHS[mo - 1] + " " + da + ", " + y;
}

// Parse "Probable: <Away> (<P1>) @ <Home> (<P2>) — Scheduled ..." into parts.
function parseProbable(note) {
  if (typeof note !== "string") return null;
  const stripped = note.replace(/^Probable:\s*/i, "");
  const m = /^(.+?)\s+\(([^)]+)\)\s+@\s+(.+?)\s+\(([^)]+)\)/.exec(stripped);
  if (!m) return null;
  return {
    away: m[1].trim(),
    awayPitcher: m[2].trim(),
    home: m[3].trim(),
    homePitcher: m[4].trim(),
  };
}

// Find a probable that mentions any of the focus team display names.
function findFocusProbable(probables, teams) {
  const display = (teams || []).map(teamLabel);
  for (let i = 0; i < probables.length; i++) {
    const p = probables[i];
    if (display.some((d) => p.indexOf(d) !== -1)) return p;
  }
  return null;
}

// Truncate a candidate title to keep it under YouTube's 100-char limit and
// readable in mobile previews. We prefer to break on a separator rather
// than mid-word.
function clampTitle(s, max) {
  if (typeof s !== "string") return "";
  if (s.length <= max) return s;
  const cut = s.slice(0, max);
  const lastSep = Math.max(cut.lastIndexOf(" — "), cut.lastIndexOf(" - "), cut.lastIndexOf(": "));
  if (lastSep > max * 0.5) return cut.slice(0, lastSep).trim();
  const lastSpace = cut.lastIndexOf(" ");
  if (lastSpace > max * 0.5) return cut.slice(0, lastSpace).trim() + "…";
  return cut.trim() + "…";
}

// Compute a verified-vs-total source-health summary for the producer note.
function snapshotHealth(snapshot) {
  const status = (snapshot && snapshot.source_status) || {};
  const keys = Object.keys(status);
  let verified = 0;
  let errors = 0;
  let unverified = 0;
  keys.forEach((k) => {
    if (status[k] === "verified") verified += 1;
    else if (status[k] === "source_error") errors += 1;
    else if (status[k] === "unverified") unverified += 1;
  });
  return {
    total: keys.length,
    verified: verified,
    errors: errors,
    unverified: unverified,
    healthy: keys.length > 0 && errors === 0 && verified >= Math.ceil(keys.length / 2),
  };
}

function buildLivestreamTitle(snapshot, rundown, opts) {
  const teams = (opts && opts.teams) || [];
  const league = (snapshot && snapshot.league) || {};
  const parts = partitionLeagueNotes(league.verified_notes);
  const ranked = rankStandings(parts.standings);
  const focusProbable = parseProbable(findFocusProbable(parts.probables, teams));
  const top = ranked.length ? stripPrefix(ranked[0]).replace(/\s*\[.*?\]\s*$/, "") : "";
  const dateStr = showDateString(snapshot);
  const datePart = dateStr ? " | " + dateStr : "";

  let title;
  if (focusProbable) {
    title = "BD Baseball: " + focusProbable.away + " @ " + focusProbable.home +
      " (" + focusProbable.awayPitcher + " vs " + focusProbable.homePitcher + ")" + datePart;
  } else if (top) {
    title = "BD Baseball: " + top + datePart;
  } else if (parts.probables.length) {
    title = "BD Baseball: Today's MLB Slate — " + parts.probables.length + " Probable Matchups" + datePart;
  } else {
    title = "BD Baseball Show" + datePart;
  }
  return clampTitle(title, 100);
}

function buildShortDescription(snapshot, rundown, opts) {
  const teams = (opts && opts.teams) || [];
  const display = teams.map(teamLabel);
  const league = (snapshot && snapshot.league) || {};
  const parts = partitionLeagueNotes(league.verified_notes);
  const ranked = rankStandings(parts.standings);
  const probableCount = parts.probables.length;
  const txCount = Array.isArray(league.transactions) ? league.transactions.length : 0;
  const date = prettyDate(snapshot);

  const sentences = [];
  const lead = (rundown && rundown.presetLabel) ? rundown.presetLabel.replace(/^\d+-min\s*/, "") : "Show";
  sentences.push(
    (date ? date + " — " : "") +
    "Today's BD Baseball " + lead.toLowerCase() +
    (display.length ? ", with focus on " + display.join(", ") : "") + "."
  );
  const bits = [];
  if (ranked.length) {
    bits.push("a verified standings check");
  }
  if (probableCount) {
    bits.push(probableCount + " probable matchup" + (probableCount === 1 ? "" : "s"));
  }
  if (txCount) {
    bits.push("the league transaction wire");
  }
  if (bits.length) {
    sentences.push("We work through " + bits.join(", ") +
      ", all sourced from the verified MLB Stats API snapshot.");
  } else {
    sentences.push("Built off the latest verified MLB Stats API snapshot.");
  }
  return sentences.join(" ");
}

// Long YouTube-style description: episode summary, segment list with
// minute timestamps, top standings + slate highlights, source confidence,
// and CTA placeholders the producer can replace.
function buildLongDescription(snapshot, rundown, opts) {
  const teams = (opts && opts.teams) || [];
  const display = teams.map(teamLabel);
  const league = (snapshot && snapshot.league) || {};
  const parts = partitionLeagueNotes(league.verified_notes);
  const ranked = rankStandings(parts.standings);
  const probables = parts.probables.slice();
  const date = prettyDate(snapshot);
  const health = snapshotHealth(snapshot);

  const out = [];
  out.push("BD Baseball Show" + (date ? " — " + date : ""));
  out.push("");
  out.push(buildShortDescription(snapshot, rundown, opts));
  out.push("");

  // Today's storylines (baseball-first show stack). BD Bets is one optional
  // entry inside this list, never the lead unless it's the only available
  // angle the model surfaced.
  const stack = buildShowStack(snapshot, { teams: teams, limit: 6 });
  if (stack.length && stack[0].kind !== "empty") {
    out.push("Today's storylines:");
    stack.forEach((s) => {
      out.push("• " + s.headline + (s.detail ? " — " + s.detail : ""));
    });
    out.push("");
  }

  // Segment list / timestamps.
  if (rundown && Array.isArray(rundown.segments) && rundown.segments.length) {
    out.push("Segments:");
    let cumulative = 0;
    rundown.segments.forEach((seg) => {
      const mm = pad2(cumulative);
      out.push(mm + ":00  " + seg.title);
      cumulative += seg.durationMinutes;
    });
    out.push("");
  }

  if (ranked.length) {
    out.push("Top of the standings (verified):");
    ranked.slice(0, 5).forEach((s) => out.push("• " + stripPrefix(s)));
    out.push("");
  }

  if (probables.length) {
    out.push("On the slate today:");
    // Push focus matchups to the top.
    probables.sort((a, b) => {
      const ai = display.some((d) => a.indexOf(d) !== -1) ? 0 : 1;
      const bi = display.some((d) => b.indexOf(d) !== -1) ? 0 : 1;
      return ai - bi;
    });
    probables.slice(0, 6).forEach((p) => out.push("• " + stripPrefix(p)));
    if (probables.length > 6) out.push("• …plus " + (probables.length - 6) + " more.");
    out.push("");
  }

  // Source-confidence note. Plain language so YouTube viewers don't see jargon.
  if (health.total > 0) {
    if (health.healthy) {
      out.push("Source confidence: " + health.verified + "/" + health.total +
        " data lanes verified against the MLB Stats API at show time.");
    } else if (health.errors > 0) {
      out.push("Source confidence: " + health.verified + "/" + health.total +
        " data lanes verified — " + health.errors + " upstream error(s) at show time. Treat affected items as last-known-good.");
    } else {
      out.push("Source confidence: " + health.verified + "/" + health.total +
        " data lanes verified at show time.");
    }
    out.push("");
  }

  // BD Bets editorial section (model leans / watch the number). Editorial
  // framing only — never wagering instructions.
  const bdPicks = getBdBetsPicks(snapshot);
  if (bdPicks.length) {
    out.push("BD Bets angles (model leans):");
    bdPicks.slice(0, 4).forEach((p) => out.push("• " + formatBdBetsLine(p)));
    if (bdPicks.length > 4) out.push("• …plus " + (bdPicks.length - 4) + " more in the BD Bets feed.");
    out.push("");
  }

  // CTA placeholders — producer replaces these in the show description.
  out.push("Subscribe and turn on notifications so you don't miss the next show.");
  out.push("");
  out.push("Links:");
  out.push("• Substack: <add Substack URL>");
  out.push("• X / Twitter: <add handle>");
  out.push("• Discord / community: <add link>");
  out.push("");
  out.push("#MLB #Baseball #BDBaseball");
  return out.join("\n");
}

function buildTeaser(snapshot, rundown, opts) {
  const teams = (opts && opts.teams) || [];
  const league = (snapshot && snapshot.league) || {};
  const parts = partitionLeagueNotes(league.verified_notes);
  const ranked = rankStandings(parts.standings);
  const focusProbable = parseProbable(findFocusProbable(parts.probables, teams));
  const date = prettyDate(snapshot);

  if (focusProbable) {
    return "Going live: " + focusProbable.away + " at " + focusProbable.home +
      " — " + focusProbable.awayPitcher + " vs " + focusProbable.homePitcher +
      (date ? ". " + date + " on BD Baseball." : ". BD Baseball, today.");
  }
  if (ranked.length) {
    const top = stripPrefix(ranked[0]).replace(/\s*\[.*?\]\s*$/, "");
    return "Going live on BD Baseball" + (date ? " — " + date : "") +
      ". " + top + ", plus the slate and the wire.";
  }
  if (parts.probables.length) {
    return "Going live on BD Baseball" + (date ? " — " + date : "") +
      ". " + parts.probables.length + " probable matchups, transactions, and the watch list.";
  }
  return "Going live on BD Baseball" + (date ? " — " + date : "") +
    ". Verified MLB snapshot, no fluff.";
}

// Build the complete livestream metadata package.
function generateLivestreamPackage(snapshot, rundown, options) {
  const opts = Object.assign({ teams: [] }, options || {});
  if (rundown && rundown.teams && !options) {
    opts.teams = rundown.teams.slice();
  }
  const health = snapshotHealth(snapshot);
  const warning = (!health.healthy && health.total > 0)
    ? "Source health warning: only " + health.verified + " of " + health.total +
      " lanes verified" + (health.errors ? "; " + health.errors + " source_error" : "") +
      ". Review before publishing."
    : "";
  return {
    showDate: showDateString(snapshot),
    prettyDate: prettyDate(snapshot),
    title: buildLivestreamTitle(snapshot, rundown, opts),
    shortDescription: buildShortDescription(snapshot, rundown, opts),
    longDescription: buildLongDescription(snapshot, rundown, opts),
    teaser: buildTeaser(snapshot, rundown, opts),
    producerWarning: warning,
    health: health,
  };
}

// Render the livestream metadata as Markdown for download.
function renderLivestreamMarkdown(pkg) {
  const out = [];
  out.push("# BD Baseball — Livestream Metadata");
  if (pkg.prettyDate) out.push("_" + pkg.prettyDate + "_");
  out.push("");
  if (pkg.producerWarning) {
    out.push("> **Producer note:** " + pkg.producerWarning);
    out.push("");
  }
  out.push("## Livestream title");
  out.push("");
  out.push(pkg.title);
  out.push("");
  out.push("## Short description");
  out.push("");
  out.push(pkg.shortDescription);
  out.push("");
  out.push("## Full description");
  out.push("");
  out.push(pkg.longDescription);
  out.push("");
  out.push("## Teaser / social copy");
  out.push("");
  out.push(pkg.teaser);
  out.push("");
  return out.join("\n");
}

// Render the producer rundown as Markdown for download.
function renderRundownMarkdown(rundown) {
  const lines = [];
  lines.push("# BD Baseball — Rundown (" + rundown.presetLabel + ")");
  lines.push("");
  lines.push("- Target: " + rundown.targetMinutes + " min");
  lines.push("- Allocated: " + rundown.totalMinutes + " min");
  if (rundown.generatedAt) lines.push("- Snapshot: " + rundown.generatedAt);
  if (rundown.teams && rundown.teams.length) {
    lines.push("- Focus teams: " + rundown.teams.map(teamLabel).join(", "));
  }
  lines.push("");
  let cumulative = 0;
  rundown.segments.forEach((seg, idx) => {
    const start = cumulative;
    cumulative += seg.durationMinutes;
    const end = cumulative;
    lines.push("## " + (idx + 1) + ". " + seg.title +
      " (" + pad2(start) + ":00–" + pad2(end) + ":00, " + seg.durationMinutes + " min)");
    lines.push("");
    seg.lines.forEach((l) => lines.push("- " + l));
    lines.push("");
  });
  return lines.join("\n");
}

// Render the host script as Markdown for download. We keep the spoken copy
// inside fenced blocks so transitions / segment headers stay legible.
function renderHostScriptMarkdown(rundown, snapshot) {
  return "# BD Baseball — Host Script\n\n```\n" +
    renderTeleprompter(rundown, snapshot) + "\n```\n";
}

// Render a complete show package (title block, descriptions, rundown, host
// script, source health) as a single Markdown document.
function renderCompletePackageMarkdown(snapshot, rundown, pkg) {
  const out = [];
  out.push("# BD Baseball — Complete Show Package");
  if (pkg.prettyDate) out.push("_" + pkg.prettyDate + "_");
  out.push("");
  if (pkg.producerWarning) {
    out.push("> **Producer note:** " + pkg.producerWarning);
    out.push("");
  }
  out.push("Format: **" + rundown.presetLabel + "** — target " +
    rundown.targetMinutes + " min, allocated " + rundown.totalMinutes + " min.");
  if (rundown.teams && rundown.teams.length) {
    out.push("Focus teams: " + rundown.teams.map(teamLabel).join(", ") + ".");
  }
  out.push("");
  out.push("---");
  out.push("");
  out.push(renderLivestreamMarkdown(pkg).trim());
  out.push("");
  out.push("---");
  out.push("");
  out.push(renderRundownMarkdown(rundown).trim());
  out.push("");
  out.push("---");
  out.push("");
  out.push(renderHostScriptMarkdown(rundown, snapshot).trim());
  out.push("");
  out.push("---");
  out.push("");
  out.push("## Source health summary");
  out.push("");
  if (pkg.health && pkg.health.total > 0) {
    out.push("- Lanes verified: " + pkg.health.verified + "/" + pkg.health.total);
    if (pkg.health.errors) out.push("- Source errors: " + pkg.health.errors);
    if (pkg.health.unverified) out.push("- Unverified: " + pkg.health.unverified);
  } else {
    out.push("- No source-health lanes reported.");
  }
  if (snapshot && snapshot.generated_at) {
    out.push("- Snapshot generated_at: " + snapshot.generated_at);
  }
  out.push("");
  return out.join("\n");
}

// Build a safe filename slug from a preset id and show date.
// e.g. ("standard", "2026-05-01", "show-package", "md")
//   => "bd-baseball-2026-05-01-standard-show-package.md"
function buildFilename(presetKey, dateStr, kind, ext) {
  function slug(s) {
    return String(s == null ? "" : s)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
  }
  const parts = ["bd-baseball"];
  if (dateStr) parts.push(slug(dateStr));
  if (presetKey) parts.push(slug(presetKey));
  if (kind) parts.push(slug(kind));
  return parts.filter(Boolean).join("-") + "." + (ext || "md");
}

const api = {
  PRESETS: PRESETS,
  TEAM_DISPLAY: TEAM_DISPLAY,
  generateRundown: generateRundown,
  renderRundownText: renderRundownText,
  renderTeleprompter: renderTeleprompter,
  summarizeConfidence: summarizeConfidence,
  generateLivestreamPackage: generateLivestreamPackage,
  renderLivestreamMarkdown: renderLivestreamMarkdown,
  renderRundownMarkdown: renderRundownMarkdown,
  renderHostScriptMarkdown: renderHostScriptMarkdown,
  renderCompletePackageMarkdown: renderCompletePackageMarkdown,
  buildFilename: buildFilename,
  buildShowStack: buildShowStack,
  selectTopBdBetsAngles: selectTopBdBetsAngles,
  // exported for tests:
  _internals: {
    stripPrefix: stripPrefix,
    rankStandings: rankStandings,
    partitionLeagueNotes: partitionLeagueNotes,
    isHighSignalTransaction: isHighSignalTransaction,
    isLikelyMlbTransaction: isLikelyMlbTransaction,
    teamLabel: teamLabel,
    parseProbable: parseProbable,
    clampTitle: clampTitle,
    showDateString: showDateString,
    prettyDate: prettyDate,
    snapshotHealth: snapshotHealth,
    getBdBetsPicks: getBdBetsPicks,
    getBdBetsInsights: getBdBetsInsights,
    formatBdBetsLine: formatBdBetsLine,
    buildBdBetsSegment: buildBdBetsSegment,
    buildShowStack: buildShowStack,
    selectTopBdBetsAngles: selectTopBdBetsAngles,
  },
};

if (typeof module !== "undefined" && module.exports) {
  module.exports = api;
}
if (typeof window !== "undefined") {
  window.BDShowGenerator = api;
}
