# BD Baseball Show Prep PWA

Static, Vercel-deployable PWA that turns a verified MLB Stats API snapshot
into a daily-show **rundown + host/teleprompter script**, backed by a Python
snapshot builder that reads the public **MLB Stats API** (`statsapi.mlb.com`).

## What it does
- Pulls a once-or-twice-a-day verified snapshot (standings, today's slate
  with probable pitchers, transactions, per-team blocks).
- Generates a deterministic, timed daily-show rundown from that snapshot —
  no LLM, no paid APIs, no server. Pure functions in the browser.
- Produces spoken host copy / teleprompter text with per-segment source
  confidence labels.
- Keeps the source-health / data confidence panels available below as a
  reference layer for the producer.

## Architecture
- `scripts/build_snapshot.py` — fetches standings, schedule (with probable
  pitchers), and transactions from the MLB Stats API JSON endpoints. Lanes
  that fail return explicit `UNVERIFIED:` / `source_error` entries; nothing
  is faked as verified.
- `scripts/validate_snapshot.py` — schema + content gates. `--strict`
  enforces freshness, allowed `source_status` values, ≥1 verified note per
  configured team, and a minimum number of verified lanes.
- `tests/` — `unittest` tests for parsers, builder (with fake fetch),
  validator. No third-party test deps.
- `.github/workflows/ci.yml` — runs tests and validation on every PR/push.
- `.github/workflows/refresh-snapshot.yml` — scheduled (and `workflow_dispatch`)
  job that builds, strict-validates, and commits an updated snapshot using
  the built-in `GITHUB_TOKEN`.
- `data/latest.json` — current snapshot consumed by the frontend.
- `index.html` — static shell. Hosts the show-generator UI on top and the
  league/team reference panels below. Uses safe DOM construction
  (no `innerHTML` interpolation of snapshot fields).
- `show_generator.js` — pure-function rundown / teleprompter generator.
  Inputs: snapshot + options (`preset`, `teams`). Outputs: timed segment
  list, plain-text rundown, plain-text host script, plus a livestream
  metadata package (title, short / long description, teaser) and
  Markdown renderers for each output. Importable in Node for tests;
  also exposed as `window.BDShowGenerator`.
- `app.js` — frontend wiring: loads `data/latest.json`, renders the
  generator controls and outputs, and renders the source-health /
  verified-notes reference panels (compact / collapsible). Empty
  unverified sections are reworded to "No unverified notes." rather
  than rendering a fake `UNVERIFIED: No ... listed` bullet.
- `sw.js` — versioned caches (separate shell + data caches). Static
  shell is cache-first. `/data/latest.json` is stale-while-revalidate
  with a 4s network timeout, so flaky Wi-Fi falls back to the cached
  snapshot quickly instead of hanging the page.

## No third-party runtime keys
The builder uses only public, unauthenticated `statsapi.mlb.com` endpoints.
There are no API keys, paid services, or databases in this pipeline.

## Local dev

### Install Python deps (none required for the builder)
The builder uses only the standard library. The legacy `requests` /
`beautifulsoup4` deps in `requirements.txt` are no longer needed by the
builder; tests are stdlib-only too.

```bash
python -m venv .venv
source .venv/bin/activate
# requirements.txt is intentionally minimal/empty for the new pipeline.
```

### Build a fresh snapshot from the live MLB Stats API
```bash
python scripts/build_snapshot.py
```
Writes:
- `data/latest.json`
- `data/mlb_snapshot_YYYY-MM-DD.json`

### Validate
Lenient (schema-only):
```bash
python scripts/validate_snapshot.py
```

Strict (schema + freshness + content gates):
```bash
python scripts/validate_snapshot.py \
    --strict \
    --max-age-minutes 60 \
    --min-verified-lanes 6
```

### Run tests
```bash
python -m unittest discover -s tests -v
```

### Local frontend smoke
```bash
python -m http.server 8080
# open http://localhost:8080
```
For offline frontend smoke testing without network, copy the fixture:
```bash
cp fixtures/sample_snapshot.json data/latest.json
```
(The fixture is structurally valid but its `generated_at` is frozen in 2026,
so it will trigger the stale-source warning banner in the UI — that's
expected.)

## CI and scheduled refresh
- `CI` (`.github/workflows/ci.yml`) runs on PR/push: tests + lenient
  validation of the committed snapshot + strict validation of the fixture.
- `Refresh snapshot (.github/workflows/refresh-snapshot.yml) runs nightly at 03:15 UTC and on manual workflow_dispatch`. It builds,
  strict-validates, and only commits if validation passes. Uses the built-in
  `GITHUB_TOKEN` — no extra secrets required.

## Deploy to Vercel
1. Push to GitHub.
2. Import repo in Vercel as a static project.
3. No build command. Output directory: repo root.

## Security / token rotation note
**Important:** A previous version of this project shipped an `.mcp.json`
file containing a hardcoded Perplexity `AUTH_TOKEN` in this public
repository. That token must be considered compromised regardless of
whether it has been removed from the working tree or git history.

**Action required (manual, one-time):**
1. Sign in to your Perplexity account and **rotate / revoke** the leaked
   token immediately. This step cannot be automated by the codebase.
2. Re-issue any local `.mcp.json` with a new token. `.mcp.json` is now in
   `.gitignore` so it cannot be re-committed accidentally.
3. If you want to fully scrub the leaked token from past commits, you'll
   need to rewrite history (e.g. with `git filter-repo`) and force-push;
   that's deliberately out of scope for this PR because rewriting public
   history is destructive and cannot be done blindly.

## Troubleshooting
- If a source is unavailable, lanes are labeled `source_error` /
  `UNVERIFIED:` and the UI shows a source-health warning banner.
- Inspect `data/latest.json` → `debug.source_health` and `source_status`
  for exact failure modes. Each lane includes `status`, `url`, `debug`
  counters, and a small `verified_sample` / `unverified_sample` for spot
  checks. (Full per-lane note arrays are intentionally not shipped — they
  bloated the snapshot on busy transactions days.)
- If a deploy looks stale, reload once so the updated service worker
  takes control.

## Producer workflow (daily show)

The whole flow happens in the browser. No terminal, no logins.

1. **Open the app.** The header shows the snapshot timestamp and a green
   **"Sources healthy."** pill (or a red warning if the snapshot is stale
   or any lane errored — see the runbook below).
2. **Pick a format.** Use the **Format** dropdown in the **Show Generator**
   card: 15-min Quick Hit, 25-min Standard, or 35-min Deep Show. The
   rundown regenerates automatically.
3. **Pick focus teams.** The **Focus teams** chips default to all
   configured teams (Athletics / Rockies / Tigers). Untick any you don't
   want a homer block for. The team segments reorder accordingly.
4. **Generate / regenerate.** Use the **Generate rundown** button if you
   change controls and want a fresh run. Each segment shows a "Source
   confidence" line so you can see at a glance which lanes were verified.
5. **Copy or print for air.**
   - **Copy rundown** — producer-facing, with per-segment time blocks
     and bullet points.
   - **Copy host script** — spoken copy with section headers and
     transition cues, ready to paste into a teleprompter system.
   - **Print host sheet** — opens a clean monospace print view of the
     host script and triggers the browser print dialog.
6. **Review the livestream package.** The **Livestream package** card
   below the rundown shows producer copy derived from the same
   verified snapshot:
   - **Title** — YouTube/Rumble-style, capped at 100 chars, derived
     from the strongest verified hook (focus-team matchup → top of
     standings → number of probables).
   - **Short description** — 1–2 sentence summary for cross-posting.
   - **Full description** — episode summary, segment timestamps,
     standings hook, today's slate, source-confidence note, and CTA
     placeholders the producer fills in (Substack, X, Discord).
   - **Teaser** — single-line teaser/social/Substack post copy.
   Each field has a **Copy** button; **Copy all livestream metadata**
   bundles the whole package as Markdown. Edit the fields freely
   before copying — edits are picked up by the copy and download
   buttons. If the snapshot is unhealthy, a producer-only warning
   appears at the top of the card; the public title is never
   contaminated with warning copy.
7. **Download platform assets.** Under the show generator there are
   four **Download** buttons that emit Markdown via Blob URL — no
   network round-trip:
   - **Download rundown (.md)** — producer rundown.
   - **Download host script (.md)** — host/teleprompter copy.
   - **Download livestream metadata (.md)** — title + descriptions +
     teaser, picking up any edits in the Livestream package card.
   - **Download complete show package (.md)** — title block,
     descriptions, rundown, host script, and a source-health summary
     in one document.
   Filenames are date- and preset-derived, e.g.
   `bd-baseball-2026-05-01-standard-show-package.md`. Downloads are
   blocked when no rundown has been generated yet (a status line
   tells you to generate first), so you never end up with a blank
   file.
8. **Spot-check below.** The **League reference** card (collapsed
   sub-sections) and per-team cards still show every verified note plus
   per-lane source-health status. Use these to verify anything the
   generator pulled.

The generator is fully deterministic: same snapshot + same options
produces the same rundown. It will gracefully degrade when lanes are
empty (e.g. off-day with no probables) — sections that have nothing
verified say so in plain English instead of inventing content.

## Show-day runbook

Quick checklist for the producer to run before air. All checks happen in
the browser — no terminal access required.

### What "green" looks like
- Snapshot stamp shows a fresh ISO timestamp (within the last few hours).
- The header shows the green **"Sources healthy."** pill.
- The League "Source health" table shows **verified** for standings,
  schedule, transactions.
- Each team card's "Source health" table shows **verified** on its three
  lanes (`*_standings`, `*_schedule`, `*_transactions`).
- No lane row is rendered with the red **source error** pill or yellow
  **unverified** pill.

### What "stale" / "unverified" mean
- **stale** — the red banner reads `snapshot is Nh old`. The cron refresh
  didn't run, or the strict validator rejected the latest build. Treat
  every note on screen as last-known-good only.
- **unverified** — the source returned a structurally valid response but
  no rows matched the lane (e.g. no scheduled game today). The note is
  preserved as `UNVERIFIED:` and must not be promoted to an on-air claim.
- **source error** — the upstream API returned an HTTP/JSON failure. The
  lane has no fresh data; rely on the cached snapshot and re-run the
  refresh.

### How to manually dispatch a refresh
1. GitHub → repo → **Actions** → **Refresh snapshot** workflow.
2. Click **Run workflow** (uses the default `main` branch).
3. Wait ~1–2 minutes; the workflow strict-validates before it commits.
4. Hard-reload the show-day tab once the run is green so the new SW
   pulls the fresh snapshot.

### What to do if refresh fails
- Open the failed Actions run. The strict validator prints the exact
  failed gate (`too stale`, `no verified_notes for team X`, `only N
  verified source lanes`, etc.).
- If it's a source outage on `statsapi.mlb.com`, wait 5–10 minutes and
  re-dispatch — the cron will also retry on the next slot.
- If it's a structural/schema regression in the builder, the previous
  `data/latest.json` is still committed and serving; the workflow only
  commits when validation passes, so the live UI is never wedged on a
  broken snapshot. Roll back the offending builder commit if needed.
- The red header banner will remain visible to the producer for as long
  as the snapshot is stale, so on-air talent always knows when content
  is last-known-good vs. fresh.
