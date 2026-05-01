# BD Baseball Show Prep PWA

Static, Vercel-deployable PWA for MLB show prep backed by a Python snapshot
builder that reads the public **MLB Stats API** (`statsapi.mlb.com`).

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
- `index.html` — static viewer. Renders verified notes, highlights
  `UNVERIFIED:` entries, displays a stale/source-health banner, and uses
  safe DOM construction (no `innerHTML` interpolation of snapshot fields).
- `sw.js` — versioned shell cache + network-first snapshot update path.

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
- `Refresh snapshot` (`.github/workflows/refresh-snapshot.yml`) runs on a
  cron (13:30 and 22:30 UTC) and on manual `workflow_dispatch`. It builds,
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
  for exact failure modes.
- If a deploy looks stale, reload once so the updated service worker
  takes control.
