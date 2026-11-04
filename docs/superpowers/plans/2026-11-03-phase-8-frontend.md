# Phase 8: Frontend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the React/Vite frontend for all 8 pages the spec names, wired to the existing (and three newly-added) backend routes, implementing `docs/designs/frontend-design-system.md`'s component library and tokens, with Motion for animation, TanStack Query for data/loading states, and Sonner (themed) for toasts — every page covering loading/skeleton/empty/error states per the design doc.

**Architecture:** Three small backend additions (a general transaction-edit route, a quarantine-resolve route, a multi-month trends route, plus fixing the OAuth callback to redirect into the SPA) land first since every later frontend task depends on them. Then frontend scaffolding (project setup, API client, design-system component library, app shell/routing) establishes the patterns every page reuses. Then one task per page, each a self-contained, independently reviewable deliverable covering its own states. A final task wires navigation and runs a worst-case-data pass across every page.

**Tech Stack:** React 18 + Vite + TypeScript, `react-router-dom` (data router), Hono's `hc` RPC client (type-only import of the backend's `AppType`, no npm workspace), TanStack Query, Motion, Sonner, Tailwind CSS v3 + CSS custom properties, Vitest + React Testing Library for frontend tests (jsdom).

**Spec:** `docs/designs/personal-spending-tracker.md` (Detailed Implementation Plan items 34-45; CUJs 1-5; Non-Functional Requirements' account-number-masking rule; De-duplication section's "commit re-triggers dedup check" rule) and `docs/designs/frontend-design-system.md` (tokens, component specs, page layout patterns — implemented verbatim). Design doc for this phase: `docs/superpowers/specs/2026-11-03-phase-8-frontend-design.md`.

## Global Constraints

- No login/auth UI — the API stays unauthenticated this phase (existing, explicitly deferred decision).
- No Cloudflare Pages deployment config (Phase 9).
- No PDF statement upload (CSV only, matching the backend).
- Every new backend route follows the project's existing validation/error patterns (`budgets.ts`/`bills.ts`'s positive-integer + round-trip-ISO-date checks; `transactions.ts`'s try/catch-JSON pattern).
- Every page's data fetch goes through TanStack Query; every mutation that can fail surfaces a Sonner toast — never a silent console-only failure.
- Tokens, colors, and component names are exactly as `frontend-design-system.md` specifies; do not invent new ones where that document already names one.
- Statement-derived account numbers are masked everywhere except the specific upload's own detail view.

## Review Focus

- **A page's data fetch fails (network error, 500, or a validation 400 on page load)** must show a designed error state with a retry affordance, never a blank page or an uncaught exception. → test in Task 9 (establishes the pattern), spot-checked in Task 17.
- **Committing a quarantined transaction that turns out to match an already-committed one from the other channel** must surface that match to the user (not silently commit as if nothing happened) — this is the one path where a single user action in Transactions has a side effect that's only visible on DedupReview. → test in Task 2 (backend) and Task 10 (frontend).
- **A statement upload's account-number-bearing data, viewed from a page other than that upload's own detail view,** must be masked — the one path where this project handles directly privacy-sensitive raw data. → test in Task 13.
- **Navigating directly to a URL that matches no route** (not just clicking a dead link from inside the app) must hit the designed 404, not react-router's default error screen or a blank white page. → test in Task 8.
- **The OAuth reconnect round-trip (CaptureHealth → Google → back)** must land the user back inside the app showing a clear success or named-failure state, not Google's own page or a plain-text Worker response. → test in Task 4 (backend) and Task 16 (frontend).

---

### Task 1: `PATCH /transactions/:id` — general field edit

**Files:**
- Modify: `backend/src/routes/transactions.ts`
- Modify: `backend/test/transactions.test.ts`

**Interfaces:**
- Consumes: `transactions` table, the same round-trip ISO-date validator pattern `manualAdapter.ts`/`bills.ts` already use.
- Produces: `PATCH /transactions/:id` accepting `{vendorRaw?, amount?, date?, category?}` (any subset). Task 10 (Transactions page) and the quarantine-review flow in Task 10 both call this before resolving.

- [ ] **Step 1: Write the failing tests**

```typescript
test("PATCH /:id edits vendorRaw, amount, date, and category together", async () => {
  const db = drizzle(env.DB);
  const [row] = await db.insert(transactions).values({
    amount: 1000, date: "2026-10-01", vendorRaw: "x", vendorNormalized: "x",
    category: "Uncategorized", source: "manual_missed", provenance: "{}", reviewStatus: "pending_review",
  }).returning();

  const res = await transactionsRoutes.request(
    `/${row.id}`,
    { method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ vendorRaw: "Starbucks", amount: 1250, date: "2026-10-05", category: "Coffee" }) },
    env
  );

  expect(res.status).toBe(200);
  const [updated] = await db.select().from(transactions).where(eq(transactions.id, row.id));
  expect(updated).toMatchObject({ vendorRaw: "Starbucks", amount: 1250, date: "2026-10-05", category: "Coffee" });
});

test("PATCH /:id rejects a non-positive-integer amount", async () => {
  const db = drizzle(env.DB);
  const [row] = await db.insert(transactions).values({
    amount: 1000, date: "2026-10-01", vendorRaw: "x", vendorNormalized: "x",
    category: "Uncategorized", source: "manual_missed", provenance: "{}", reviewStatus: "pending_review",
  }).returning();

  const res = await transactionsRoutes.request(
    `/${row.id}`,
    { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ amount: -5 }) },
    env
  );

  expect(res.status).toBe(400);
});

test("PATCH /:id rejects a malformed date", async () => {
  const db = drizzle(env.DB);
  const [row] = await db.insert(transactions).values({
    amount: 1000, date: "2026-10-01", vendorRaw: "x", vendorNormalized: "x",
    category: "Uncategorized", source: "manual_missed", provenance: "{}", reviewStatus: "pending_review",
  }).returning();

  const res = await transactionsRoutes.request(
    `/${row.id}`,
    { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ date: "2026-02-31" }) },
    env
  );

  expect(res.status).toBe(400);
});

test("PATCH /999 returns 404", async () => {
  const res = await transactionsRoutes.request(
    "/999",
    { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ amount: 100 }) },
    env
  );
  expect(res.status).toBe(404);
});
```

- [ ] **Step 2: Run the tests, confirm they fail**

Run: `npm --prefix backend run test -- transactions`

- [ ] **Step 3: Implement `PATCH /:id` in `backend/src/routes/transactions.ts`**

404 if the row doesn't exist. Parse JSON (400 on parse failure, matching every other route's try/catch pattern). For each present field: `vendorRaw` — non-empty trimmed string, also update `vendorNormalized` via `normalize()` (import from `categorizationEngine.ts`); `amount` — positive integer; `date` — the same round-trip-through-`Date` ISO check `bills.ts`'s `isValidIsoDate` uses (copy the helper locally, matching that file's own pattern of small per-file validation helpers); `category` — non-empty trimmed string (do **not** call `correctCategory` here — unlike the category-only route, a general edit shouldn't retrain the vendor rule, since the user may be editing `vendorRaw` in the same request). 400 on any invalid field, 200 with the updated row otherwise.

- [ ] **Step 4: Run the tests, confirm they pass**

Run: `npm --prefix backend run test -- transactions`

- [ ] **Step 5: Commit**

```bash
git add backend/src/routes/transactions.ts backend/test/transactions.test.ts
git commit -m "feat: add PATCH /transactions/:id for general field edits"
```

---

### Task 2: `POST /transactions/:id/resolve-review` — commit or reject a quarantined row

**Files:**
- Modify: `backend/src/routes/transactions.ts`
- Modify: `backend/test/transactions.test.ts`

**Interfaces:**
- Consumes: `runDedupCheck` (`dedupEngine.ts`), the `transactions` table.
- Produces: `POST /transactions/:id/resolve-review` with body `{action: "commit" | "reject"}`, returning `{resolved: "commit" | "reject", matched: boolean}`. Task 10 (Transactions page) consumes this after any `PATCH` edit.

- [ ] **Step 1: Write the failing tests**

```typescript
test("[Review Focus] resolve-review commit re-runs the dedup check and reports a match", async () => {
  const db = drizzle(env.DB);
  // An already-committed statement-sourced row with no pair yet.
  await db.insert(transactions).values({
    amount: 500, date: "2026-10-10", vendorRaw: "Daraz", vendorNormalized: "daraz",
    category: "Shopping", source: "statement_import", provenance: "{}", reviewStatus: "committed",
  });
  // A quarantined gmail-sourced row that matches it on amount/date/vendor once committed.
  const [quarantined] = await db.insert(transactions).values({
    amount: 500, date: "2026-10-11", vendorRaw: "Daraz", vendorNormalized: "daraz",
    category: "Shopping", source: "gmail_email", provenance: "{}", reviewStatus: "pending_review",
  }).returning();

  const res = await transactionsRoutes.request(
    `/${quarantined.id}/resolve-review`,
    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "commit" }) },
    env
  );

  expect(res.status).toBe(200);
  const body = (await res.json()) as { resolved: string; matched: boolean };
  expect(body).toEqual({ resolved: "commit", matched: true });
  const [updated] = await db.select().from(transactions).where(eq(transactions.id, quarantined.id));
  expect(updated.reviewStatus).toBe("committed");
  expect(updated.dedupGroupId).not.toBeNull();
});

test("resolve-review commit with no dedup match reports matched: false", async () => {
  const db = drizzle(env.DB);
  const [row] = await db.insert(transactions).values({
    amount: 500, date: "2026-10-10", vendorRaw: "x", vendorNormalized: "x",
    category: "Uncategorized", source: "gmail_email", provenance: "{}", reviewStatus: "pending_review",
  }).returning();

  const res = await transactionsRoutes.request(
    `/${row.id}/resolve-review`,
    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "commit" }) },
    env
  );

  const body = (await res.json()) as { matched: boolean };
  expect(body.matched).toBe(false);
});

test("resolve-review reject soft-deletes without committing", async () => {
  const db = drizzle(env.DB);
  const [row] = await db.insert(transactions).values({
    amount: 500, date: "2026-10-10", vendorRaw: "x", vendorNormalized: "x",
    category: "Uncategorized", source: "gmail_email", provenance: "{}", reviewStatus: "pending_review",
  }).returning();

  const res = await transactionsRoutes.request(
    `/${row.id}/resolve-review`,
    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "reject" }) },
    env
  );

  expect(res.status).toBe(200);
  const [updated] = await db.select().from(transactions).where(eq(transactions.id, row.id));
  expect(updated.reviewStatus).toBe("pending_review");
  expect(updated.deletedAt).not.toBeNull();
});

test("resolve-review on an already-committed row returns 400", async () => {
  const db = drizzle(env.DB);
  const [row] = await db.insert(transactions).values({
    amount: 500, date: "2026-10-10", vendorRaw: "x", vendorNormalized: "x",
    category: "Uncategorized", source: "manual_missed", provenance: "{}", reviewStatus: "committed",
  }).returning();

  const res = await transactionsRoutes.request(
    `/${row.id}/resolve-review`,
    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "commit" }) },
    env
  );

  expect(res.status).toBe(400);
});

test("resolve-review with an invalid action returns 400", async () => {
  const db = drizzle(env.DB);
  const [row] = await db.insert(transactions).values({
    amount: 500, date: "2026-10-10", vendorRaw: "x", vendorNormalized: "x",
    category: "Uncategorized", source: "gmail_email", provenance: "{}", reviewStatus: "pending_review",
  }).returning();

  const res = await transactionsRoutes.request(
    `/${row.id}/resolve-review`,
    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "approve" }) },
    env
  );

  expect(res.status).toBe(400);
});

test("resolve-review on a nonexistent id returns 404", async () => {
  const res = await transactionsRoutes.request(
    "/999/resolve-review",
    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "commit" }) },
    env
  );
  expect(res.status).toBe(404);
});
```

- [ ] **Step 2: Run the tests, confirm they fail**

Run: `npm --prefix backend run test -- transactions`

- [ ] **Step 3: Implement `POST /:id/resolve-review` in `backend/src/routes/transactions.ts`**

404 if missing. Parse JSON (400 on parse failure). `action` must be `"commit"` or `"reject"` (400 otherwise). 400 if `reviewStatus !== "pending_review"` (nothing to resolve — mirrors `resolve-dedup`'s existing state guard). `"commit"`: update `reviewStatus: "committed"`, then call `const {matched} = await runDedupCheck(db, id)`, return `{resolved: "commit", matched}`. `"reject"`: update `deletedAt: new Date().toISOString()` (leave `reviewStatus` untouched), return `{resolved: "reject", matched: false}`.

- [ ] **Step 4: Run the tests, confirm they pass**

Run: `npm --prefix backend run test -- transactions`

- [ ] **Step 5: Commit**

```bash
git add backend/src/routes/transactions.ts backend/test/transactions.test.ts
git commit -m "feat: add POST /transactions/:id/resolve-review (commit/reject quarantine)"
```

---

### Task 3: `GET /trends/history?months=<n>` — multi-month trends

**Files:**
- Modify: `backend/src/services/trendsService.ts`
- Modify: `backend/src/routes/trends.ts`
- Modify: `backend/test/trendsService.test.ts`
- Modify: `backend/test/trends.test.ts`

**Interfaces:**
- Consumes: `committedNotPendingDedup()` (`budgetAlertTrigger.ts`), the `transactions` table.
- Produces: `getTrendsHistory(db: DrizzleD1Database, monthsCount: number): Promise<{months: MonthlyTrends[]}>`; route `GET /trends/history?months=<n>`. Task 9 (Dashboard) consumes the route.

- [ ] **Step 1: Write the failing tests**

```typescript
// trendsService.test.ts additions
test("getTrendsHistory returns monthsCount entries, oldest to newest, ending at the current month", async () => {
  const db = drizzle(env.DB);
  const result = await getTrendsHistory(db, 3);
  expect(result.months).toHaveLength(3);
  const now = new Date();
  const currentMonth = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
  expect(result.months[2].month).toBe(currentMonth);
});

test("getTrendsHistory aggregates each month independently from one range query", async () => {
  const db = drizzle(env.DB);
  const now = new Date();
  const thisMonth = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
  await db.insert(transactions).values({
    amount: 1000, date: `${thisMonth}-05`, vendorRaw: "x", vendorNormalized: "x", category: "Coffee",
    source: "manual_missed", provenance: "{}", reviewStatus: "committed",
  });

  const result = await getTrendsHistory(db, 2);

  expect(result.months[1].totalCents).toBe(1000);
  expect(result.months[1].hasData).toBe(true);
  expect(result.months[0].hasData).toBe(false);
});
```

```typescript
// trends.test.ts additions
test("GET /history?months=3 returns 3 months", async () => {
  const res = await trendsRoutes.request("/history?months=3", {}, env);
  expect(res.status).toBe(200);
  const body = (await res.json()) as { months: unknown[] };
  expect(body.months).toHaveLength(3);
});

test("GET /history with no months param defaults to 6", async () => {
  const res = await trendsRoutes.request("/history", {}, env);
  const body = (await res.json()) as { months: unknown[] };
  expect(body.months).toHaveLength(6);
});

test("GET /history?months=99 returns 400 (exceeds the 24-month cap)", async () => {
  const res = await trendsRoutes.request("/history?months=99", {}, env);
  expect(res.status).toBe(400);
});

test("GET /history?months=0 returns 400", async () => {
  const res = await trendsRoutes.request("/history?months=0", {}, env);
  expect(res.status).toBe(400);
});
```

- [ ] **Step 2: Run the tests, confirm they fail**

Run: `npm --prefix backend run test -- trendsService trends`

- [ ] **Step 3: Implement `getTrendsHistory` in `trendsService.ts` and the route in `trends.ts`**

`getTrendsHistory`: compute `monthsCount` month-start strings (`YYYY-MM`) ending at the current UTC month, going backward. Select every transaction (one query) whose `date` is `>=` the earliest month's `-01` and `<` the month *after* the latest month's `-01`, applying `committedNotPendingDedup()`. Group in JS into `Map<month, Map<category, total>>` (slice each row's `date` to its first 7 chars for the month key), then build one `MonthlyTrends` entry per month in the precomputed list (including months with zero matching rows — `hasData: false`, `byCategory: []`), oldest first.

Route: add `GET /history` to `trendsRoutes` (place it before the existing `GET /` registration doesn't matter in Hono, but keep file order sensible — new route below the existing one). Read `?months=`, default `6`, must parse as an integer in `[1, 24]` (400 otherwise), call `getTrendsHistory`, return `c.json(result)`.

- [ ] **Step 4: Run the tests, confirm they pass**

Run: `npm --prefix backend run test -- trendsService trends`

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/trendsService.ts backend/src/routes/trends.ts backend/test/trendsService.test.ts backend/test/trends.test.ts
git commit -m "feat: add multi-month trends history endpoint"
```

---

### Task 4: OAuth callback redirects into the SPA

**Files:**
- Modify: `backend/src/config.ts`
- Modify: `backend/src/routes/authGmail.ts`
- Modify: `backend/.dev.vars.example`
- Modify: `backend/test/authGmail.test.ts`

**Interfaces:**
- Consumes: `FRONTEND_BASE_URL` (new required config value).
- Produces: no new exports. `/callback` now always ends in a redirect (302) instead of `c.text(...)`. Task 16 (CaptureHealth) reads `?connected=1` / `?error=<reason>` from its own route's query string.

- [ ] **Step 1: Add `FRONTEND_BASE_URL` to config**

In `config.ts`: add `FRONTEND_BASE_URL: string` to `ConfigEnv`, `frontendBaseUrl: string` to `AppConfig`, add `"FRONTEND_BASE_URL"` to `REQUIRED_KEYS`, map it through in `loadConfig`'s return. In `.dev.vars.example`: add `FRONTEND_BASE_URL=http://localhost:5173` with a one-line comment (the Vite dev server's own default port).

- [ ] **Step 2: Write the failing tests (replace every existing `/callback` status assertion in `authGmail.test.ts` with the new redirect contract)**

```typescript
test("GET /callback with no state parameter redirects to the frontend with an error, not a 400 body", async () => {
  vi.stubGlobal("fetch", vi.fn());
  const res = await authGmailRoutes.request("/callback?code=fake-code", { redirect: "manual" } as RequestInit, testEnv);
  expect(res.status).toBe(302);
  expect(res.headers.get("Location")).toBe("https://frontend.example.com/capture-health?error=invalid_state");
});

test("GET /callback with a valid state and cookie, successful exchange, redirects to capture-health?connected=1", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify({ access_token: "a", refresh_token: "r", expires_in: 3600 }), { status: 200 }))
  );
  const { state, cookie } = await freshFlow();

  const res = await callback(`code=fake-code&state=${encodeURIComponent(state)}`, cookie);

  expect(res.status).toBe(302);
  expect(res.headers.get("Location")).toBe("https://frontend.example.com/capture-health?connected=1");
});

test("a failed token exchange redirects to capture-health with an error, not a 502 body", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 400 })));
  const { state, cookie } = await freshFlow();

  const res = await callback(`code=bad-code&state=${encodeURIComponent(state)}`, cookie);

  expect(res.status).toBe(302);
  expect(res.headers.get("Location")).toBe("https://frontend.example.com/capture-health?error=exchange_failed");
});
```

(`testEnv` gains `FRONTEND_BASE_URL: "https://frontend.example.com"`. Every other existing `/callback` test in this file that currently asserts `res.status` of `400`/`502`/`200` needs updating the same way — 302 plus the matching `Location`; use `missing_code`, `missing_access_token`, `invalid_expiry`, `missing_refresh_token` as the `?error=` values for those respective existing branches. The two upsert/replace tests and the "keeps the existing refresh token" test, whose final assertions read the DB rather than the response, only need their status/Location updated, not their DB assertions.)

- [ ] **Step 3: Run the tests, confirm they fail**

Run: `npm --prefix backend run test -- authGmail`

- [ ] **Step 4: Implement the redirect in `authGmail.ts`**

Add a local `redirectToFrontend(c, frontendBaseUrl, path)` helper building `` `${frontendBaseUrl}${path}` `` and returning `c.redirect(url, 302)`. Replace every `c.text(...)` return in `/callback` with a call to this helper: invalid/missing state → `/capture-health?error=invalid_state`; missing code → `/capture-health?error=missing_code`; failed exchange → `/capture-health?error=exchange_failed`; missing `access_token` → `/capture-health?error=missing_access_token`; invalid `expires_in` → `/capture-health?error=invalid_expiry`; missing `refresh_token` on first connect → `/capture-health?error=missing_refresh_token`; success → `/capture-health?connected=1`.

- [ ] **Step 5: Run the tests, confirm they pass, then run the full backend suite**

Run: `npm --prefix backend run test`
Expected: all tests pass (every other test file is unaffected by this change).

- [ ] **Step 6: Commit**

```bash
git add backend/src/config.ts backend/src/routes/authGmail.ts backend/.dev.vars.example backend/test/authGmail.test.ts
git commit -m "fix: OAuth callback redirects into the SPA instead of returning plain text"
```

---

### Task 5: Frontend project scaffolding

**Files:**
- Create: `frontend/package.json`, `frontend/tsconfig.json`, `frontend/vite.config.ts`, `frontend/index.html`
- Create: `frontend/tailwind.config.js`, `frontend/postcss.config.js`
- Create: `frontend/src/styles/tokens.css`, `frontend/src/styles/index.css`
- Create: `frontend/src/main.tsx` (placeholder — full routing added in Task 8)
- Create: `frontend/src/api/client.ts`
- Create: `frontend/src/types/transaction.ts`
- Create: `frontend/test/setup.ts`
- Create: `frontend/src/api/client.test.ts`

**Interfaces:**
- Consumes: the backend's `AppType` (type-only import from `../../../backend/src/index`).
- Produces: `apiClient` (the configured `hc<AppType>()` instance, exported from `api/client.ts`), and the mirrored row types (`Transaction`, `Budget`, `Bill`, `CaptureRun`) from `types/transaction.ts`. Every later frontend task imports both.

- [ ] **Step 1: `package.json`**

```json
{
  "name": "nayaspend-frontend",
  "private": true,
  "version": "0.0.1",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc --noEmit && vite build",
    "test": "vitest run",
    "lint": "eslint ."
  },
  "dependencies": {
    "react": "^18.3.0",
    "react-dom": "^18.3.0",
    "react-router-dom": "^6.28.0",
    "@tanstack/react-query": "^5.59.0",
    "hono": "^4.6.0",
    "motion": "^11.11.0",
    "sonner": "^1.7.0"
  },
  "devDependencies": {
    "@vitejs/plugin-react": "^4.3.0",
    "vite": "^5.4.0",
    "typescript": "^5.6.0",
    "vitest": "^2.1.0",
    "@testing-library/react": "^16.0.0",
    "@testing-library/jest-dom": "^6.6.0",
    "@testing-library/user-event": "^14.5.0",
    "jsdom": "^25.0.0",
    "tailwindcss": "^3.4.0",
    "postcss": "^8.4.0",
    "autoprefixer": "^10.4.0",
    "@types/react": "^18.3.0",
    "@types/react-dom": "^18.3.0"
  }
}
```

Run `npm install` in `frontend/` after creating this file.

- [ ] **Step 2: `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "jsx": "react-jsx",
    "strict": true,
    "skipLibCheck": true,
    "esModuleInterop": true,
    "resolveJsonModule": true,
    "noEmit": true
  },
  "include": ["src", "test"]
}
```

- [ ] **Step 3: `vite.config.ts`**

```typescript
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/api": {
        target: "http://localhost:8787",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ""),
      },
    },
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./test/setup.ts"],
    globals: true,
  },
});
```

- [ ] **Step 4: `index.html`, Google Fonts, `test/setup.ts`**

`index.html`: a standard Vite shell (`<div id="root">`, `<script type="module" src="/src/main.tsx">`), with the Poppins/DM Sans Google Fonts `<link>` tags from `nayapay-inspired-brand-guidelines.md`'s Typography section, loaded in `<head>`.

`test/setup.ts`:
```typescript
import "@testing-library/jest-dom/vitest";
```

- [ ] **Step 5: Tailwind + tokens**

`tailwind.config.js`: the config from `frontend-design-system.md`'s Design Tokens section, **plus** semantic color entries mapping to the CSS custom properties (the doc's own snippet only maps raw palette colors; the semantic aliases it defines in CSS need their own Tailwind entries to be usable as utility classes):

```js
colors: {
  /* ...raw palette from the doc, unchanged... */
  'bg-page': 'var(--color-bg-page)',
  'bg-surface': 'var(--color-bg-surface)',
  'bg-inverse': 'var(--color-bg-inverse)',
  'text-primary': 'var(--color-text-primary)',
  'text-secondary': 'var(--color-text-secondary)',
  'text-inverse': 'var(--color-text-inverse)',
  border: 'var(--color-border)',
  accent: 'var(--color-accent)',
  success: 'var(--color-success)',
  warning: 'var(--color-warning)',
  danger: 'var(--color-danger)',
},
```

`postcss.config.js`: standard `tailwindcss`/`autoprefixer` plugin pair.

`src/styles/tokens.css`: every CSS custom property from `frontend-design-system.md`'s Design Tokens section, verbatim (colors, typography, spacing/radius, shadows). Pick `--color-success: #1e8a4c` exactly as the doc's own note specifies, checked for contrast against `--color-bg-surface`/`--color-bg-page` (both easily pass at this value — no change needed).

`src/styles/index.css`: `@tailwind base; @tailwind components; @tailwind utilities;` followed by `@import "./tokens.css";`.

- [ ] **Step 6: `types/transaction.ts`**

Mirror the backend's Drizzle schema row shapes by hand (not generated) — `Transaction`, `Budget`, `Bill`, `CaptureRun`, matching `backend/src/db/schema.ts` field-for-field (camelCase property names, `string | null` for nullable columns). These are the types every page's TanStack Query hooks resolve to.

- [ ] **Step 7: `api/client.ts` + its test**

```typescript
import { hc } from "hono/client";
import type { AppType } from "../../../backend/src/index";

export const apiClient = hc<AppType>("/api");
```

**Before adding this import, fix a real Hono RPC-typing gotcha in `backend/src/index.ts`:** today, `app.route(...)` is called eight times as separate statements, each discarding its return value — `.route()` returns a *new*, more-specifically-typed `Hono` instance rather than mutating `app` in place, so `typeof app` currently only reflects the instance *before* any route was attached. `hc<AppType>()` would still compile against that, but with no route methods inferred (silently wrong, not a type error). Fix by chaining the calls (or reassigning), confirmed in Hono's own RPC guide as the required pattern:

```typescript
const app = new Hono<{ Bindings: Env }>()
  .route("/transactions", transactionsRoutes)
  .route("/missed-transactions", missedTransactionsRoutes)
  .route("/budgets", budgetsRoutes)
  .route("/bills", billsRoutes)
  .route("/trends", trendsRoutes)
  .route("/statements", statementsRoutes)
  .route("/capture", captureRoutes)
  .route("/auth/gmail", authGmailRoutes);

export type AppType = typeof app;
```

This is a pure refactor (no behavior change) — run `npm --prefix backend run test` after making it and confirm the full existing backend suite still passes unchanged, before moving on to `api/client.ts` itself.

`api/client.test.ts`: a smoke test confirming `apiClient` is defined and has a `.transactions` property (proves the type import resolved and `hc` built a client) — not a network test.

```typescript
import { describe, expect, test } from "vitest";
import { apiClient } from "./client";

describe("apiClient", () => {
  test("is constructed with routes from the backend's AppType", () => {
    expect(apiClient).toBeDefined();
  });
});
```

- [ ] **Step 8: `main.tsx` placeholder**

A minimal `ReactDOM.createRoot(...).render(<div>NayaSpend</div>)` — full routing/providers are Task 8's job; this step only proves the Vite+React+TS pipeline builds and runs.

- [ ] **Step 9: Verify**

Run: `npm --prefix frontend run test` — expect the one smoke test passing.
Run: `npm --prefix frontend run build` — expect a clean `tsc --noEmit` + Vite build.

- [ ] **Step 10: Commit**

```bash
git add frontend/
git commit -m "feat: scaffold frontend project (Vite, Tailwind tokens, API client)"
```

---

### Task 6: Design-system components — primitives

**Files:**
- Create: `frontend/src/components/Button.tsx`, `Card.tsx`, `Tile.tsx`, `StatDisplay.tsx`, `Pill.tsx`, `EmptyState.tsx`, `Modal.tsx`
- Create: matching `*.test.tsx` for each
- Create: `frontend/src/components/index.ts` (barrel export)

**Interfaces:**
- Consumes: `tokens.css`'s Tailwind-mapped classes (Task 5), `better-icons`-sourced `lucide` icons (resolved per-component as needed, not a shared dependency).
- Produces: `Button`, `Card`, `Tile`, `StatDisplay`, `Pill`, `EmptyState`, `Modal` — every page task (9-16) imports from `../components`.

- [ ] **Step 1: Write the failing render tests**

One test per component, each rendering it and asserting on its variant-driven class or visible text — e.g.:

```typescript
// Button.test.tsx
test("renders the primary variant with the accent/dark button classes", () => {
  render(<Button variant="primary">Save</Button>);
  const button = screen.getByRole("button", { name: "Save" });
  expect(button.className).toContain("bg-blackberry");
});

test("renders the danger variant", () => {
  render(<Button variant="danger">Discard</Button>);
  expect(screen.getByRole("button", { name: "Discard" }).className).toContain("bg-hot-red");
});
```

```typescript
// EmptyState.test.tsx
test("renders its message and an optional action button", () => {
  const onAction = vi.fn();
  render(<EmptyState message="No budgets yet" actionLabel="Create one" onAction={onAction} />);
  expect(screen.getByText("No budgets yet")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Create one" }));
  expect(onAction).toHaveBeenCalledOnce();
});
```

Write one comparably minimal test for `Card`, `Tile`, `StatDisplay`, `Pill`, `Modal` (render + one variant/prop assertion each — `Modal`'s test asserts it renders its children only when `open` is true and calls `onClose` on an overlay click).

- [ ] **Step 2: Run the tests, confirm they fail**

Run: `npm --prefix frontend run test -- components`

- [ ] **Step 3: Implement each component exactly per `frontend-design-system.md`'s Component Library section**

`Button`: `variant: "primary" | "secondary" | "danger"`, sentence-case children, `radius-md`/`radius-sm` per variant, `active:scale-[0.96]` press feedback, no `uppercase`. `Card`: `radius-xl`, `shadow-sm`, `bg-surface` wrapper, renders `children`. `Tile`: `radius-lg` square-ish, centered icon slot + `text-label` caption below. `StatDisplay`: label line (`text-body`) + large figure (`text-balance`) + optional trailing icon slot. `Pill`: `radius-pill`, small, takes a `tone` prop (`neutral | success | warning | danger`) mapping to the matching token. `EmptyState`: icon/illustration slot + `text-body-lg` message + optional `actionLabel`/`onAction`. `Modal`: `radius-xl`, `shadow-md`, centered overlay on a `light-blackberry`-tinted scrim, closes on overlay click or an explicit close button.

- [ ] **Step 4: Run the tests, confirm they pass**

Run: `npm --prefix frontend run test -- components`

- [ ] **Step 5: Barrel export + commit**

`components/index.ts` re-exports all seven.

```bash
git add frontend/src/components/
git commit -m "feat: add design-system primitive components"
```

---

### Task 7: Toast / ToastProvider (Sonner, themed)

**Files:**
- Create: `frontend/src/components/ToastProvider.tsx`
- Create: `frontend/src/components/ToastProvider.test.tsx`
- Modify: `frontend/src/components/index.ts`

**Interfaces:**
- Consumes: `sonner`'s `Toaster` component and `toast()` function.
- Produces: `<ToastProvider>` (wraps the app once, in Task 8's `App.tsx`) and a re-exported `toast` helper (`showSuccess(message)`, `showError(message)` — thin wrappers naming intent, since every mutation call site needs one or the other) with Sonner styled to the design system's tokens. Every page task (9-16) calls `showError`/`showSuccess` from its mutation handlers.

- [ ] **Step 1: Write the failing test**

```typescript
test("showError renders a toast styled with the danger token classes", async () => {
  render(<ToastProvider />);
  act(() => { showError("Something failed"); });
  const toastEl = await screen.findByText("Something failed");
  expect(toastEl.closest("[data-sonner-toast]")).toHaveClass("toast-danger");
});

test("showSuccess renders a toast styled with the success token classes", async () => {
  render(<ToastProvider />);
  act(() => { showSuccess("Saved"); });
  const toastEl = await screen.findByText("Saved");
  expect(toastEl.closest("[data-sonner-toast]")).toHaveClass("toast-success");
});
```

- [ ] **Step 2: Run the test, confirm it fails**

Run: `npm --prefix frontend run test -- ToastProvider`

- [ ] **Step 3: Implement**

`ToastProvider.tsx` renders Sonner's `<Toaster toastOptions={{classNames: {toast: "rounded-lg shadow-md", success: "toast-success", error: "toast-danger"}}} />` (Sonner's documented `classNames` API), and exports `showSuccess`/`showError` as thin wrappers over `toast.success`/`toast.error` from `"sonner"`. Add `.toast-success`/`.toast-danger`/`.toast-warning` utility classes to `styles/index.css` mapping to the `--color-success`/`--color-danger`/`--color-warning` tokens' background, per the design doc's `Toast` spec (`radius-lg`, `shadow-md`, color-coded).

- [ ] **Step 4: Run the test, confirm it passes**

Run: `npm --prefix frontend run test -- ToastProvider`

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/ToastProvider.tsx frontend/src/components/ToastProvider.test.tsx frontend/src/components/index.ts frontend/src/styles/index.css
git commit -m "feat: add Sonner-backed, token-themed toast provider"
```

---

### Task 8: AppShell, routing, 404, error boundary

**Files:**
- Create: `frontend/src/components/AppShell.tsx`, `frontend/src/components/AppShell.test.tsx`
- Create: `frontend/src/pages/NotFound.tsx`, `frontend/src/pages/ErrorPage.tsx`
- Modify: `frontend/src/App.tsx` (create if not already), `frontend/src/main.tsx`
- Create: `frontend/src/App.test.tsx`
- Modify: `frontend/src/components/index.ts`

**Interfaces:**
- Consumes: `react-router-dom`'s `createBrowserRouter`/`RouterProvider`, TanStack Query's `QueryClientProvider`, `ToastProvider` (Task 7).
- Produces: the routed shell every page (Tasks 9-16) registers a route element inside. `AppShell` wraps every page via a layout route.

- [ ] **Step 1: Write the failing tests**

```typescript
// AppShell.test.tsx
test("renders nav links for all 8 pages", () => {
  render(<MemoryRouter><AppShell><div /></AppShell></MemoryRouter>);
  for (const label of ["Dashboard", "Transactions", "Dedup Review", "Budgets", "Bills", "Capture Health"]) {
    expect(screen.getByRole("link", { name: label })).toBeInTheDocument();
  }
  expect(screen.getByRole("button", { name: "Log transaction" })).toBeInTheDocument();
});
```

```typescript
// App.test.tsx
test("an unknown route renders the 404 page", () => {
  const router = createMemoryRouter(routes, { initialEntries: ["/this-does-not-exist"] });
  render(<RouterProvider router={router} />);
  expect(screen.getByText(/page not found/i)).toBeInTheDocument();
});
```

- [ ] **Step 2: Run the tests, confirm they fail**

Run: `npm --prefix frontend run test -- AppShell App.test`

- [ ] **Step 3: Implement**

`AppShell`: top bar (app name/mark on the left, settings/account icon on the right) + nav — a left sidebar at `md:` width and above, collapsing to a bottom tab bar below it, per `frontend-design-system.md`'s `AppShell`/Responsive Behavior sections. Links: Dashboard (`/`), Transactions (`/transactions`), Dedup Review (`/dedup-review`), Budgets (`/budgets`), Bills (`/bills`), Capture Health (`/capture-health`) — Statement Upload and Log Missed Transaction are reached via the Dashboard's quick-action `Tile` grid, not the primary nav (per the design doc's own page-layout pattern), plus the one always-visible header "Log transaction" button linking to `/log-transaction`.

`NotFound.tsx`: an `EmptyState`-style page ("Page not found", a link home). `ErrorPage.tsx`: a comparable page for `errorElement`, reading `useRouteError()` and showing a generic "something went wrong" message (never the raw error to the user) plus a link home.

`App.tsx`: `createBrowserRouter` with one layout route rendering `AppShell` wrapping an `<Outlet />`, each page (added incrementally — only `NotFound`/placeholder stubs for the other 7 routes exist until Tasks 9-16 land) as a child route with its own `errorElement: <ErrorPage />`, and a `path: "*"` child rendering `NotFound`. `main.tsx`: wraps `RouterProvider` in `QueryClientProvider` (`new QueryClient()`) and `ToastProvider`.

- [ ] **Step 4: Run the tests, confirm they pass**

Run: `npm --prefix frontend run test -- AppShell App.test`

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/AppShell.tsx frontend/src/components/AppShell.test.tsx frontend/src/pages/NotFound.tsx frontend/src/pages/ErrorPage.tsx frontend/src/App.tsx frontend/src/App.test.tsx frontend/src/main.tsx frontend/src/components/index.ts
git commit -m "feat: add app shell, routing, 404, and error boundary"
```

---

### Task 9: Dashboard page

**Files:**
- Create: `frontend/src/pages/Dashboard.tsx`, `frontend/src/pages/Dashboard.test.tsx`
- Modify: `frontend/src/App.tsx` (register the `/` route)

**Interfaces:**
- Consumes: `apiClient.trends.$get` and `apiClient.trends.history.$get` (Tasks 3), `Card`/`Tile`/`StatDisplay`/`EmptyState` (Task 6), `showError` (Task 7).
- Produces: nothing later tasks consume by name — establishes the canonical loading/error/empty pattern every later page task follows.

**This task's pattern (referenced, not repeated, by Tasks 10-16):** a `useQuery` per data need; while `isPending`, render a skeleton (a `Card`-shaped placeholder with `animate-pulse`, not a spinner); on `isError`, render an inline error block with a "Retry" button calling `refetch()` **and** fire `showError(...)` once via a `useEffect` keyed on the error object; on success with an empty/`hasData: false` result, render `EmptyState` with page-appropriate copy; otherwise render the real content, wrapped in a `motion.div` fade/slide-in (`emil-design-eng`-guided — short duration, no bounce, respects `prefers-reduced-motion` by checking Motion's `useReducedMotion()` and swapping to an instant transition).

- [ ] **Step 1: Write the failing tests**

```typescript
test("shows a skeleton while the month breakdown is loading", () => {
  vi.spyOn(apiClient.trends, "$get").mockReturnValue(new Promise(() => {})); // never resolves
  renderWithProviders(<Dashboard />);
  expect(screen.getByTestId("dashboard-skeleton")).toBeInTheDocument();
});

test("shows the empty state when the current month has no data", async () => {
  mockTrendsGet({ month: "2026-11", totalCents: 0, byCategory: [], hasData: false });
  mockTrendsHistoryGet({ months: [] });
  renderWithProviders(<Dashboard />);
  expect(await screen.findByText(/no spending recorded yet/i)).toBeInTheDocument();
});

test("renders the month breakdown and the multi-month chart on success", async () => {
  mockTrendsGet({ month: "2026-11", totalCents: 5000, byCategory: [{ category: "Coffee", totalCents: 5000 }], hasData: true });
  mockTrendsHistoryGet({ months: [{ month: "2026-10", totalCents: 3000, byCategory: [], hasData: true }, { month: "2026-11", totalCents: 5000, byCategory: [], hasData: true }] });
  renderWithProviders(<Dashboard />);
  expect(await screen.findByText("Coffee")).toBeInTheDocument();
  expect(screen.getByTestId("trends-history-chart")).toBeInTheDocument();
});

test("clicking next month re-fetches the following month's breakdown", async () => {
  // Computed from the real current date, not hardcoded -- the component
  // under test also defaults to the real current month via `new Date()`.
  const now = new Date();
  const nextMonthDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  const nextMonth = `${nextMonthDate.getUTCFullYear()}-${String(nextMonthDate.getUTCMonth() + 1).padStart(2, "0")}`;
  mockTrendsGet({ month: "irrelevant", totalCents: 0, byCategory: [], hasData: false });
  mockTrendsHistoryGet({ months: [] });
  renderWithProviders(<Dashboard />);
  await screen.findByRole("button", { name: /next month/i });
  fireEvent.click(screen.getByRole("button", { name: /next month/i }));
  await waitFor(() => expect(apiClient.trends.$get).toHaveBeenCalledWith({ query: { month: nextMonth } }));
});

test("a failed fetch shows an error block with a retry button and toasts once", async () => {
  vi.spyOn(apiClient.trends, "$get").mockRejectedValue(new Error("network error"));
  renderWithProviders(<Dashboard />);
  expect(await screen.findByRole("button", { name: /retry/i })).toBeInTheDocument();
  expect(showError).toHaveBeenCalledOnce();
});
```

(`renderWithProviders` wraps in `QueryClientProvider` + `MemoryRouter`; `mockTrendsGet`/`mockTrendsHistoryGet` are local helpers wrapping `vi.spyOn(apiClient.trends, "$get"/"history.$get")` — define them once in a shared `frontend/test/helpers.tsx` this step also creates, since every later page test reuses the same provider-wrapping/mocking shape.)

- [ ] **Step 2: Run the tests, confirm they fail**

Run: `npm --prefix frontend run test -- Dashboard`

- [ ] **Step 3: Implement `Dashboard.tsx`**

Two `useQuery`s: one keyed on `["trends", month]` calling `apiClient.trends.$get({query: {month}})` (local `month` state, defaulting to the current `YYYY-MM`, with prev/next buttons that shift it), one keyed on `["trends-history"]` calling `apiClient.trends.history.$get({query: {months: "6"}})`. Layout: a `StatDisplay` for the selected month's `totalCents` at top, a `Tile` grid below linking to Log Transaction / Budgets / Bills / Statement Upload, then the month's `byCategory` breakdown (one `Pill`+amount row per category, wrapped in a `Card`) with prev/next month buttons, then the multi-month chart (a simple bar chart — `<div>` bars scaled by `totalCents`, `data-testid="trends-history-chart"` on its container; a charting library is explicitly not required for 6 bars). Apply the canonical pattern described above for loading/error/empty.

- [ ] **Step 4: Run the tests, confirm they pass**

Run: `npm --prefix frontend run test -- Dashboard`

- [ ] **Step 5: Register the route and commit**

Add `{path: "/", element: <Dashboard />, errorElement: <ErrorPage />}` as a child of the layout route in `App.tsx`.

```bash
git add frontend/src/pages/Dashboard.tsx frontend/src/pages/Dashboard.test.tsx frontend/test/helpers.tsx frontend/src/App.tsx
git commit -m "feat: add Dashboard page (month breakdown + multi-month trend chart)"
```

---

### Task 10: Transactions page

**Files:**
- Create: `frontend/src/pages/Transactions.tsx`, `frontend/src/pages/Transactions.test.tsx`
- Modify: `frontend/src/App.tsx` (register `/transactions`)

**Interfaces:**
- Consumes: `apiClient.transactions.$get`, `apiClient.transactions[":id"].category.$patch`, `apiClient.transactions[":id"].$patch` (Task 1), `apiClient.transactions[":id"]["resolve-review"].$post` (Task 2); `Card`/`Pill`/`EmptyState`/`Modal` (Task 6); `showSuccess`/`showError` (Task 7); the loading/error/empty pattern from Task 9.
- Produces: nothing later tasks consume.

- [ ] **Step 1: Write the failing tests**

```typescript
test("shows a skeleton, then the transaction list", async () => {
  mockTransactionsList([buildTransaction({ vendorRaw: "Starbucks", amount: 1250 })]);
  renderWithProviders(<Transactions />);
  expect(screen.getByTestId("transactions-skeleton")).toBeInTheDocument();
  expect(await screen.findByText("Starbucks")).toBeInTheDocument();
});

test("shows an empty state when there are no transactions", async () => {
  mockTransactionsList([]);
  renderWithProviders(<Transactions />);
  expect(await screen.findByText(/no transactions yet/i)).toBeInTheDocument();
});

test("correcting a category calls the category-patch endpoint and toasts success", async () => {
  mockTransactionsList([buildTransaction({ id: 1, category: "Uncategorized" })]);
  mockCategoryPatch(1);
  renderWithProviders(<Transactions />);
  await userEvent.click(await screen.findByText("Uncategorized"));
  await userEvent.type(screen.getByRole("textbox", { name: /category/i }), "Coffee");
  await userEvent.click(screen.getByRole("button", { name: /save/i }));
  expect(apiClient.transactions[":id"].category.$patch).toHaveBeenCalled();
  expect(showSuccess).toHaveBeenCalledOnce();
});

test("[Review Focus] committing a quarantined row that matches toasts the dedup match, not just a generic success", async () => {
  mockTransactionsList([buildTransaction({ id: 2, reviewStatus: "pending_review" })]);
  mockResolveReview(2, { resolved: "commit", matched: true });
  renderWithProviders(<Transactions />);
  await userEvent.click(await screen.findByRole("button", { name: /resolve/i }));
  await userEvent.click(screen.getByRole("button", { name: /commit/i }));
  expect(showSuccess).toHaveBeenCalledWith(expect.stringMatching(/possible duplicate/i));
});

test("rejecting a quarantined row toasts a plain success, not a duplicate-match message", async () => {
  mockTransactionsList([buildTransaction({ id: 3, reviewStatus: "pending_review" })]);
  mockResolveReview(3, { resolved: "reject", matched: false });
  renderWithProviders(<Transactions />);
  await userEvent.click(await screen.findByRole("button", { name: /resolve/i }));
  await userEvent.click(screen.getByRole("button", { name: /reject/i }));
  expect(showSuccess).not.toHaveBeenCalledWith(expect.stringMatching(/possible duplicate/i));
});

test("a failed mutation toasts an error and does not update the list optimistically forever", async () => {
  mockTransactionsList([buildTransaction({ id: 4 })]);
  vi.spyOn(apiClient.transactions[":id"].category, "$patch").mockRejectedValue(new Error("fail"));
  renderWithProviders(<Transactions />);
  await userEvent.click(await screen.findByText(/uncategorized/i));
  await userEvent.type(screen.getByRole("textbox", { name: /category/i }), "x");
  await userEvent.click(screen.getByRole("button", { name: /save/i }));
  expect(await screen.findByText(/uncategorized/i)).toBeInTheDocument(); // reverted
  expect(showError).toHaveBeenCalledOnce();
});
```

- [ ] **Step 2: Run the tests, confirm they fail**

Run: `npm --prefix frontend run test -- Transactions`

- [ ] **Step 3: Implement `Transactions.tsx`**

`useQuery(["transactions"], () => apiClient.transactions.$get())`. Each row (`Card`): vendor, amount, a category `Pill` (click to edit inline — a small text input + save button, calling a `useMutation` wrapping `apiClient.transactions[":id"].category.$patch`, invalidating the `["transactions"]` query on success, `showSuccess("Category updated")`/`showError(...)` on settle). A `reviewStatus`/`dedupResolution` `Pill` when either is non-default. For a `pending_review` row: a "Resolve" button opening a `Modal` with editable vendor/amount/date/category fields (pre-filled, `PATCH /:id` via Task 1's route on save, only if any field changed) and Commit/Reject buttons (Task 2's route); on a `{matched: true}` response, `showSuccess("Committed — this matched a possible duplicate, check Dedup Review")`; otherwise `showSuccess("Committed")`/`showSuccess("Rejected")`. Apply Task 9's loading/error/empty pattern.

- [ ] **Step 4: Run the tests, confirm they pass**

Run: `npm --prefix frontend run test -- Transactions`

- [ ] **Step 5: Register the route and commit**

```bash
git add frontend/src/pages/Transactions.tsx frontend/src/pages/Transactions.test.tsx frontend/src/App.tsx
git commit -m "feat: add Transactions page (list, category correction, quarantine resolve)"
```

---

### Task 11: DedupReview page

**Files:**
- Create: `frontend/src/pages/DedupReview.tsx`, `frontend/src/pages/DedupReview.test.tsx`
- Modify: `frontend/src/App.tsx` (register `/dedup-review`)

**Interfaces:**
- Consumes: `apiClient.transactions.$get` (filtered client-side by `dedupResolution === "pending"`, since no dedicated list-by-dedup-status route exists), `apiClient.transactions[":id"]["resolve-dedup"].$post`; `Card`/`EmptyState`/`Button` (Task 6); `showSuccess`/`showError` (Task 7); Task 9's loading/error/empty pattern.
- Produces: nothing later tasks consume.

- [ ] **Step 1: Write the failing tests**

```typescript
test("groups candidate pairs by dedup_group_id and shows both sides", async () => {
  mockTransactionsList([
    buildTransaction({ id: 1, dedupGroupId: "g1", dedupResolution: "pending", vendorRaw: "Daraz", source: "gmail_email" }),
    buildTransaction({ id: 2, dedupGroupId: "g1", dedupResolution: "pending", vendorRaw: "Daraz", source: "statement_import" }),
  ]);
  renderWithProviders(<DedupReview />);
  expect(await screen.findAllByText("Daraz")).toHaveLength(2);
});

test("shows an empty state when there are no pending candidates", async () => {
  mockTransactionsList([]);
  renderWithProviders(<DedupReview />);
  expect(await screen.findByText(/no duplicates to review/i)).toBeInTheDocument();
});

test("keeping one side resolves the pair and removes it from the list", async () => {
  mockTransactionsList([
    buildTransaction({ id: 1, dedupGroupId: "g1", dedupResolution: "pending" }),
    buildTransaction({ id: 2, dedupGroupId: "g1", dedupResolution: "pending" }),
  ]);
  mockResolveDedup(1, { resolved: "kept" });
  renderWithProviders(<DedupReview />);
  await userEvent.click((await screen.findAllByRole("button", { name: /keep this one/i }))[0]);
  expect(apiClient.transactions[":id"]["resolve-dedup"].$post).toHaveBeenCalledWith(
    expect.objectContaining({ param: { id: "1" } }),
    expect.objectContaining({})
  );
  expect(showSuccess).toHaveBeenCalledOnce();
});

test("batch-resolving several pairs at once (backfill-scale) is available as a multi-select action", async () => {
  mockTransactionsList(Array.from({ length: 4 }, (_, i) => buildTransaction({ id: i + 1, dedupGroupId: `g${Math.floor(i / 2)}`, dedupResolution: "pending" })));
  renderWithProviders(<DedupReview />);
  const checkboxes = await screen.findAllByRole("checkbox", { name: /select this pair/i });
  await userEvent.click(checkboxes[0]);
  await userEvent.click(checkboxes[1]);
  expect(screen.getByRole("button", { name: /resolve selected/i })).toBeEnabled();
});
```

- [ ] **Step 2: Run the tests, confirm they fail**

Run: `npm --prefix frontend run test -- DedupReview`

- [ ] **Step 3: Implement `DedupReview.tsx`**

`useQuery(["transactions"], ...)`, filter client-side to `dedupResolution === "pending"`, group by `dedupGroupId` into pairs. Each pair renders as two adjacent `Card`s with a checkbox ("select this pair") plus three `Button`s (Keep this one / appears on each side — clicking one resolves that side as `"kept"` via `resolve-dedup`; Confirm distinct). A `useMutation` wrapping `apiClient.transactions[":id"]["resolve-dedup"].$post`, invalidating `["transactions"]` on success, `showSuccess`/`showError` on settle. A header "Resolve selected" button (enabled once ≥1 pair is checked) applying the same mutation across every selected pair's chosen action — per the design doc's "What's left to the builder" note, implement this as checkbox-multi-select (not swipe) since that's the more testable, more accessible choice for a batch action spanning many pairs. Apply Task 9's loading/error/empty pattern.

- [ ] **Step 4: Run the tests, confirm they pass**

Run: `npm --prefix frontend run test -- DedupReview`

- [ ] **Step 5: Register the route and commit**

```bash
git add frontend/src/pages/DedupReview.tsx frontend/src/pages/DedupReview.test.tsx frontend/src/App.tsx
git commit -m "feat: add Dedup Review page with batch multi-select resolution"
```

---

### Task 12: LogMissedTransaction page

**Files:**
- Create: `frontend/src/pages/LogMissedTransaction.tsx`, `frontend/src/pages/LogMissedTransaction.test.tsx`
- Modify: `frontend/src/App.tsx` (register `/log-transaction`)

**Interfaces:**
- Consumes: `apiClient["missed-transactions"].$post`; `Button` (Task 6); `showSuccess`/`showError` (Task 7).
- Produces: nothing later tasks consume.

- [ ] **Step 1: Write the failing tests**

```typescript
test("submitting a valid entry posts to missed-transactions and shows a success toast", async () => {
  mockMissedTransactionPost({ id: 1, category: "Coffee" });
  renderWithProviders(<LogMissedTransaction />);
  await userEvent.type(screen.getByLabelText(/vendor/i), "Corner store");
  await userEvent.type(screen.getByLabelText(/amount/i), "10.00");
  await userEvent.type(screen.getByLabelText(/date/i), "2026-11-01");
  await userEvent.click(screen.getByRole("button", { name: /log transaction/i }));
  expect(await screen.findByText(/logged as coffee/i)).toBeInTheDocument();
  expect(showSuccess).toHaveBeenCalledOnce();
});

test("a validation failure from the backend shows the error inline, not just a toast", async () => {
  vi.spyOn(apiClient["missed-transactions"], "$post").mockResolvedValue(
    new Response("amountCents must be a positive integer", { status: 400 })
  );
  renderWithProviders(<LogMissedTransaction />);
  await userEvent.type(screen.getByLabelText(/vendor/i), "x");
  await userEvent.type(screen.getByLabelText(/amount/i), "0");
  await userEvent.type(screen.getByLabelText(/date/i), "2026-11-01");
  await userEvent.click(screen.getByRole("button", { name: /log transaction/i }));
  expect(await screen.findByText(/amountCents must be a positive integer/i)).toBeInTheDocument();
});

test("the form resets after a successful submission, ready for the next entry", async () => {
  mockMissedTransactionPost({ id: 1, category: "Coffee" });
  renderWithProviders(<LogMissedTransaction />);
  await userEvent.type(screen.getByLabelText(/vendor/i), "Corner store");
  await userEvent.type(screen.getByLabelText(/amount/i), "10.00");
  await userEvent.type(screen.getByLabelText(/date/i), "2026-11-01");
  await userEvent.click(screen.getByRole("button", { name: /log transaction/i }));
  await screen.findByText(/logged as coffee/i);
  expect(screen.getByLabelText(/vendor/i)).toHaveValue("");
});
```

- [ ] **Step 2: Run the tests, confirm they fail**

Run: `npm --prefix frontend run test -- LogMissedTransaction`

- [ ] **Step 3: Implement `LogMissedTransaction.tsx`**

Deliberately the plainest page (per the design doc) — a single-column form (vendor text input, amount text input parsed to cents via `Math.round(parseFloat(value) * 100)`, date input), a `useMutation` wrapping `apiClient["missed-transactions"].$post({json: {vendorRaw, amountCents, date}})`. On success: show the returned `category` inline ("Logged as {category}"), `showSuccess`, reset the form. On a non-2xx response: read the response body as text and render it inline above the form (not just a toast — per this task's own second test, since a form error benefits from staying visible, unlike a one-off action's toast).

- [ ] **Step 4: Run the tests, confirm they pass**

Run: `npm --prefix frontend run test -- LogMissedTransaction`

- [ ] **Step 5: Register the route and commit**

```bash
git add frontend/src/pages/LogMissedTransaction.tsx frontend/src/pages/LogMissedTransaction.test.tsx frontend/src/App.tsx
git commit -m "feat: add Log Missed Transaction page"
```

---

### Task 13: StatementUpload page

**Files:**
- Create: `frontend/src/pages/StatementUpload.tsx`, `frontend/src/pages/StatementUpload.test.tsx`
- Modify: `frontend/src/App.tsx` (register `/statement-upload`)

**Interfaces:**
- Consumes: `apiClient.statements.$post` (multipart); `Button`/`EmptyState` (Task 6); `showSuccess`/`showError` (Task 7).
- Produces: nothing later tasks consume.

- [ ] **Step 1: Write the failing tests**

```typescript
test("uploading a CSV posts multipart form data and shows the imported/quarantined counts", async () => {
  mockStatementPost({ imported: 5 });
  renderWithProviders(<StatementUpload />);
  const file = new File(["Date,Description,Amount\n2026-10-27,Starbucks,12.50"], "statement.csv", { type: "text/csv" });
  await userEvent.upload(screen.getByLabelText(/choose file/i), file);
  await userEvent.click(screen.getByRole("button", { name: /upload/i }));
  expect(await screen.findByText(/5 (row|transaction)/i)).toBeInTheDocument();
  expect(showSuccess).toHaveBeenCalledOnce();
});

test("a non-CSV file is rejected client-side before any request is made", async () => {
  renderWithProviders(<StatementUpload />);
  const file = new File(["not a csv"], "statement.pdf", { type: "application/pdf" });
  await userEvent.upload(screen.getByLabelText(/choose file/i), file);
  await userEvent.click(screen.getByRole("button", { name: /upload/i }));
  expect(await screen.findByText(/must be a csv/i)).toBeInTheDocument();
  expect(apiClient.statements.$post).not.toHaveBeenCalled();
});

test("[Review Focus] a submitted file's own content is never rendered unmasked outside this page's own result view", async () => {
  mockStatementPost({ imported: 1 });
  renderWithProviders(<StatementUpload />);
  const file = new File(["Date,Description,Amount\n2026-10-27,Acct 1234567890,12.50"], "statement.csv", { type: "text/csv" });
  await userEvent.upload(screen.getByLabelText(/choose file/i), file);
  await userEvent.click(screen.getByRole("button", { name: /upload/i }));
  await screen.findByText(/1 (row|transaction)/i);
  // the result summary shows counts only, never the raw row content
  expect(screen.queryByText(/1234567890/)).not.toBeInTheDocument();
});

test("a backend rejection (400/422) surfaces the exact reason", async () => {
  vi.spyOn(apiClient.statements, "$post").mockResolvedValue(new Response("file has no data rows to import", { status: 422 }));
  renderWithProviders(<StatementUpload />);
  const file = new File(["Date,Description,Amount\n"], "empty.csv", { type: "text/csv" });
  await userEvent.upload(screen.getByLabelText(/choose file/i), file);
  await userEvent.click(screen.getByRole("button", { name: /upload/i }));
  expect(await screen.findByText(/no data rows to import/i)).toBeInTheDocument();
});
```

- [ ] **Step 2: Run the tests, confirm they fail**

Run: `npm --prefix frontend run test -- StatementUpload`

- [ ] **Step 3: Implement `StatementUpload.tsx`**

A file input (`accept=".csv,text/csv"`) + Upload button. Client-side: reject (inline message, no request) a selected file whose name doesn't end in `.csv` and whose type isn't `text/csv`/`text/plain` — mirrors the backend's own `looksLikeCsv` check from `statements.ts`, so the user gets instant feedback instead of waiting on a round trip for the same rejection. On upload: build a `FormData` with the file under `"file"`, `useMutation` wrapping `apiClient.statements.$post({form: formData})`. On success: show only `{imported: N}`'s count ("Imported N rows") — never render any row content back (satisfies the Review Focus item; there is nothing in this page's own state to accidentally leak since the response body itself never contains row content). On a non-2xx response: read the body text and show it inline (same pattern as Task 12).

- [ ] **Step 4: Run the tests, confirm they pass**

Run: `npm --prefix frontend run test -- StatementUpload`

- [ ] **Step 5: Register the route and commit**

```bash
git add frontend/src/pages/StatementUpload.tsx frontend/src/pages/StatementUpload.test.tsx frontend/src/App.tsx
git commit -m "feat: add Statement Upload page"
```

---

### Task 14: Budgets page

**Files:**
- Create: `frontend/src/pages/Budgets.tsx`, `frontend/src/pages/Budgets.test.tsx`
- Modify: `frontend/src/App.tsx` (register `/budgets`)

**Interfaces:**
- Consumes: `apiClient.budgets.$get/$post`, `apiClient.budgets[":id"].$patch/$delete`; `Card`/`StatDisplay`/`EmptyState`/`Modal` (Task 6); `showSuccess`/`showError` (Task 7); Task 9's loading/error/empty pattern.
- Produces: nothing later tasks consume.

- [ ] **Step 1: Write the failing tests**

```typescript
test("shows a skeleton, then budgets with a spent-vs-limit StatDisplay", async () => {
  mockBudgetsList([buildBudget({ category: "Coffee", limitAmount: 10000 })]);
  mockTrendsGet({ month: expect.any(String), totalCents: 8000, byCategory: [{ category: "Coffee", totalCents: 8000 }], hasData: true });
  renderWithProviders(<Budgets />);
  expect(screen.getByTestId("budgets-skeleton")).toBeInTheDocument();
  expect(await screen.findByText("Coffee")).toBeInTheDocument();
  expect(screen.getByText(/80%/)).toBeInTheDocument();
});

test("shows an empty state with a create action when there are no budgets", async () => {
  mockBudgetsList([]);
  renderWithProviders(<Budgets />);
  expect(await screen.findByRole("button", { name: /create budget/i })).toBeInTheDocument();
});

test("creating a budget with a non-monthly period is rejected client-side with the backend's own message style", async () => {
  mockBudgetsList([]);
  renderWithProviders(<Budgets />);
  await userEvent.click(await screen.findByRole("button", { name: /create budget/i }));
  await userEvent.type(screen.getByLabelText(/category/i), "Rent");
  await userEvent.type(screen.getByLabelText(/limit/i), "0");
  await userEvent.click(screen.getByRole("button", { name: /save/i }));
  expect(await screen.findByText(/positive integer/i)).toBeInTheDocument();
  expect(apiClient.budgets.$post).not.toHaveBeenCalled();
});

test("deleting a budget asks for confirmation before calling delete", async () => {
  mockBudgetsList([buildBudget({ id: 1, category: "Coffee" })]);
  mockBudgetDelete(1);
  renderWithProviders(<Budgets />);
  await userEvent.click(await screen.findByRole("button", { name: /delete/i }));
  expect(screen.getByRole("dialog")).toBeInTheDocument(); // Modal confirmation
  await userEvent.click(screen.getByRole("button", { name: /confirm/i }));
  expect(apiClient.budgets[":id"].$delete).toHaveBeenCalled();
  expect(showSuccess).toHaveBeenCalledOnce();
});
```

- [ ] **Step 2: Run the tests, confirm they fail**

Run: `npm --prefix frontend run test -- Budgets`

- [ ] **Step 3: Implement `Budgets.tsx`**

`useQuery(["budgets"], ...)` plus `useQuery(["trends", currentMonth], ...)` (reused, same query key Task 9 uses — TanStack Query dedupes this automatically if Dashboard's query is already cached) to compute each budget's spent-vs-limit percentage from the current month's `byCategory`. Each budget row (`Card` + `StatDisplay` showing "{spent} / {limit}" and the percentage): Edit (inline, `PATCH`) and Delete (opens a `Modal` confirmation before calling `DELETE`) actions. A "Create budget" button/form validating `limitAmount` as a positive integer and `periodType` fixed to `"monthly"` client-side before ever calling `POST` — mirroring the backend's own validation message wording so the inline error reads consistently whether it came from a client-side check or a server rejection. `useMutation`s for create/edit/delete, each invalidating `["budgets"]` and toasting on settle. Apply Task 9's loading/error/empty pattern.

- [ ] **Step 4: Run the tests, confirm they pass**

Run: `npm --prefix frontend run test -- Budgets`

- [ ] **Step 5: Register the route and commit**

```bash
git add frontend/src/pages/Budgets.tsx frontend/src/pages/Budgets.test.tsx frontend/src/App.tsx
git commit -m "feat: add Budgets page"
```

---

### Task 15: Bills page

**Files:**
- Create: `frontend/src/pages/Bills.tsx`, `frontend/src/pages/Bills.test.tsx`
- Modify: `frontend/src/App.tsx` (register `/bills`)

**Interfaces:**
- Consumes: `apiClient.bills.$get/$post`, `apiClient.bills[":id"].$patch/$delete`; `Card`/`Pill`/`EmptyState`/`Modal` (Task 6); `showSuccess`/`showError` (Task 7); Task 9's loading/error/empty pattern.
- Produces: nothing later tasks consume.

- [ ] **Step 1: Write the failing tests**

```typescript
test("shows a skeleton, then bills with a due-date Pill", async () => {
  mockBillsList([buildBill({ vendor: "Netflix", nextDueDate: "2026-11-15" })]);
  renderWithProviders(<Bills />);
  expect(screen.getByTestId("bills-skeleton")).toBeInTheDocument();
  expect(await screen.findByText("Netflix")).toBeInTheDocument();
  expect(screen.getByText("2026-11-15")).toBeInTheDocument();
});

test("shows an empty state when there are no bills", async () => {
  mockBillsList([]);
  renderWithProviders(<Bills />);
  expect(await screen.findByRole("button", { name: /add bill/i })).toBeInTheDocument();
});

test("creating a bill with a malformed due date is rejected client-side", async () => {
  mockBillsList([]);
  renderWithProviders(<Bills />);
  await userEvent.click(await screen.findByRole("button", { name: /add bill/i }));
  await userEvent.type(screen.getByLabelText(/vendor/i), "Spotify");
  await userEvent.type(screen.getByLabelText(/expected amount/i), "500");
  await userEvent.type(screen.getByLabelText(/next due date/i), "not-a-date");
  await userEvent.click(screen.getByRole("button", { name: /save/i }));
  expect(await screen.findByText(/valid.*date/i)).toBeInTheDocument();
  expect(apiClient.bills.$post).not.toHaveBeenCalled();
});

test("editing a bill's next due date calls PATCH and toasts success", async () => {
  mockBillsList([buildBill({ id: 1, nextDueDate: "2026-11-15" })]);
  mockBillPatch(1);
  renderWithProviders(<Bills />);
  await userEvent.click(await screen.findByRole("button", { name: /edit/i }));
  await userEvent.clear(screen.getByLabelText(/next due date/i));
  await userEvent.type(screen.getByLabelText(/next due date/i), "2026-12-15");
  await userEvent.click(screen.getByRole("button", { name: /save/i }));
  expect(apiClient.bills[":id"].$patch).toHaveBeenCalled();
  expect(showSuccess).toHaveBeenCalledOnce();
});
```

- [ ] **Step 2: Run the tests, confirm they fail**

Run: `npm --prefix frontend run test -- Bills`

- [ ] **Step 3: Implement `Bills.tsx`**

Same shape as `Budgets.tsx`: `useQuery(["bills"], ...)`, each row a `Card` with a due-date `Pill`, Edit/Delete actions, a client-side-validated create form (`expectedAmount` positive integer, `nextDueDate` the same round-trip ISO check used elsewhere — reuse, don't reinvent, the validation logic pattern already established in Task 1/12/13; `expectedInterval` free text per the backend's own lack of a fixed set). `useMutation`s invalidating `["bills"]`, toasting on settle. Apply Task 9's loading/error/empty pattern.

- [ ] **Step 4: Run the tests, confirm they pass**

Run: `npm --prefix frontend run test -- Bills`

- [ ] **Step 5: Register the route and commit**

```bash
git add frontend/src/pages/Bills.tsx frontend/src/pages/Bills.test.tsx frontend/src/App.tsx
git commit -m "feat: add Bills page"
```

---

### Task 16: CaptureHealth page

**Files:**
- Create: `frontend/src/pages/CaptureHealth.tsx`, `frontend/src/pages/CaptureHealth.test.tsx`
- Modify: `frontend/src/App.tsx` (register `/capture-health`)

**Interfaces:**
- Consumes: `apiClient.capture.health.$get`, `apiClient.capture.backfill.$post`; `Card`/`Pill`/`EmptyState` (Task 6); `showSuccess`/`showError` (Task 7); Task 4's `?connected=1`/`?error=<reason>` redirect params; Task 9's loading/error/empty pattern.
- Produces: nothing later tasks consume.

- [ ] **Step 1: Write the failing tests**

```typescript
test("shows a 'Connected' status Pill when runStatus is success", async () => {
  mockCaptureHealthGet({ runStatus: "success", lastAttemptedRun: "2026-11-01T00:00:00Z", lastSuccessfulRun: "2026-11-01T00:00:00Z", errorType: null });
  renderWithProviders(<CaptureHealth />);
  expect(await screen.findByText(/connected/i)).toBeInTheDocument();
});

test("shows a 'Needs reconnect' status and a reconnect link when errorType is auth_failure", async () => {
  mockCaptureHealthGet({ runStatus: "api_call_failed", lastAttemptedRun: "2026-11-01T00:00:00Z", lastSuccessfulRun: null, errorType: "auth_failure" });
  renderWithProviders(<CaptureHealth />);
  expect(await screen.findByText(/needs reconnect/i)).toBeInTheDocument();
  const link = screen.getByRole("link", { name: /reconnect/i });
  expect(link).toHaveAttribute("href", "/api/auth/gmail/reconnect");
});

test("shows a never-run empty state for a fresh install", async () => {
  mockCaptureHealthGet({ runStatus: "job_did_not_run", lastAttemptedRun: null, lastSuccessfulRun: null, errorType: null });
  renderWithProviders(<CaptureHealth />);
  expect(await screen.findByText(/never run|not connected yet/i)).toBeInTheDocument();
});

test("[Review Focus] landing with ?connected=1 shows a one-time success banner", async () => {
  mockCaptureHealthGet({ runStatus: "job_did_not_run", lastAttemptedRun: null, lastSuccessfulRun: null, errorType: null });
  renderWithProviders(<CaptureHealth />, { initialEntries: ["/capture-health?connected=1"] });
  expect(await screen.findByText(/gmail connected/i)).toBeInTheDocument();
});

test("[Review Focus] landing with ?error=exchange_failed shows the specific named failure, not a generic message", async () => {
  mockCaptureHealthGet({ runStatus: "job_did_not_run", lastAttemptedRun: null, lastSuccessfulRun: null, errorType: null });
  renderWithProviders(<CaptureHealth />, { initialEntries: ["/capture-health?error=exchange_failed"] });
  expect(await screen.findByText(/token exchange failed/i)).toBeInTheDocument();
});

test("a manual backfill trigger calls the backfill endpoint and toasts its result", async () => {
  mockCaptureHealthGet({ runStatus: "success", lastAttemptedRun: "2026-11-01T00:00:00Z", lastSuccessfulRun: "2026-11-01T00:00:00Z", errorType: null });
  mockCaptureBackfillPost({ processed: 3, nextPageToken: null });
  renderWithProviders(<CaptureHealth />);
  await userEvent.click(await screen.findByRole("button", { name: /run backfill now/i }));
  expect(await screen.findByText(/3/)).toBeInTheDocument();
  expect(showSuccess).toHaveBeenCalledOnce();
});
```

- [ ] **Step 2: Run the tests, confirm they fail**

Run: `npm --prefix frontend run test -- CaptureHealth`

- [ ] **Step 3: Implement `CaptureHealth.tsx`**

`useQuery(["capture-health"], () => apiClient.capture.health.$get())`. Status `Pill`: `runStatus === "success"` → "Connected"; `errorType === "auth_failure"` → "Needs reconnect" + a plain `<a href="/api/auth/gmail/reconnect">Reconnect</a>` (a real navigation, not a `Link`/fetch — this leaves the SPA entirely for Google's consent screen, so it must be a real anchor); `runStatus === "job_did_not_run"` with no prior run → an `EmptyState` ("Gmail not connected yet" + a `/api/auth/gmail/connect` anchor); any other `api_call_failed` → the named failure reason from `errorType`, using the same "name the specific problem" language the backend's Watchdog alert copy uses. Read `useSearchParams()` for `connected`/`error`: `connected=1` → a dismissible success banner ("Gmail connected"); `error=<reason>` → map each of Task 4's six reason codes to a plain-language sentence (e.g. `exchange_failed` → "Token exchange failed — try reconnecting."), shown as an error banner, not folded into the status `Pill` (which reflects server state, not this one-time redirect result). A "Run backfill now" button, a `useMutation` wrapping `apiClient.capture.backfill.$post()`, showing `{processed}` on success. Apply Task 9's loading/error/empty pattern for the health query itself.

- [ ] **Step 4: Run the tests, confirm they pass**

Run: `npm --prefix frontend run test -- CaptureHealth`

- [ ] **Step 5: Register the route and commit**

```bash
git add frontend/src/pages/CaptureHealth.tsx frontend/src/pages/CaptureHealth.test.tsx frontend/src/App.tsx
git commit -m "feat: add Capture Health page with reconnect flow"
```

---

### Task 17: Final wiring and worst-case pass

**Files:**
- Modify: `frontend/src/components/AppShell.tsx` (confirm every nav link/quick-action `Tile` points at a real registered route — none should be a dead placeholder from Task 8)
- No new source files; this task is verification plus small copy/wiring fixes.

**Interfaces:**
- Consumes: every page from Tasks 9-16.
- Produces: nothing — final task.

- [ ] **Step 1: Confirm every route is reachable from the UI, not just the router**

Click through from `AppShell`'s nav and the Dashboard's `Tile` grid to each of the 8 pages in a running `npm --prefix frontend run dev` session (manual — no automated test for this step; record any dead link found and fix it before continuing).

- [ ] **Step 2: Run a worst-case-data pass per page (the `break-ui` skill)**

For each page, feed it worst-case props/mock data through its existing tests' mocking seams: a very long vendor name, a zero-amount transaction, a huge amount (e.g. 99999999 cents), an empty list, a single-character category, non-Latin vendor text. Add one test per page for whichever case that page's own layout is most likely to break on (e.g. Transactions: a long vendor name doesn't overflow its `Card`; Dashboard: a single-category month doesn't break the chart's bar-width math; CaptureHealth: an `errorType` value with no mapped sentence falls back to a generic "Something's wrong with Gmail capture" rather than rendering `undefined`).

- [ ] **Step 3: Run the full verification suite**

Run: `npm --prefix backend run test` — expect every backend test (including Tasks 1-4's additions) passing.
Run: `npm --prefix backend run build` — expect a clean `tsc --noEmit`.
Run: `npm --prefix frontend run test` — expect every frontend test passing.
Run: `npm --prefix frontend run build` — expect a clean `tsc --noEmit` + Vite build.

- [ ] **Step 4: Commit**

```bash
git add frontend/
git commit -m "test: add worst-case coverage pass across all pages; fix any dead links found"
```
