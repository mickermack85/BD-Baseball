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
