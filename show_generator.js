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
const SEGMENT_BUDGETS = {
  quick: {
    opener: 1,
    league: 3,
    slate: 3,
    transactions: 2,
    teamEach: 2,
    closer: 1,
  },
  standard: {
    opener: 2,
    league: 4,
    slate: 5,
    transactions: 3,
    teamEach: 3,
    closer: 2,
  },
  deep: {
    opener: 2,
    league: 6,
    slate: 8,
    transactions: 4,
    teamEach: 4,
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
  const teams = (opts && opts.teams) || [];
  const league = (snapshot && snapshot.league) || {};
  const parts = partitionLeagueNotes(league.verified_notes);
  const top = rankStandings(parts.standings)[0];
  // Find a probable involving any of the configured focus teams.
  const focusProbable = parts.probables.find((p) => {
    const display = teams.map(teamLabel);
    return display.some((d) => p.indexOf(d) !== -1);
  });
  const transactionsCount = Array.isArray(league.transactions) ? league.transactions.length : 0;

  const lines = [];
  if (top) {
    lines.push("Top of the league this morning: " + stripPrefix(top) + ".");
  }
  if (focusProbable) {
    lines.push("On our radar today — " + stripPrefix(focusProbable) + ".");
  } else if (parts.probables.length) {
    lines.push("Plenty on the slate — " + parts.probables.length + " probable matchups confirmed.");
  }
  if (transactionsCount > 0) {
    lines.push("And the transaction wire is busy — " + transactionsCount + " moves logged in the verified window.");
  }
  if (lines.length === 0) {
    lines.push("We're working from the verified MLB snapshot this morning. Quick rundown coming up.");
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
  if (tx.length) {
    lines.push("Recent moves:");
    tx.slice(0, 4).forEach((m) => lines.push("• " + stripPrefix(m) + "."));
  }
  if (lines.length === 1) {
    lines.push("No verified notes in this snapshot for " + teamLabel(teamKey) + ".");
  }
  return lines;
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
    closer: "",
  };
  if (next.id && next.id.indexOf("team_") === 0) {
    return "[transition] Closer to home now —";
  }
  return "[transition] " + (map[current.id] || "Moving on.");
}

const api = {
  PRESETS: PRESETS,
  TEAM_DISPLAY: TEAM_DISPLAY,
  generateRundown: generateRundown,
  renderRundownText: renderRundownText,
  renderTeleprompter: renderTeleprompter,
  summarizeConfidence: summarizeConfidence,
  // exported for tests:
  _internals: {
    stripPrefix: stripPrefix,
    rankStandings: rankStandings,
    partitionLeagueNotes: partitionLeagueNotes,
    isHighSignalTransaction: isHighSignalTransaction,
    isLikelyMlbTransaction: isLikelyMlbTransaction,
    teamLabel: teamLabel,
  },
};

if (typeof module !== "undefined" && module.exports) {
  module.exports = api;
}
if (typeof window !== "undefined") {
  window.BDShowGenerator = api;
}
