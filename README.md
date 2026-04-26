# BD Sports Show Prep PWA

Installable baseball show-prep web app for Burnin' Daylight Sports.

## Includes
- PWA-ready show-prep app
- latest snapshot JSON feed
- dated snapshot archive file
- Python snapshot-builder script
- Vercel configuration

## Deploy to Vercel
1. Create a new GitHub repo.
2. Upload everything in this folder to the repo root.
3. Import the repo into Vercel.
4. No build command is required.
5. Deploy.

## Update data
Run:

```bash
python scripts/build_snapshot.py
```

Then commit the updated files in `data/` and push.

## Main files
- `baseball-show-prep-generator.html`
- `manifest.webmanifest`
- `sw.js`
- `data/latest.json`
- `scripts/build_snapshot.py`
- `vercel.json`
