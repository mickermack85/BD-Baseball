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

function printHostSheet() {
  if (!CURRENT_RUNDOWN) return;
  const text = window.BDShowGenerator.renderTeleprompter(CURRENT_RUNDOWN, CURRENT_SNAPSHOT);
  const w = window.open("", "_blank", "noopener");
  if (!w) { flashStatus("Print blocked — allow popups."); return; }
  // Build the print doc with DOM APIs only — never innerHTML interpolation.
  const doc = w.document;
  doc.title = "BD Baseball Host Sheet";
  const style = doc.createElement("style");
  style.textContent =
    "body{font-family:ui-monospace,Menlo,monospace;white-space:pre-wrap;padding:24px;font-size:12pt;color:#000;background:#fff}" +
    "@media print{body{padding:0}}";
  doc.head.appendChild(style);
  const pre = doc.createElement("pre");
  pre.textContent = text;
  doc.body.appendChild(pre);
  w.focus();
  setTimeout(() => { try { w.print(); } catch (e) { /* ignore */ } }, 100);
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

  buildTeamLaneCheckboxes(detectAvailableTeams(data));
  regenerateRundown();
}

async function load() {
  try {
    const res = await fetch("./data/latest.json", { cache: "no-store" });
    if (!res.ok) throw new Error("HTTP " + res.status);
    const data = await res.json();
    CURRENT_SNAPSHOT = data;

    setText("stamp", data.generated_at || "missing");
    renderHealth(data);

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

    const teams = el("teams");
    while (teams.firstChild) teams.removeChild(teams.firstChild);
    Object.entries(data.teams || {}).forEach(([k, v]) => teams.appendChild(renderTeam(k, v, data)));

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
load();
