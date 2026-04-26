# Vercel deploy notes for BD Sports Show Prep

## What to deploy
Deploy the full `baseball-show-prep` folder as the project root.

## Files that matter
- `baseball-show-prep-generator.html`
- `manifest.webmanifest`
- `sw.js`
- `data/latest.json`
- `assets/`
- `vercel.json`

## Fastest deploy path
1. Put the `baseball-show-prep` folder in a GitHub repo.
2. Import that repo into Vercel.
3. Set the project root to the folder containing `vercel.json`.
4. No build command is required.
5. Output directory can be left blank because this is a static site.
6. Deploy.

## Result
- `/` rewrites to `/baseball-show-prep-generator`
- The PWA manifest and service worker are served directly.
- `data/latest.json` stays fetchable by the app.

## Updating data
When you want a fresh show-prep snapshot:
1. Run `python scripts/build_snapshot.py`
2. Commit the updated `data/latest.json` and dated snapshot file.
3. Push to GitHub.
4. Vercel redeploys automatically.

## Local check
You can test locally with:
- `python -m http.server 8000`
Then open:
- `http://localhost:8000/baseball-show-prep-generator.html`

## Note
Install prompts and service workers require a secure origin in production, which Vercel provides by default.
