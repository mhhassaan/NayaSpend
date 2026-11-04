# NayaSpend

A personal spending tracker built for a single NayaPay user. Transactions
are captured automatically -- from NayaPay's own "You spent" notification
emails via the Gmail API, and from CSV bank-statement imports -- with a
manual-entry fallback for anything missed. Auto-categorization, monthly
spending trends, budget alerts, and bill reminders round out the app.

## Architecture

| Path | What it is |
| --- | --- |
| [`backend/`](backend) | Cloudflare Workers API (Hono + D1 + Drizzle ORM). Captures transactions via the Gmail API and CSV upload, runs scheduled jobs (hourly capture + health watchdog, 6-hourly budget/bill evaluation) via Cron Triggers, and sends email notifications through Resend. |
| [`frontend/`](frontend) | React + Vite SPA (TypeScript, TanStack Query, React Router, Tailwind, Motion, Sonner). Talks to the backend over `/api`, proxied to the Worker in local dev. |
| [`docs/`](docs) | Design docs, implementation plans, and the planning history behind them. |

### `docs/` layout

- [`docs/designs/`](docs/designs) -- the current spec ([`personal-spending-tracker.md`](docs/designs/personal-spending-tracker.md)) and frontend design system.
- [`docs/brand/`](docs/brand) -- brand guidelines the design system is derived from.
- [`docs/superpowers/`](docs/superpowers) -- per-phase implementation plans and specs.
- [`docs/planning/`](docs/planning) -- the original concept brief, design draft, and multi-agent review reports from before implementation started; [`docs/planning/reviews/`](docs/planning/reviews) holds the review reports specifically.
- [`docs/research/`](docs/research) -- reference screenshots used while building the design system.

See [`devlog.md`](devlog.md) for the phase-by-phase build history, including every deferred item and open decision.

## Getting started

### Prerequisites

- Node.js
- A Cloudflare account, only needed for deployment -- local dev runs entirely offline against a simulated D1 database
- A Gmail OAuth app + a Resend API key, only needed to exercise the real Gmail-capture and email-notification paths -- every other feature (manual entry, CSV import, budgets, bills, trends) works with local placeholder values

### Backend

```bash
cd backend
npm install
cp .dev.vars.example .dev.vars   # fill in real values, or use placeholders for local-only testing
npx wrangler d1 migrations apply nayaspend --local
npx wrangler dev
```

The API is served at `http://127.0.0.1:8787`.

### Frontend

```bash
cd frontend
npm install
npm run dev
```

The app is served at `http://localhost:5173` and proxies `/api/*` requests to the backend on port 8787.

### Tests

```bash
cd backend && npm test    # vitest, runs against a simulated Worker + D1
cd frontend && npm test   # vitest, jsdom
```

Both `npm run build` commands run a `tsc --noEmit` type-check (the frontend's also runs a production Vite build).

## Statement import

Only CSV bank-statement exports are supported (PDF was scoped out). The
importer is built against NayaPay's own export format: an account-summary
preamble before the real `TIMESTAMP,TYPE,DESCRIPTION,AMOUNT,BALANCE`
header row, `DD Mon YYYY[ HH:MM AM/PM]`-style dates, and signed amounts
(`+`/`-`) with thousands separators.

## Status

Phases 0-8 are complete: the capture pipeline (Gmail + CSV), dedup
engine, auto-categorization, trends/budgets/bills, and the full frontend.
**Not yet deployed** -- the API has no authentication layer, which must
be addressed before any public deployment. See the "Open items flagged
to the user" section at the end of [`devlog.md`](devlog.md) for this and
every other outstanding decision.
