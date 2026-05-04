"use strict";
// BD Baseball Show Prep — frontend wiring.
//
// Loads data/latest.json, renders the show generator UI on top, then renders
// the source-health / verified-notes panels below as a reference layer for
// the producer. All snapshot fields are inserted with textContent / DOM
// construction (never innerHTML interpolation).

const STALE_AFTER_MIN = 24 * 60;

const STATUS_MARK = { verified: "OK", unverified: "?", source_error: "!" };
const STATUS_LABEL = { verified: "verified", unverified: "unverified", source_error: "source error" };

let CURRENT_SNAPSHOT = null;
let CURRENT_RUNDOWN = null;
let CURRENT_LIVE_PKG = null;

function el(id) { return document.getElementById(id); }
function setText(id, value) { const n = el(id); if (n) n.textContent = value == null ? "" : String(value); }

function makeEl(tag, className, text) {
  const n = document.createElement(tag);
  if (className) n.className = className;
  if (text != null) n.textContent = String(text);
  return n;
}

function liNode(text, opts) {
  const node = document.createElement("li");
  const t = String(text == null ? "" : text);
  node.textContent = t;
  if ((opts && opts.unv) || /^UNVERIFIED:/i.test(t)) node.className = "unv";
  return node;
}

function fillList(id, items, fallback, opts) {
  const root = el(id);
  if (!root) return;
  while (root.firstChild) root.removeChild(root.firstChild);
  const list = Array.isArray(items) ? items : [];
  if (list.length === 0) {
    if (opts && opts.hideWhenEmpty) {
      // Render a single muted line, never a fake UNVERIFIED placeholder.
      root.appendChild(makeEl("li", "muted", fallback || "—"));
      return;
    }
    root.appendChild(makeEl("li", "muted", fallback || "—"));
    return;
  }
  list.forEach((x) => root.appendChild(liNode(x)));
}

function statusPill(status) {
  const key = (typeof status === "string" && status) ? status : "unknown";
  const safe = STATUS_MARK[key] !== undefined ? key : "unknown";
  const span = makeEl("span", "st st-" + safe);
  const mark = makeEl("span", "st-mark", STATUS_MARK[safe] != null ? STATUS_MARK[safe] : "·");
  span.appendChild(mark);
  span.appendChild(document.createTextNode(" " + (STATUS_LABEL[safe] || safe)));
  return span;
}

function laneLabel(key) {
  if (typeof key !== "string" || !key) return "(unknown lane)";
  const parts = key.split("_");
  const head = parts[0].charAt(0).toUpperCase() + parts[0].slice(1);
  const tail = parts.slice(1).join(" ");
  return tail ? head + " " + tail : head;
}


function parseStandingsNote(note) {
  if (typeof note !== "string") return null;
  const m = /^Standings:\s+(.+?):\s+(\d+)-(\d+)\s+\(PCT\s+(\.\d+),\s+GB\s+([^\)]+)\)/i.exec(note);
  if (!m) return null;
  return { team: m[1], wins: Number(m[2]), losses: Number(m[3]), pct: m[4], gb: m[5] };
}

function parseProbableNote(note) {
  if (typeof note !== "string") return null;
  const m = /^Probable:\s+(.+?)\s+\((.*?)\)\s+@\s+(.+?)\s+\((.*?)\)\s+—\s+Scheduled\s+([^ ]+)\s+(.+)$/i.exec(note);
  if (!m) return null;
  return { awayTeam: m[1], awayPitcher: m[2], homeTeam: m[3], homePitcher: m[4], time: m[5], venue: m[6] };
}

function parseTransactionNote(note) {
  if (typeof note !== "string") return null;
  const m = /^(?:League tx|[A-Za-z .']+ tx):\s+(\d{4}-\d{2}-\d{2}):\s+(.+)$/i.exec(note);
  if (!m) return null;
  return { date: m[1], detail: m[2] };
}

function cleanFeedText(text) {
  if (text == null) return "";
  return String(text)
    .replace(/\s+/g, " ")
    .replace(/\s+([,.;:!?])/g, "$1")
    .replace(/([,.;:!?])\1+/g, "$1")
    .replace(/—\s*—/g, "—")
    .trim();
}

function formatGameTime(value) {
  if (typeof value !== "string" || !value) return "Time TBA";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return cleanFeedText(value);
  return new Intl.DateTimeFormat(undefined, {
    weekday: "short",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(d);
}

function classifyGameStatus(value) {
  if (typeof value !== "string") return "upcoming";
  const raw = value.toLowerCase();
  if (/(final|completed|game over)/.test(raw)) return "final";
  if (/(in progress|live|mid [1-9]|top [1-9]|bot [1-9])/.test(raw)) return "inprogress";
  return "upcoming";
}

function partitionStructuredLeague(data) {
  const notes = ((data && data.league && data.league.verified_notes) || []);
  return {
    standings: notes.map(parseStandingsNote).filter(Boolean),
    probables: notes.map(parseProbableNote).filter(Boolean),
    transactions: ((data && data.league && data.league.transactions) || []).map(parseTransactionNote).filter(Boolean),
  };
}

function renderStandingsTable(rootId, standings) {
  const root = el(rootId); if (!root) return;
  while (root.firstChild) root.removeChild(root.firstChild);
  if (!standings.length) { root.appendChild(makeEl('p','muted','No standings rows available.')); return; }
  const table=makeEl('table','src-table');
  const thead=makeEl('thead'); const trh=document.createElement('tr');
  ['Team','W','L','PCT','GB'].forEach((h)=>trh.appendChild(makeEl('th',null,h))); thead.appendChild(trh); table.appendChild(thead);
  const tbody=makeEl('tbody');
  standings.forEach((r)=>{const tr=document.createElement('tr'); [r.team,r.wins,r.losses,r.pct,r.gb].forEach((v)=>tr.appendChild(makeEl('td',null,v))); tbody.appendChild(tr);});
  table.appendChild(tbody); root.appendChild(table);
}

function renderSourceHealth(rootId, data, keysFilter) {
  const root = el(rootId);
  if (!root) return;
  while (root.firstChild) root.removeChild(root.firstChild);
  const sources = (data && data.sources) || {};
  const status = (data && data.source_status) || {};
  const keys = Array.isArray(keysFilter) ? keysFilter : Object.keys(status);
  if (!keys.length) {
    root.appendChild(makeEl("p", "muted", "No source lanes reported."));
    return;
  }
  const table = makeEl("table", "src-table");
  const thead = makeEl("thead");
  const trh = document.createElement("tr");
  ["Lane", "Status", "Source"].forEach((t) => trh.appendChild(makeEl("th", null, t)));
  thead.appendChild(trh);
  table.appendChild(thead);
  const tbody = makeEl("tbody");
  keys.forEach((k) => {
    const tr = document.createElement("tr");
    tr.appendChild(makeEl("td", null, laneLabel(k)));
    const tdSt = document.createElement("td");
    tdSt.appendChild(statusPill(status[k]));
    tr.appendChild(tdSt);
    const tdUrl = document.createElement("td");
    const url = sources[k];
    if (typeof url === "string" && url) {
      const a = makeEl("a", null, url);
      a.href = url;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      tdUrl.appendChild(a);
    } else {
      tdUrl.appendChild(makeEl("span", "muted", "—"));
    }
    tr.appendChild(tdUrl);
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);
  root.appendChild(table);
}

function renderTeam(name, team, data) {
  const card = makeEl("div", "card");
  card.appendChild(makeEl("h2", null, name));
  card.appendChild(makeEl("p", null, team && team.headline ? team.headline : "No headline available."));
  card.appendChild(makeEl("p", "muted", "Emotion: " + ((team && team.emotion) || "n/a")));

  card.appendChild(makeEl("h3", null, "Verified notes"));
  const v = makeEl("ul");
  ((team && team.verified_notes) || []).forEach((x) => v.appendChild(liNode(x)));
  if (!((team && team.verified_notes) || []).length) {
    v.appendChild(makeEl("li", "muted", "No verified notes."));
  }
  card.appendChild(v);

  // Reword empty unverified: never show "UNVERIFIED: No ... listed".
  const unv = (team && team.unverified_notes) || [];
  if (unv.length > 0) {
    card.appendChild(makeEl("h3", null, "Unverified notes"));
    const u = makeEl("ul");
    unv.forEach((x) => u.appendChild(liNode(x, { unv: true })));
    card.appendChild(u);
  } else {
    card.appendChild(makeEl("p", "muted", "No unverified notes."));
  }

  // Compact / collapsible source health.
  const details = document.createElement("details");
  const summary = makeEl("summary", null, "Source health");
  details.appendChild(summary);
  const sh = makeEl("div");
  const teamStatus = (team && team.source_status) || {};
  const teamKeys = Object.keys(teamStatus);
  const shHostId = "sh-" + name.replace(/[^a-z0-9]/gi, "-");
  sh.id = shHostId;
  details.appendChild(sh);
  card.appendChild(details);
  renderSourceHealth(shHostId, data, teamKeys);

  return card;
}

function computeHealth(data) {
  const issues = [];
  if (!data || typeof data !== "object") return { ok: false, issues: ["snapshot missing"] };

  const ts = data.generated_at;
  if (typeof ts === "string" && ts) {
    const parsed = Date.parse(ts.endsWith("Z") ? ts : ts.replace(/([+-]\d\d):?(\d\d)$/, "$1$2"));
    if (Number.isFinite(parsed)) {
      const ageMin = (Date.now() - parsed) / 60000;
      if (ageMin > STALE_AFTER_MIN) issues.push("snapshot is " + Math.round(ageMin / 60) + "h old");
    } else {
      issues.push("generated_at not parseable");
    }
  } else {
    issues.push("generated_at missing");
  }

  const ss = data.source_status || {};
  const lanes = Object.values(ss);
  const verifiedLanes = lanes.filter((s) => s === "verified").length;
  const errorLanes = lanes.filter((s) => s === "source_error").length;
  if (lanes.length > 0 && verifiedLanes / lanes.length < 0.5) {
    issues.push("mostly unverified (" + verifiedLanes + "/" + lanes.length + " verified)");
  }
  if (errorLanes > 0) issues.push(errorLanes + " source_error lane(s)");

  const lu = (data.league && data.league.unverified_notes) || [];
  if (Array.isArray(lu) && lu.some((x) => typeof x === "string" && x.indexOf("UNVERIFIED: sample") !== -1)) {
    issues.push("placeholder fixture detected");
  }

  return { ok: issues.length === 0, issues: issues };
}

function renderHealth(data) {
  const root = el("health");
  if (!root) return;
  while (root.firstChild) root.removeChild(root.firstChild);
  const h = computeHealth(data);
  if (h.ok) {
    root.appendChild(makeEl("span", "ok", "Sources healthy."));
  } else {
    root.appendChild(makeEl("div", "warn", "Source health warning: " + h.issues.join("; ")));
  }
}

// --- show generator wiring ---

function detectAvailableTeams(data) {
  const teams = (data && data.teams) || {};
  return Object.keys(teams);
}

function selectedTeams() {
  const root = el("teamLanes");
  if (!root) return [];
  const inputs = root.querySelectorAll("input[type=checkbox]");
  const out = [];
  inputs.forEach((i) => { if (i.checked) out.push(i.value); });
  return out;
}

function selectedPreset() {
  const root = el("presetSelect");
  return root ? root.value : "standard";
}

function renderRundownInto(rootId, rundown) {
  const root = el(rootId);
  if (!root) return;
  while (root.firstChild) root.removeChild(root.firstChild);

  const header = makeEl("p", "muted",
    rundown.presetLabel + " — target " + rundown.targetMinutes + " min, allocated " + rundown.totalMinutes + " min."
  );
  root.appendChild(header);

  let cumulative = 0;
  rundown.segments.forEach((seg, idx) => {
    const start = cumulative;
    cumulative += seg.durationMinutes;

    const segCard = makeEl("div", "seg");
    const h = makeEl("h3", null,
      (idx + 1) + ". " + seg.title +
      " (" + start + "–" + cumulative + " min)"
    );
    segCard.appendChild(h);
    const conf = makeEl("p", "muted", "Source confidence: " +
      (window.BDShowGenerator
        ? window.BDShowGenerator.summarizeConfidence(CURRENT_SNAPSHOT, seg)
        : "n/a")
    );
    segCard.appendChild(conf);
    const ul = makeEl("ul");
    seg.lines.forEach((l) => {
      const li = document.createElement("li");
      li.textContent = l;
      ul.appendChild(li);
    });
    segCard.appendChild(ul);
    root.appendChild(segCard);
  });
}

function renderLivestreamPackage(pkg) {
  const titleField = el("liveTitleField");
  const shortField = el("liveShortField");
  const longField = el("liveLongField");
  const teaserField = el("liveTeaserField");
  if (titleField) titleField.value = pkg.title || "";
  if (shortField) shortField.value = pkg.shortDescription || "";
  if (longField) longField.value = pkg.longDescription || "";
  if (teaserField) teaserField.value = pkg.teaser || "";

  const warn = el("livePkgWarn");
  if (warn) {
    while (warn.firstChild) warn.removeChild(warn.firstChild);
    if (pkg.producerWarning) {
      warn.appendChild(makeEl("div", "live-warn", pkg.producerWarning));
    }
  }
}

function regenerateRundown() {
  if (!CURRENT_SNAPSHOT) return;
  const opts = { preset: selectedPreset(), teams: selectedTeams() };
  const rundown = window.BDShowGenerator.generateRundown(CURRENT_SNAPSHOT, opts);
  CURRENT_RUNDOWN = rundown;
  renderRundownInto("rundownOut", rundown);
  // Update host script preview as well.
  const script = window.BDShowGenerator.renderTeleprompter(rundown, CURRENT_SNAPSHOT);
  const host = el("hostScriptOut");
  if (host) host.textContent = script;
  // Refresh livestream metadata package alongside the rundown.
  CURRENT_LIVE_PKG = window.BDShowGenerator.generateLivestreamPackage(
    CURRENT_SNAPSHOT, rundown, { teams: opts.teams }
  );
  renderLivestreamPackage(CURRENT_LIVE_PKG);
}

function copyToClipboard(text) {
  if (navigator && navigator.clipboard && navigator.clipboard.writeText) {
    return navigator.clipboard.writeText(text);
  }
  // Fallback: temporary textarea, no innerHTML.
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.style.position = "fixed";
  ta.style.opacity = "0";
  document.body.appendChild(ta);
  ta.select();
  try { document.execCommand("copy"); } catch (e) { /* ignore */ }
  document.body.removeChild(ta);
  return Promise.resolve();
}

function flashStatus(msg) {
  const root = el("genStatus");
  if (!root) return;
  root.textContent = msg;
  setTimeout(() => { if (root.textContent === msg) root.textContent = ""; }, 2500);
}

function copyRundown() {
  if (!CURRENT_RUNDOWN) return;
  const text = window.BDShowGenerator.renderRundownText(CURRENT_RUNDOWN);
  copyToClipboard(text).then(() => flashStatus("Rundown copied."));
}

function copyTeleprompter() {
  if (!CURRENT_RUNDOWN) return;
  const text = window.BDShowGenerator.renderTeleprompter(CURRENT_RUNDOWN, CURRENT_SNAPSHOT);
  copyToClipboard(text).then(() => flashStatus("Host script copied."));
}

function flashLiveStatus(msg) {
  const root = el("liveStatus");
  if (!root) { flashStatus(msg); return; }
  root.textContent = msg;
  setTimeout(() => { if (root.textContent === msg) root.textContent = ""; }, 2500);
}

function ensureRundown() {
  if (CURRENT_RUNDOWN) return true;
  if (CURRENT_SNAPSHOT) regenerateRundown();
  return !!CURRENT_RUNDOWN;
}

function copyLiveField(fieldId, label) {
  const node = el(fieldId);
  if (!node) return;
  const value = node.value != null ? node.value : "";
  if (!value) { flashLiveStatus(label + " is empty — generate a rundown first."); return; }
  copyToClipboard(value).then(() => flashLiveStatus(label + " copied."));
}

function copyLiveAll() {
  if (!ensureRundown() || !CURRENT_LIVE_PKG) {
    flashLiveStatus("No livestream metadata yet — generate a rundown first.");
    return;
  }
  // Re-read the editable fields so producer edits are preserved.
  const t = el("liveTitleField"); const s = el("liveShortField");
  const l = el("liveLongField"); const te = el("liveTeaserField");
  const pkg = {
    title: t ? t.value : CURRENT_LIVE_PKG.title,
    shortDescription: s ? s.value : CURRENT_LIVE_PKG.shortDescription,
    longDescription: l ? l.value : CURRENT_LIVE_PKG.longDescription,
    teaser: te ? te.value : CURRENT_LIVE_PKG.teaser,
    prettyDate: CURRENT_LIVE_PKG.prettyDate,
    producerWarning: CURRENT_LIVE_PKG.producerWarning,
  };
  const text = window.BDShowGenerator.renderLivestreamMarkdown(pkg);
  copyToClipboard(text).then(() => flashLiveStatus("Livestream metadata copied."));
}

// Trigger a client-side download of `text` as `filename`. Uses Blob + object
// URL only — no third-party deps, no network.
function triggerDownload(filename, text, mime) {
  if (typeof text !== "string" || text.length === 0) {
    flashStatus("Nothing to download.");
    return false;
  }
  const blob = new Blob([text], { type: (mime || "text/markdown") + ";charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // Defer revoke so the browser has time to start the download.
  setTimeout(() => { try { URL.revokeObjectURL(url); } catch (e) { /* ignore */ } }, 1000);
  return true;
}

function currentDateStr() {
  if (CURRENT_LIVE_PKG && CURRENT_LIVE_PKG.showDate) return CURRENT_LIVE_PKG.showDate;
  if (CURRENT_SNAPSHOT && typeof CURRENT_SNAPSHOT.generated_at === "string") {
    return CURRENT_SNAPSHOT.generated_at.slice(0, 10);
  }
  return "";
}

function downloadRundown() {
  if (!ensureRundown()) { flashStatus("Generate a rundown first."); return; }
  const md = window.BDShowGenerator.renderRundownMarkdown(CURRENT_RUNDOWN);
  const fn = window.BDShowGenerator.buildFilename(
    CURRENT_RUNDOWN.presetKey, currentDateStr(), "rundown", "md"
  );
  if (triggerDownload(fn, md)) flashStatus("Rundown downloaded.");
}

function downloadHostScript() {
  if (!ensureRundown()) { flashStatus("Generate a rundown first."); return; }
  const md = window.BDShowGenerator.renderHostScriptMarkdown(CURRENT_RUNDOWN, CURRENT_SNAPSHOT);
  const fn = window.BDShowGenerator.buildFilename(
    CURRENT_RUNDOWN.presetKey, currentDateStr(), "host-script", "md"
  );
  if (triggerDownload(fn, md)) flashStatus("Host script downloaded.");
}

function downloadLivestream() {
  if (!ensureRundown() || !CURRENT_LIVE_PKG) {
    flashStatus("Generate a rundown first.");
    return;
  }
  // Pick up any producer edits to the editable fields.
  const t = el("liveTitleField"); const s = el("liveShortField");
  const l = el("liveLongField"); const te = el("liveTeaserField");
  const pkg = Object.assign({}, CURRENT_LIVE_PKG, {
    title: t ? t.value : CURRENT_LIVE_PKG.title,
    shortDescription: s ? s.value : CURRENT_LIVE_PKG.shortDescription,
    longDescription: l ? l.value : CURRENT_LIVE_PKG.longDescription,
    teaser: te ? te.value : CURRENT_LIVE_PKG.teaser,
  });
  const md = window.BDShowGenerator.renderLivestreamMarkdown(pkg);
  const fn = window.BDShowGenerator.buildFilename(
    CURRENT_RUNDOWN.presetKey, currentDateStr(), "livestream-metadata", "md"
  );
  if (triggerDownload(fn, md)) flashStatus("Livestream metadata downloaded.");
}

function downloadCompletePackage() {
  if (!ensureRundown() || !CURRENT_LIVE_PKG) {
    flashStatus("Generate a rundown first.");
    return;
  }
  const t = el("liveTitleField"); const s = el("liveShortField");
  const l = el("liveLongField"); const te = el("liveTeaserField");
  const pkg = Object.assign({}, CURRENT_LIVE_PKG, {
    title: t ? t.value : CURRENT_LIVE_PKG.title,
    shortDescription: s ? s.value : CURRENT_LIVE_PKG.shortDescription,
    longDescription: l ? l.value : CURRENT_LIVE_PKG.longDescription,
    teaser: te ? te.value : CURRENT_LIVE_PKG.teaser,
  });
  const md = window.BDShowGenerator.renderCompletePackageMarkdown(
    CURRENT_SNAPSHOT, CURRENT_RUNDOWN, pkg
  );
  const fn = window.BDShowGenerator.buildFilename(
    CURRENT_RUNDOWN.presetKey, currentDateStr(), "show-package", "md"
  );
  if (triggerDownload(fn, md)) flashStatus("Show package downloaded.");
}

function buildPrintHostSheet(rundown, snapshot) {
  // Produce the printable host sheet DOM in-page. Uses textContent only —
  // never innerHTML — so snapshot fields can't inject markup.
  const root = el("printHostSheet");
  if (!root) return null;
  while (root.firstChild) root.removeChild(root.firstChild);

  root.appendChild(makeEl("h1", null, "BD Baseball — Host Sheet"));

  const meta = makeEl("div", "meta");
  const stamp = (snapshot && snapshot.generated_at) || "snapshot timestamp unavailable";
  meta.appendChild(makeEl("div", null, "Snapshot: " + stamp));
  meta.appendChild(makeEl("div", null,
    "Format: " + rundown.presetLabel +
    "  •  Target " + rundown.targetMinutes + " min" +
    "  •  Allocated " + rundown.totalMinutes + " min"
  ));
  const teams = (rundown.teams || []).map((t) => window.BDShowGenerator.TEAM_DISPLAY[t] || t);
  meta.appendChild(makeEl("div", null, "Focus teams: " + (teams.length ? teams.join(", ") : "(none)")));
  root.appendChild(meta);

  root.appendChild(makeEl("h2", null, "Rundown"));
  const rundownPre = makeEl("pre");
  rundownPre.textContent = window.BDShowGenerator.renderRundownText(rundown);
  root.appendChild(rundownPre);

  root.appendChild(makeEl("h2", null, "Host script"));
  const scriptPre = makeEl("pre");
  scriptPre.textContent = window.BDShowGenerator.renderTeleprompter(rundown, snapshot);
  root.appendChild(scriptPre);

  return root;
}

function printHostSheet() {
  if (!CURRENT_RUNDOWN) {
    if (CURRENT_SNAPSHOT) {
      regenerateRundown();
    }
    if (!CURRENT_RUNDOWN) {
      flashStatus("No rundown to print — generate one first.");
      return;
    }
  }
  const root = buildPrintHostSheet(CURRENT_RUNDOWN, CURRENT_SNAPSHOT);
  if (!root) { flashStatus("Print sheet unavailable."); return; }
  document.body.classList.add("printing-host");
  const cleanup = () => {
    document.body.classList.remove("printing-host");
    window.removeEventListener("afterprint", cleanup);
  };
  window.addEventListener("afterprint", cleanup);
  // Fallback cleanup in case afterprint doesn't fire (Safari quirks).
  setTimeout(cleanup, 60000);
  // Defer print to next frame so the layout switch is committed before
  // the print dialog snapshots the DOM.
  setTimeout(() => {
    try { window.print(); } catch (e) { cleanup(); }
  }, 50);
}

function buildTeamLaneCheckboxes(available) {
  const root = el("teamLanes");
  if (!root) return;
  while (root.firstChild) root.removeChild(root.firstChild);
  if (!available.length) {
    root.appendChild(makeEl("span", "muted", "No team lanes in snapshot."));
    return;
  }
  available.forEach((t) => {
    const id = "lane-" + t;
    const wrap = makeEl("label", "lane-pick");
    wrap.setAttribute("for", id);
    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.id = id;
    cb.value = t;
    cb.checked = true; // Default: full show with all configured teams.
    cb.addEventListener("change", regenerateRundown);
    wrap.appendChild(cb);
    wrap.appendChild(document.createTextNode(" " + (window.BDShowGenerator.TEAM_DISPLAY[t] || t)));
    root.appendChild(wrap);
  });
}

function wireGeneratorControls(data) {
  const presetSel = el("presetSelect");
  if (presetSel) presetSel.addEventListener("change", regenerateRundown);

  const genBtn = el("genBtn");
  if (genBtn) genBtn.addEventListener("click", regenerateRundown);

  const copyR = el("copyRundownBtn");
  if (copyR) copyR.addEventListener("click", copyRundown);

  const copyT = el("copyTeleBtn");
  if (copyT) copyT.addEventListener("click", copyTeleprompter);

  const printB = el("printHostBtn");
  if (printB) printB.addEventListener("click", printHostSheet);

  const dlR = el("dlRundownBtn");
  if (dlR) dlR.addEventListener("click", downloadRundown);
  const dlH = el("dlHostBtn");
  if (dlH) dlH.addEventListener("click", downloadHostScript);
  const dlL = el("dlLiveBtn");
  if (dlL) dlL.addEventListener("click", downloadLivestream);
  const dlP = el("dlPackageBtn");
  if (dlP) dlP.addEventListener("click", downloadCompletePackage);

  const cTitle = el("copyLiveTitleBtn");
  if (cTitle) cTitle.addEventListener("click", () => copyLiveField("liveTitleField", "Title"));
  const cShort = el("copyLiveShortBtn");
  if (cShort) cShort.addEventListener("click", () => copyLiveField("liveShortField", "Short description"));
  const cLong = el("copyLiveLongBtn");
  if (cLong) cLong.addEventListener("click", () => copyLiveField("liveLongField", "Full description"));
  const cTeaser = el("copyLiveTeaserBtn");
  if (cTeaser) cTeaser.addEventListener("click", () => copyLiveField("liveTeaserField", "Teaser"));
  const cAll = el("copyLiveAllBtn");
  if (cAll) cAll.addEventListener("click", copyLiveAll);

  buildTeamLaneCheckboxes(detectAvailableTeams(data));
  regenerateRundown();
}


function setupTabs() {
  const tabs = Array.from(document.querySelectorAll('[role="tab"]'));
  const panels = Array.from(document.querySelectorAll('[role="tabpanel"]'));
  if (!tabs.length || !panels.length) return;

  function activate(tab) {
    tabs.forEach((t) => {
      const on = t === tab;
      t.setAttribute('aria-selected', on ? 'true' : 'false');
      t.tabIndex = on ? 0 : -1;
      const panelId = t.getAttribute('aria-controls');
      const panel = panelId ? el(panelId) : null;
      if (panel) panel.classList.toggle('active', on);
    });
  }

  tabs.forEach((tab, idx) => {
    tab.tabIndex = idx === 0 ? 0 : -1;
    tab.addEventListener('click', () => activate(tab));
    tab.addEventListener('keydown', (e) => {
      const i = tabs.indexOf(tab);
      if (e.key === 'ArrowRight') { e.preventDefault(); const n = tabs[(i + 1) % tabs.length]; n.focus(); activate(n); }
      if (e.key === 'ArrowLeft') { e.preventDefault(); const n = tabs[(i - 1 + tabs.length) % tabs.length]; n.focus(); activate(n); }
      if (e.key === 'Home') { e.preventDefault(); tabs[0].focus(); activate(tabs[0]); }
      if (e.key === 'End') { e.preventDefault(); tabs[tabs.length - 1].focus(); activate(tabs[tabs.length - 1]); }
    });
  });
  activate(el('tab-show-prep') || tabs[0]);
}

function renderReferenceAndBets(data) {
  const structured = partitionStructuredLeague(data);
  renderStandingsTable('leagueStandings', structured.standings);
  fillList('leagueProbables', structured.probables.map((p) => (
    cleanFeedText(
      p.awayTeam + ' (' + p.awayPitcher + ') @ ' + p.homeTeam + ' (' + p.homePitcher + ') — ' + formatGameTime(p.time)
    )
  )), 'No probable pitchers available.');
  fillList('leagueTx', structured.transactions.slice(0, 25).map((t) => cleanFeedText(t.date + ': ' + t.detail)), 'No transactions in window.');

  const teamSelect = el('refTeamSelect');
  const teamRef = el('teamReference');
  if (teamSelect && teamRef) {
    while (teamSelect.firstChild) teamSelect.removeChild(teamSelect.firstChild);
    const entries = Object.entries((data && data.teams) || {});
    entries.forEach(([key]) => {
      const opt = document.createElement('option');
      opt.value = key; opt.textContent = window.BDShowGenerator.TEAM_DISPLAY[key] || key;
      teamSelect.appendChild(opt);
    });
    const renderTeamRef = () => {
      while (teamRef.firstChild) teamRef.removeChild(teamRef.firstChild);
      const k = teamSelect.value;
      if (k && data.teams && data.teams[k]) teamRef.appendChild(renderTeam(k, data.teams[k], data));
    };
    teamSelect.onchange = renderTeamRef;
    renderTeamRef();
  }

  const cardsRoot = el('betsCard');
  if (cardsRoot) {
    while (cardsRoot.firstChild) cardsRoot.removeChild(cardsRoot.firstChild);
    const standingsMap = new Map(structured.standings.map((s) => [s.team, s]));
    const watch = new Set(((data && data.league && data.league.watch) || []).map(String));
    structured.probables.forEach((g, idx) => {
      const card = makeEl('div', 'card');
      card.appendChild(makeEl('h3', null, g.awayTeam + ' @ ' + g.homeTeam));
      const awayRec = standingsMap.get(g.awayTeam); const homeRec = standingsMap.get(g.homeTeam);
      card.appendChild(makeEl('p', 'muted',
        (awayRec ? (awayRec.wins + '-' + awayRec.losses) : 'Record n/a') + ' vs ' + (homeRec ? (homeRec.wins + '-' + homeRec.losses) : 'Record n/a')
      ));
      card.appendChild(makeEl('p', null, 'Probables: ' + g.awayPitcher + ' vs ' + g.homePitcher));
      const status = classifyGameStatus(g.time);
      const statusLabel = status === "upcoming" ? "Upcoming" : (status === "inprogress" ? "In progress" : "Final");
      card.appendChild(makeEl('p', null, cleanFeedText('Status: ' + statusLabel + ' • ' + formatGameTime(g.time))));
      const tags = [];
      if (idx < 2) tags.push('Featured');
      if (watch.has('Probable: ' + g.awayTeam + ' (' + g.awayPitcher + ') @ ' + g.homeTeam + ' (' + g.homePitcher + ') — Scheduled ' + g.time + ' ' + g.venue)) tags.push('Watchlist');
      if (awayRec && homeRec && awayRec.gb !== '-' && homeRec.gb !== '-') tags.push('Division');
      const tagRow = makeEl('p', 'muted', tags.length ? tags.join(' • ') : 'Snapshot card');
      card.appendChild(tagRow);
      cardsRoot.appendChild(card);
    });
    if (!structured.probables.length) cardsRoot.appendChild(makeEl('p','muted','No matchups available in snapshot.'));
  }

  const newsRoot = el('newsList');
  const newsStatus = el('newsStatus');
  if (newsRoot) while (newsRoot.firstChild) newsRoot.removeChild(newsRoot.firstChild);
  const newsItems = Array.isArray(data && data.news) ? data.news : [];
  const newsState = (data && data.news_status) || 'unverified';
  if (newsStatus) {
    if (newsState === 'source_error') newsStatus.textContent = 'News source unavailable during snapshot build. Showing fallback.';
    else if (newsItems.length) newsStatus.textContent = 'Latest MLB headlines from the snapshot feed.';
    else newsStatus.textContent = 'No MLB headlines were returned in this snapshot.';
  }
  if (!newsItems.length) {
    if (newsRoot) newsRoot.appendChild(makeEl('li', 'muted', 'No news items available right now.'));
  } else {
    newsItems.forEach((item) => {
      const li = document.createElement('li');
      const a = makeEl('a', null, cleanFeedText(item.headline || 'Untitled'));
      a.href = item.url || '#';
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      li.appendChild(a);
      const published = item.published_at ? formatGameTime(item.published_at) : 'publish time unavailable';
      const meta = cleanFeedText([item.source || 'MLB.com', published].join(' • '));
      li.appendChild(makeEl('div', 'muted', meta));
      if (newsRoot) newsRoot.appendChild(li);
    });
  }
}


async function load() {
  try {
    const res = await fetch("./data/latest.json", { cache: "no-store" });
    const snapshotSource = res.headers.get("X-BD-Snapshot-Source");
    if (!res.ok) throw new Error("HTTP " + res.status);
    const data = await res.json();
    CURRENT_SNAPSHOT = data;

    setText("stamp", data.generated_at || "missing");
    renderHealth(data);
    if (snapshotSource === "cache-fallback") {
      setText("offline", "Using cached snapshot fallback while network is unavailable.");
    } else if (snapshotSource === "unavailable") {
      setText("offline", "Snapshot source unavailable; showing best available fallback.");
    }

    setText("leagueHeadline", (data.league && data.league.headline) || "Not confirmed from available sources.");
    fillList("leagueVerified", data.league && data.league.verified_notes, "No verified league notes.");

    // Reword empty unverified at the league level too.
    const lUnv = (data.league && data.league.unverified_notes) || [];
    const lUnvHeader = el("leagueUnvHeader");
    const lUnvList = el("leagueUnverified");
    const lUnvEmpty = el("leagueUnvEmpty");
    if (lUnv.length === 0) {
      if (lUnvList) lUnvList.style.display = "none";
      if (lUnvEmpty) lUnvEmpty.textContent = "No unverified notes.";
    } else {
      if (lUnvEmpty) lUnvEmpty.textContent = "";
      if (lUnvList) lUnvList.style.display = "";
      fillList("leagueUnverified", lUnv, "No unverified notes.");
    }
    void lUnvHeader; // header always present; structure is consistent.

    fillList("leagueTx", data.league && data.league.transactions, "No transactions in window.");

    const leagueKeys = Object.keys(data.source_status || {}).filter((k) => k.startsWith("league_"));
    renderSourceHealth("sourceStatus", data, leagueKeys);

    renderReferenceAndBets(data);

    wireGeneratorControls(data);
  } catch (e) {
    setText("stamp", "load failed");
    setText("leagueHeadline", "UNVERIFIED: Snapshot could not be loaded.");
    const root = el("health");
    while (root.firstChild) root.removeChild(root.firstChild);
    root.appendChild(makeEl("div", "warn", "Snapshot load failed: " + (e && e.message ? e.message : "unknown error")));
  }
}

window.addEventListener("online", () => setText("offline", ""));
window.addEventListener("offline", () => setText("offline", "Offline mode: showing cached shell/snapshot when available."));
if ("serviceWorker" in navigator) { navigator.serviceWorker.register("./sw.js"); }
setupTabs();
load();


if (typeof module !== 'undefined' && module.exports) {
  module.exports = { parseStandingsNote, parseProbableNote, parseTransactionNote, partitionStructuredLeague };
}
