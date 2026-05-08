# BD Baseball v2

Clean Next.js 14 rebuild for live MLB show prep.

## Stack

- Next.js 14 App Router
- React 18
- TypeScript
- Tailwind CSS
- Server-side MLB Stats API fetches with `next: { revalidate }`

## Routes

- `/` — live MLB slate dashboard
- `/game/[id]` — live MLB game feed JSON
- `/show` — show rundown scaffold from today's slate
- `/news` — news placeholder
- `/bets` — bets placeholder

## Local development

```bash
npm install
npm run dev
```

Copy `.env.example` only if you need to override the default MLB Stats API base URL.
