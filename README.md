# BD Baseball Show Prep PWA

Static, Vercel-deployable PWA for MLB show prep backed by a Python snapshot builder.

## Final architecture
- `scripts/build_snapshot.py`: source-bound fetch + parse pipeline (MLB standings/probables/transactions, ESPN transactions, Savant signals), explicit `verified`/`unverified`/`source_error` behavior.
- `data/latest.json`: current snapshot consumed by the frontend.
- `index.html`: static viewer that renders verified notes, highlights `UNVERIFIED:` entries, and tolerates missing fields.
- `sw.js`: versioned shell cache + network-first snapshot update path.
- `vercel.json`: minimal rewrite/headers for static PWA delivery.

## Python dependencies
```bash
python -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements.txt
```

## Build snapshot
```bash
python scripts/build_snapshot.py
```
Writes:
- `data/latest.json`
- `data/mlb_snapshot_YYYY-MM-DD.json`

## Validate snapshot schema
```bash
python scripts/validate_snapshot.py
```

## Local run
```bash
python -m http.server 8080
```
Open `http://localhost:8080`.

## Local verification workflow
1. Build a live snapshot with `python scripts/build_snapshot.py`.
2. Run schema validation with `python scripts/validate_snapshot.py`.
3. If you only want frontend smoke testing, copy `fixtures/sample_snapshot.json` to `data/latest.json`.

## Deploy to Vercel
1. Push to GitHub.
2. Import repo in Vercel as a static project.
3. No build command.
4. Keep output directory as repo root.

## Troubleshooting
- If a source is unavailable or parser confidence is low, output is intentionally labeled `UNVERIFIED:`.
- Check `debug.source_health` and `source_status` fields for exact fetch/parser failures.
- If a deploy looks stale, reload once so the updated service worker takes control.
