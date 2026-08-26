# USD Law Quiz

Next.js quiz app with downloadable results PDF and a live leaderboard.
Data is stored in Postgres (Neon) and can fall back to Google Sheets/Apps Script.

## Getting Started

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Public leaderboard API

No auth required. Returns every ranked participant with **name**, **rank**, and **score** only.

```
GET /api/standings?limit=100
```

Local:

```
http://localhost:3000/api/standings?limit=100
```

Example response:

```json
{
  "entries": [
    { "name": "Shubhanshu Singh", "rank": 1, "score": 22 },
    { "name": "Alex Kumar", "rank": 2, "score": 20 }
  ]
}
```

| Field   | Description                          |
| ------- | ------------------------------------ |
| `name`  | Participant display name             |
| `rank`  | 1-based position on the leaderboard  |
| `score` | Total correct answers                |

`limit` is optional (default `100`, max `100`).

The UI leaderboard is at [/leaderboard](http://localhost:3000/leaderboard).

## Embedding in Framer (iframe)

Embed the quiz on your Framer site so users stay on your page:

```
https://your-usd-law-quiz-host/
```

Users do **not** need to leave your site. The quiz runs inside the iframe.

If the browser blocks `localStorage` in the iframe, the app keeps the session **in memory** for that visit and still saves registration/answers to the server. If someone refreshes mid-quiz, they can continue with **Already registered?** and their email.

Framer tip: use a full-height embed and avoid a restrictive `sandbox` on the iframe.

## Postgres (Neon) setup
1. Create/initialize a Neon Postgres database.
2. Copy your connection string into `.env.local` as `DATABASE_URL`.
   - Must include `sslmode=require` (Neon requires SSL).
3. Create the schema:
   - `psql "$DATABASE_URL" -f scripts/db/init.sql`
   - Or open `scripts/db/init.sql` in the Neon SQL editor and run it.

Once `DATABASE_URL` is set, the backend uses Postgres-first for:
- `/api/register`
- `/api/resume`
- `/api/progress` (GET + POST) — per-question saves with server deadlines
- `/api/quiz-start` / `/api/question-start` — arm 30s per-question timer
- `/api/tab-switch` — tab-switch logging (disqualify at 5)
- `/api/leaderboard` and `/api/standings`

### Quiz timing model
- One question at a time; **30 seconds per question** (server-authoritative deadline).
- Timeout auto-submits the current question (blank if unanswered) and advances.
- Single attempt per email; tab-switch limit still disqualifies at 5.
- Re-run `scripts/db/init.sql` after pulling to add `question_responses`, `integrity_events`, and attempt deadline columns.
