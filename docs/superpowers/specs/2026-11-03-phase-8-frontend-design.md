# Phase 8: NayaSpend Frontend — Design

## Intent

Phases 0-7 built a stable, fully-mounted API with no way for the user to
actually see or act on their data except `curl`. Phase 8 builds the
React frontend the spec's "Detailed Implementation Plan" names (items
34-45): eight pages wired to the existing backend, covering every CUJ
(1-5) end to end. This is the last phase before the app is usable by a
real person day to day.

## Goals

- Every existing API route has a usable UI: transactions (list, correct,
  resolve dedup, resolve quarantine), budgets, bills, trends, statement
  upload, manual-missed logging, Gmail capture health + reconnect.
- The app *feels* considered, not just functional: motion, loading
  states, and error handling follow the Emil Kowalski / `emil-design-eng`
  philosophy throughout, not as a final coat of polish.
- Every state a real session will hit is designed on purpose: first
  load, loading, skeleton, empty, error (network/4xx/5xx), 404/broken
  route, and the success state.

## Non-Goals

- No login/auth UI. API authentication is still an explicitly deferred
  decision (see `devlog.md`, Phase 6/7 "Open items") — the frontend talks
  to the API exactly as unauthenticated as it is today. Revisit together
  when auth is added.
- No Cloudflare Pages deployment configuration. That's Phase 9 (items
  46-48) — this phase is app code only, run via `vite dev` against a
  local `wrangler dev` backend.
- No PDF statement upload UI (backend only accepts CSV so far — Phase 4's
  bank-formats question is still open).
- No category-taxonomy editor UI. Categories are free text today; no
  spec exists for a managed taxonomy.

## Anti-Goals

(Would make this a failure even if every route works)

- A frontend so generic it could be any CRUD app — the whole point of
  doing this with Emil Kowalski's approach in hand is that small,
  specific interactions (confirming a dedup resolution, watching a
  quarantined row commit) should feel considered.
- A loading spinner as the *only* loading state anywhere skeletons would
  clearly read better (the user explicitly asked for skeletons, not just
  spinners).
- Silent failures — any 4xx/5xx from the API must surface to the user,
  never fail invisibly in a console.log.

## Constraints

- Stack is spec-mandated: React + Vite, `react-router-dom` for routing,
  Hono's RPC client (`hc`) for the API client — not a hand-rolled fetch
  wrapper.
- Backend lives at `backend/`, has its own `package.json`/`node_modules`;
  no npm workspace exists today. The new `frontend/` directory is a
  sibling, also with its own `package.json`.
- Statement-derived data may contain full account numbers (Non-Functional
  Requirements) — must not render unmasked except when the user is
  actively viewing that specific upload's own detail view.
- The backend has **no route today to resolve a `pending_review`
  (quarantined) transaction** — this phase must add one (see Decisions).
- **A pre-existing design system already governs the UI layer:**
  `docs/designs/frontend-design-system.md` (authored 2026-11-02, status
  "Proposed"), built from `docs/brand/nayapay-inspired-brand-guidelines.md`.
  It specifies exact color/type/spacing/radius tokens and a named
  component set (`Button`, `Card`, `Tile`, `StatDisplay`, `Pill`,
  `EmptyState`, `Toast`, `Modal`, `AppShell`). **This document supersedes
  this design doc's first draft, which picked shadcn/ui-style components
  without having found it** — corrected below. Its own "Follow-up action"
  (merge its file list into the main spec's Target Files) is carried out
  as part of this phase's plan.
- The OAuth `/auth/gmail/callback` route currently ends with
  `c.text("Gmail account connected.", 200)` — a bare text response, not a
  redirect back into the SPA. Making CaptureHealth's reconnect action feel
  like part of the app (not a dead end) needs a small backend change (see
  Decisions).
- The Vite dev server and `wrangler dev` are different origins; the
  backend has no CORS middleware configured. Needs a decision before any
  page can make its first request (see Decisions).
- Confirmed in `dedupEngine.ts`: a `pending_review` row can never carry a
  `dedup_group_id` — `runDedupCheck` only ever runs against (and compares
  against) `committed` rows. The spec is explicit that committing a
  quarantined row must re-run the dedup check against the now-larger
  committed set (`personal-spending-tracker.md`, "De-duplication"
  section) — the new `resolve-review` route (Decisions) must call
  `runDedupCheck` on commit, not just flip `reviewStatus`.

## Approaches considered (and the pick)

**UI foundation**
- **Picked: the existing `frontend-design-system.md`, implemented as
  written** — Tailwind CSS + CSS custom properties for the NayaPay-inspired
  tokens, and the nine named components (`Button`, `Card`, `Tile`,
  `StatDisplay`, `Pill`, `EmptyState`, `Toast`, `ToastProvider`, `Modal`,
  `AppShell`) hand-rolled exactly as that document specifies — not
  shadcn/ui. (The first draft of this doc picked shadcn/ui before finding
  that document; that pick is withdrawn.)
- Rejected: shadcn/ui/Radix (would produce a second, conflicting
  component layer on top of one already designed and committed to),
  plain CSS modules, a heavier kit like Mantine/Chakra.

**Animation engine**
- **Picked: Motion (Framer Motion).** The library `animate` /
  `animation-performance` assume when choosing between CSS/WAAPI/Motion;
  needed for layout animations, drag-to-dismiss, and list reordering
  (dedup review, transaction list) that CSS alone handles awkwardly.
- Rejected: CSS-only (fine for simple fades, not for the above), GSAP
  (not the toolchain these skills are written around).

**Data/loading layer**
- **Picked: TanStack Query.** Gives loading/error/empty/stale states
  almost for free — directly serves the "build all the states" ask —
  and is the standard pairing with Hono's `hc` client.
- Rejected: hand-rolled `useEffect`/`useState` (reinvents retry/cache/
  error handling eight times).

**Icons**
- **Picked: the `better-icons` skill** (installed this session), backed
  by Iconify. Default to the `lucide` collection (clean, outline/flat
  monochrome, easy to recolor via `currentColor` to match the design
  system's tokens) for UI chrome (nav, buttons, Pills); the brand doc's
  own in-app reference notes service tiles use small colored
  illustrations rather than flat glyphs, so `Tile` icons may pull a
  warmer/filled alternative where one fits better — a per-icon call, not
  a rule.

**Toasts/error notifications**
- **Picked: Sonner as the delivery engine** (per the `ask-sonner` skill —
  Emil Kowalski's own library), **themed to the design system's exact
  tokens** (`--color-success`/`--color-warning`/`--color-danger`,
  `radius-lg`, `--shadow-md`) rather than built from scratch. Reconciles
  the design-system doc's `Toast`/`ToastProvider` spec (which specifies
  *appearance*, not an animation/stacking engine of its own — its own
  Non-Goals explicitly leave "animation/motion system" undefined) with
  the ask: use Sonner's `<Toaster>` for stacking/swipe/auto-dismiss
  behavior, styled via Sonner's `className`/`toastOptions` to match the
  tokens exactly, so the rest of the app can still call one
  `toast(...)`-style API as the design doc's `ToastProvider` intends.

## Decisions (the "how" already settled)

**New backend routes (small, built first in this phase's plan, TDD as
usual):**
- `PATCH /transactions/:id` — general field edit (`vendorRaw`, `amount`,
  `date`, `category`; any subset), for both quarantine-review edits and
  general corrections. Validates the same way `budgets.ts`/`bills.ts`
  already do (positive-integer amount, non-empty strings, ISO date
  round-trip check).
- `GET /trends/history?months=<n>` (default 6, max 24) — returns
  `{months: MonthlyTrends[]}`, oldest to newest, ending at the current
  month. One query across the whole date range (not N calls to the
  existing single-month route), grouped in JS into
  `Map<month, Map<category, total>>`, consistent with
  `getMonthlyTrends`'s own established JS-grouping approach at this data
  scale. Each entry has the same shape `/trends` already returns
  (`{month, totalCents, byCategory, hasData}`), so the frontend's type
  for one month's trends is reused as-is. Feeds Dashboard's new
  multi-month chart (see Page-by-page below); the existing single-month
  `/trends?month=` route and its prev/next-browsable view are unchanged
  and still used alongside it.
- `POST /transactions/:id/resolve-review` — body `{action: "commit" |
  "reject"}`. `"commit"` sets `reviewStatus: "committed"` **and then
  calls `runDedupCheck(db, id)`** (confirmed required by the spec's
  De-duplication section — a newly-committed row must be checked against
  the committed set immediately). If that call assigns a `dedup_group_id`,
  the response includes `{matched: true}` so the frontend can toast "this
  matched a possible duplicate — see Dedup Review" rather than silently
  committing. `"reject"` sets `deletedAt` (no new schema enum — reuses the
  same exclusion pattern `isNull(deletedAt)` already filters on
  everywhere), leaving `reviewStatus` as `"pending_review"` so a rejected
  row is still distinguishable in a raw query from one that was never
  reviewed. 404 if the row doesn't exist; 400 if `reviewStatus` isn't
  `"pending_review"` (nothing to resolve) or `action` isn't recognized.
- **`authGmail.ts`'s `/callback` now redirects into the SPA instead of
  returning plain text.** Adds `FRONTEND_BASE_URL` to `ConfigEnv`/
  `AppConfig`/`.dev.vars.example` (e.g. `http://localhost:5173` for dev).
  On success: redirect to `${frontendBaseUrl}/capture-health?connected=1`.
  On any of the existing failure branches (missing state, bad token
  exchange, etc.): redirect to `${frontendBaseUrl}/capture-health?error=<reason>`
  instead of the current `c.text(...)` responses, so CaptureHealth's
  reconnect button round-trips back into the app either way. `/connect`
  and `/reconnect` are unchanged (they still redirect to Google first).

**Local dev cross-origin strategy:** a Vite dev-server proxy
(`server.proxy` in `vite.config.ts`), not CORS middleware on the Worker.
Backend routes are mounted at their own paths (`/transactions`,
`/budgets`, etc. — no `/api` prefix exists on the Worker today), so the
proxy entry rewrites: `{'/api': {target: 'http://localhost:8787',
changeOrigin: true, rewrite: (p) => p.replace(/^\/api/, '')}}`. The
frontend's `hc<AppType>("/api")` client then calls e.g. `/api/transactions`,
which Vite rewrites to `/transactions` before forwarding — same-origin
from the browser's perspective, no backend change needed this phase.
Production cross-origin behavior (if the deployed Pages site and Worker
end up on different origins) is a Phase 9 concern, not this one.

**Type sharing with the backend:** no npm workspace. The frontend
type-only-imports the Hono app's type directly by relative path
(`import type { AppType } from "../../../backend/src/index"`), which
Vite/TypeScript erase at build time — no runtime dependency on the
backend package, no monorepo tooling needed. `hc<AppType>(baseUrl)` gets
full route/response type inference from that import alone.

**Navigation:** a persistent sidebar (desktop) / bottom nav or drawer
(mobile) linking the 8 pages, plus a single always-visible "Log
transaction" quick action (header button, opens `LogMissedTransaction`)
since CUJ 3 is meant to be fast, not buried in a menu.

**Routing/404/errors:** `react-router-dom`'s data router with an
`errorElement` per route (catches render/loader throws) and one catch-all
`*` route rendering a dedicated 404 page — both get their own designed
state, not react-router's default blank error screen.

**Page-by-page state coverage** (every page gets: loading skeleton →
success → empty-if-applicable → error toast on mutation failure):
- **Dashboard** — both trends views, per the user's explicit "I want
  both" decision: (1) a single-month breakdown from `/trends?month=`
  with prev/next navigation to browse any month, and (2) a trailing
  multi-month chart from the new `/trends/history?months=6` route,
  always anchored to the current month. Either can independently show
  the explicit "no statement imported for this account yet"-style empty
  state when its `hasData`/`months[].hasData` is false — never a blank
  chart.
- **Transactions** — list with inline category correction; quarantined
  rows get an "Edit & resolve" affordance using the two new routes above.
- **DedupReview** — candidate pairs grouped by `dedup_group_id`; a
  batch view for backfill-scale result sets (the spec calls this out
  explicitly for item 39).
- **LogMissedTransaction** — the CUJ 3 quick-entry form.
- **StatementUpload** — CSV upload with masked account-number display
  per the Non-Functional Requirement.
- **Budgets**, **Bills** — CRUD, matching the backend's validation
  rules 1:1 (positive-integer amounts, monthly-only period, ISO dates).
- **CaptureHealth** — last run / current alert state from
  `/capture/health`, with a reconnect-Gmail action (`/auth/gmail/connect`)
  for the expired-token case (CUJ 4).

**Emil Kowalski skill usage is per-concern, not blanket:** `emil-design-eng`
for overall component/interaction polish decisions; `apple-design` for
spring/gesture feel on drag-to-dismiss and sheet-style interactions
(dedup review, mobile nav drawer); `animate` for picking the right tool
per animation; `animation-performance` when a motion choice risks
jank (long transaction lists); `ask-sonner` for every toast; `break-ui`
run against each page once built, with worst-case data (long vendor
names, huge amounts, zero items) before calling it done.

## What's left to the builder

- Exact Tailwind config wiring for the tokens `frontend-design-system.md`
  already specifies (values are fixed; file layout/wiring is not).
- Exact route paths and file/folder layout within `frontend/src/`.
- Exact wording/copy for empty states, error messages, confirmations.
- Exact skeleton shapes per page (how many rows, what placeholder
  layout).
- Whether `DedupReview`'s batch view is a checkbox-multi-select or a
  swipe-per-pair interaction (both satisfy the spec; pick based on how it
  feels once Motion is wired up).
