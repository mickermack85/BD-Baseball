# Local validation

Run from the repository root on branch `v2-rebuild`.

```bash
npm install
npm run lint
npm run typecheck
npm run build
npm run dev
```

Manual route check while `npm run dev` is running:

- `/`
- `/show`
- `/news`
- `/bets`
- click a dashboard game and verify `/game/[id]` renders live feed JSON
- visit `/game/not-a-game` and verify the unavailable-game state renders

Push and preview:

```bash
git push -u origin v2-rebuild
```

Verify the Vercel preview deployment is green and the same routes render there. Commit `package-lock.json` if `npm install` creates or updates it.
