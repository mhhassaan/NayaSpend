# NayaSpend Development Log

A running log of what was built, in what order, and why — including the
rulings made when the spec was silent, ambiguous, or wrong. Updated as
work happens, not reconstructed after the fact. Each entry should let a
reader understand a decision without re-reading the full session.

---

## 2026-11-02 — Environment & tooling setup

- Explored `F:\Projects\NayaSpend` (continuation of a prior design pass
  done at `D:\projects\alfaaz`). Found a complete, EGM-reviewed design
  doc (`docs/designs/personal-spending-tracker.md`), brand guidelines,
  and an `AGENT_SKILLS.md` install manifest, but zero application code
  and no git repository yet.
- Installed the skills/plugins named in `AGENT_SKILLS.md`:
  - `npx skills add emilkowalski/skills` (16 skills: animation, design,
    Swift, mobile-native, etc.) and `mattpocock/skills --skill handoff`.
    Required installing Node.js first (not present); PATH had to be set
    manually per-command since the shell didn't pick up the fresh
    install automatically.
  - `claude plugin install egm@egm`, `i-have-adhd@i-have-adhd`,
    `superpowers@superpowers-marketplace` — required installing the
    Claude Code CLI itself, then the user granting a PowerShell
    permission rule (auto-mode's classifier flags marketplace/plugin
    installs as "Untrusted Code Integration" by default).
- `git init`'d the project (it had no VCS at all) and made an initial
  commit of the existing design docs, research screenshots, and
  installed skills.
- **Decision:** work would proceed as one implementation plan per
  design-doc Build Phase (0 through 8), each in its own git worktree,
  executed with `superpowers:writing-plans` →
  `superpowers:executing-plans`, ending in a fresh-reviewer pass before
  merging to `master`. Native (inline) execution chosen over
  subagent-driven-development for cost, since a mistake here is cheap to
  catch via the final review.

---

## Phase 0–1: Foundations — **merged to `master`**

**Plan:** `docs/superpowers/plans/2026-11-02-foundations.md`

Scope: D1 feasibility spike, project scaffolding, config module, AES-256-GCM
token encryption, the canonical D1 schema + migration, and the
categorization engine.

**Key decisions:**
- Confirmed via a throwaway-table spike that D1's SQLite dialect can
  express the three query shapes the dedup/trends engines would need
  (date-range `BETWEEN`, `GROUP BY` aggregation, `LIKE` pre-filter) —
  de-risking the Postgres-vs-D1 choice the spec flagged as a risk.
- `TOKEN_ENCRYPTION_KEY` validated to decode to exactly 32 bytes (AES-256)
  in both `config.ts` and `security.ts`'s `importKey` (defense in depth).
- `amount` enforced as integer minor units via a DB-level `CHECK`
  constraint (SQLite is dynamically typed, so TypeScript types alone
  don't stop a float from being written).

**Final review (fresh reviewer) found, all fixed before merge:**
- Migration/schema drift: the `CHECK` constraint had been hand-patched
  into the migration SQL instead of regenerated from the schema —
  regenerated it fresh so `drizzle-kit` and the schema agree.
- `TOKEN_ENCRYPTION_KEY` validation only checked *presence*, not
  *length/format* — a malformed or wrong-length key would silently
  downgrade the cipher or fail obscurely later. Fixed.
- The scaffolded `lint` script was broken (ESLint 9, no config file).
  Added a working flat config.

**Deferred (minor, not yet addressed):** tamper-test specificity, missing
`CHECK`s on `budgets`/`bills` minor-units columns, unconstrained `date`
column, private vendor-normalizer (later exported in Phase 2 out of
necessity), non-atomic `correctCategory` upsert, tsconfig/test-tsconfig
split, duplicate `Env` type definitions, a dead `allowScripts` block,
missing `drizzle.config.ts` comment about migration path.

**Flagged to the user:** the spec's open questions (category taxonomy,
exact bank formats, budget period model, notification provider, NayaPay
parsing approach, OAuth token lifecycle, dedup matching thresholds, data
retention, D1 query ceiling) remain unresolved — this phase only
de-risked the D1 ceiling one.

---

## Phase 2: Gmail capture (backfill only) — **merged to `master`**

**Plan:** `docs/superpowers/plans/2026-11-03-gmail-backfill.md`

Scope: Gmail REST client, NayaPay email parser, chunked/resumable backfill
orchestration, Gmail OAuth routes.

**Plan-level rulings:**
- Excluded spec item 27 (`dedupEngine.test.ts`) — the spec's own Build
  Phases list assigns it to both Phase 2 and Phase 3, but `dedupEngine.ts`
  doesn't exist until Phase 3.
- Pulled in `authGmail.ts` (OAuth routes) even though the spec's Build
  Phases list never assigns it to *any* phase — nothing in Phase 2 is
  testable end-to-end without a connected account.
- Invented NayaPay email parsing rules (regex-based) against synthetic
  fixtures, since no real sample emails exist — flagged for validation
  against real emails later.

**Final review (fresh reviewer) found 3 Critical + 8 Important issues —
all Critical and most Important fixed before merge:**

| # | Issue | Fix |
|---|---|---|
| C1 | Client-side `.slice()` truncation after the fact silently dropped ~half of every Gmail page instead of using Gmail's own `maxResults` | Pass `maxResults` through to the real API call |
| C2 | No idempotency check; a Worker crash or retry mid-chunk duplicated committed transactions | Unique `transactions.gmail_message_id` + `onConflictDoNothing`; build all rows in memory, write them + the checkpoint update as **one atomic `db.batch`** |
| C3 | `backfillPageToken: null` meant both "finished" and "never started" — a finished backfill would silently restart and re-import everything | Added `capture_runs.backfill_completed_at` as the authoritative completion marker |
| I1 | `GmailClient` never checked `response.ok` — an auth failure looked like a successful empty page | Typed `GmailApiError` with `errorType` classification; per-message fetch failures skipped, not fatal to the chunk |
| I2 | Amount/vendor regex false-positived on promotional emails (matched "rs" inside "offe**rs**", grabbed an early "Welcome to NayaPay" as the vendor) | Anchored amount match to "spent" immediately preceding the currency marker; vendor searched only *after* the matched amount |
| I3 | 3+ decimal digits silently rounded | Quarantine instead of rounding |
| I4 | Quarantined rows had no subject/body for the user to review against | Added subject + body excerpt to every row's provenance |
| I5 | No diagnostic query/scan/match logging | Added per-invocation `{query, scanned, committed, quarantined, fetchFailed}` log |
| I6 (a) | OAuth callback could overwrite a working credential with empty/broken data from a malformed token response | Validate `access_token`/`expires_in`; keep existing `refresh_token` when Google's response omits one |
| I7 | `gmailClient` took a `query` param that *could* be called unscoped; two tests passed without proving what they claimed | Removed the `query` param entirely (uses `NAYAPAY_QUERY` internally — structurally impossible to call unscoped); fixed the weak tests |
| I8 | Transaction date used raw UTC instead of an explicit body date or local (Asia/Karachi) time — could land spends on the wrong calendar day | Prefer an explicit date in the email body; fall back to a fixed UTC+5 conversion |

**Deferred:** I6(b) — OAuth CSRF `state` parameter. The route isn't mounted
into the app yet (that's Phase 7/8 wiring), so there's no live,
internet-reachable `/callback` endpoint to attack yet. **Flagged strongly**
for whoever mounts it: add `state`-cookie generation/verification before
exposing this publicly.

---

## Phase 3: Statement import (CSV) + Dedup engine — **merged to `master`**

**Plan:** `docs/superpowers/plans/2026-11-03-statement-dedup.md`

Scope: CSV bank-statement adapter, the cross-channel dedup engine, wiring
dedup checks into both the Gmail and statement adapters.

**Plan-level rulings:**
- **Did not use the spec-named `string-similarity` npm package.** It's
  deprecated/archived on npm, and actually implements the Sørensen-Dice
  coefficient, not Jaro-Winkler as the spec claims. Implemented a small
  self-contained bigram Dice function instead — same algorithm the
  spec's chosen package actually runs, with no supply-chain dependency.
  **Flagged to the user:** the spec doc should be corrected here.
- CSV column recognition uses provisional regex-matched header names
  (date/description/amount variants), since exact bank formats remain an
  open spec question.
- Date-proximity tolerance (±3 days) and vendor-similarity threshold
  (0.5) are named, provisional constants pending real data to tune them.

**Final review (fresh reviewer) found 3 Critical + 7 Important issues —
all fixed except one Critical, re-graded and deferred (see below):**

| # | Issue | Fix |
|---|---|---|
| C1 | **Dedup engine corrupted existing groups.** No filter excluded already-grouped candidates and no ordering was applied — a third matching row (e.g. the same coffee shop two days running) could orphan an existing pair's group and miss the real duplicate, silently double-counting spend | Exclude already-grouped/soft-deleted candidates; return early if the *subject* already has a group; order candidates by date proximity; write both sides of a match in one atomic `db.batch` |
| C2 | A non-ISO CSV date (e.g. DD/MM/YYYY, common in local bank exports) crashed the import partway through a file | Validate/normalize the date column; quarantine on failure instead of letting it throw downstream |
| I1 | No idempotency key for statement rows — any retry after a partial failure duplicated every row already landed | Unique `transactions.statement_row_key` ("`<fileRef>:<rowIndex>`") + `onConflictDoNothing` |
| I2 | A thrown dedup check (e.g. transient D1 error) propagated out and crashed the whole import/chunk *after* the capture itself had already succeeded | Both adapters now catch and log a dedup-check failure instead of losing already-committed rows |
| I3 | Amount parser accepted trailing garbage (`"12abc"` → `12`), trailing-minus, and `DR`/`CR` notations, silently losing the sign or committing a wrong value | Strict `^-?\d+(\.\d{1,2})?$` validation after stripping currency/parens |
| I4 | `"Rs. 1,250"` failed to parse — `\b` doesn't match between `.` and a space | Strip currency markers as a leading prefix, not a `\b`-bounded substring |
| I5/I6 | Missing test coverage; two existing tests passed for the wrong reason (unrelated date/vendor mismatches, not the filter supposedly under test) | Added the missing cases; rewrote both tests to seed a row that would actually match if the filter were removed |
| I7 | Papaparse's own field-count errors (unquoted comma shifting columns) were ignored, risking committing a value from the wrong column; a missing vendor field would crash `normalize(undefined)` | Quarantine rows with a reported parse error or a missing required field |

**Re-graded and deferred:** C3 (full backfill-scale chunking/resumability
for statement import — D1 query-count ceiling on very large files) was
downgraded from Critical to Important-deferred. I1's idempotency fix
makes a retry *safe* (no duplicates), just not yet *cheap* (still
re-scans every row). A proper fix needs a persisted per-file checkpoint,
which belongs with Phase 7's statement-upload route — which doesn't exist
yet, so there's no live caller that could hit the ceiling today.
**Flagged strongly** for whoever builds that route.

---

## Phase 4: PDF statement parsing — **skipped (gated, by design)**

The spec's own Build Phases explicitly gate this phase on resolving which
banks/formats are in scope — an unresolved open question with no real
sample statements available. The spec itself says this phase "can be
deferred past initial launch if unresolved." Skipped for now; revisit
once real bank statement samples exist.

---

## Phase 5: Ongoing Gmail polling + reliability — merged to master

**Plan:** `docs/superpowers/plans/2026-11-03-ongoing-polling-reliability.md`
**Branch:** `worktree-ongoing-polling` (merged, deleted)

Scope: forward (`historyId`-based) Gmail polling, the Capture Scheduler
cron handler with Cloudflare Queue retry backoff, the Watchdog, and the
notification engine they both depend on.

**Plan-level rulings:**
- **Pulled `notificationEngine.ts` (spec item 14) forward from Phase 7.**
  The spec's own design says the Gmail capture health alert delivers
  through the same layer as budget/bill notifications — Watchdog can't
  function without it, and Phase 7 doesn't exist yet. Phase 7 will add
  `budgetAlertTrigger`/`billReminderTrigger` as additional callers of
  this same engine, not rebuild it.
- Added `listHistory`/`getCurrentHistoryId` to `gmailClient.ts` for the
  Gmail `users.history.list`/`users.getProfile` endpoints — a mechanism
  entirely separate from backfill's `messages.list` paging.
- **Seeded `pollingHistoryId` the moment backfill completes** (inside
  `runBackfill`'s existing completion branch, via `getCurrentHistoryId()`)
  so ongoing polling picks up exactly where backfill leaves off, with no
  gap or overlap. *(Superseded by the final review — see below: seeding
  at completion left a real gap for mail arriving mid-backfill. Fixed to
  seed once, before the very first page is ever listed.)*
- `captureScheduler.ts` takes an injected `QueueSender` interface
  (mirroring the `GmailClient` injection pattern from Phase 2) so retry
  logic is unit-testable without a live Cloudflare Queue.
- Added `NOTIFICATION_EMAIL` to `config.ts` — the spec never specifies a
  real recipient address for a single-user app's own alerts.

**Work completed (all committed, 114/114 tests passing, clean build/lint):**
1. `notificationEngine.ts` — shared delivery layer over Resend's HTTP API.
2. `watchdog.ts` — 2-consecutive-missed-run detection; never alerts on a
   quiet day with zero new messages; names the specific failure reason
   (`auth_failure`, `rate_limit`, "job didn't run", etc.).
3. `listHistory`/`getCurrentHistoryId` (`gmailClient.ts`) +
   `runOngoingPoll` (`gmailAdapter.ts`) — reuses backfill's row-building,
   idempotency, batching, and dedup-check wiring.
4. `captureScheduler.ts` — chooses backfill-vs-ongoing-poll, retries a
   Gmail API failure via the Queue at 1/5/15 minutes (never an in-process
   sleep), hands off to the Watchdog after 3 attempts.
5. Wired real cron dispatch into `index.ts`'s `scheduled`/`queue`
   handlers (replacing the Phase 0-1 placeholder), plus the
   `CAPTURE_RETRY_QUEUE` binding in `wrangler.toml`.

**Notable fixes made along the way (not from an external review yet —
self-caught during implementation):**
- A test asserted the wrong Gmail REST path shape (`history/list` vs the
  real `/users/me/history`) — caught before accepting it as valid.
- `QueueSender.send`'s return type was narrowed to `Promise<void>`, which
  didn't match the real Cloudflare `Queue.send()`'s `Promise<QueueSendResponse>`
  — widened to `Promise<unknown>`.
- `index.ts`'s `scheduled` handler used the legacy `ScheduledEvent` type
  instead of the correct modern `ScheduledController`, and was missing
  its `ctx: ExecutionContext` parameter — only surfaced once a realistic
  3-argument test call was written against it. All three were real type
  errors caught by `tsc --noEmit`, not by `vitest` (which ran anyway) —
  a reminder that both must run as part of verification.
- Initial `index.test.ts` assertions only checked "doesn't throw," which
  the pre-existing no-op placeholder already passed trivially.
  Strengthened to assert actual dispatch effects (capture_runs updated
  via a real decrypted credential, `sendNotification` actually invoked,
  the budget/bill cron confirmed as a true no-op).

**Final review (fresh-context Agent, opus) — 6 Critical + 7 Important + 6 Minor findings, before this phase ever touched real Gmail/Cloudflare infrastructure:**

| # | Finding | Fix |
|---|---|---|
| C1 | `history.list` has no sender/subject filter — every mailbox-wide message (not just NayaPay mail) was fetched and stored, junking the review queue with unrelated email | Added `matchesNayaPayScope` (per-message skip, no row written) + a `labelId=INBOX` filter as a cheap first pass |
| C2 | `history.list` pagination was never followed — any gap over one page (`maxResults`) was silently skipped forever, with the watermark still advancing past it | Loop `nextPageToken` to exhaustion before resolving the new watermark |
| C3 | `pollingHistoryId` was seeded only at backfill *completion* — missed any mail arriving during a multi-hour/multi-run backfill | Seed once, before the very first page is ever listed; never re-seeded once set |
| C4 | Watchdog could never detect the cron itself going silent — a frozen `"success"` status from the last real run looked healthy forever | Escalate when `lastAttemptedRun` itself goes stale, gated on a connected `gmailCredentials` row |
| C5 | An error escaping `runBackfill`/`runOngoingPoll`'s own internal handling (e.g. `getCurrentHistoryId` failing mid-seed) was silently swallowed by `captureScheduler`'s bare `catch {}` — no retry, no Watchdog visibility | Record the failure wherever it can occur: scheduler's catch, `index.ts`'s client-building step, the queue handler |
| C6 | The stored Gmail access token was never refreshed — every poll past the first hour would 401 forever | New `services/gmailTokenRefresh.ts`, wired into `buildGmailClientFromStoredCredentials` with a 5-minute expiry skew |
| I1 | An expired history watermark (Gmail 404) had no recovery path | Reseed via `getCurrentHistoryId` on `history_expired`; the resulting gap is left to statement-import's existing dedup as the documented backstop (reduced scope vs. a full `messages.list`-based catchup) |
| I2 | A pre-existing row with `backfillCompletedAt` set but `pollingHistoryId` still null (e.g. production data predating this column) polls forever as a silent no-op | Self-heals by seeding it on first encounter |
| I3 | A per-message fetch failure during polling still advanced the watermark past it — unlike backfill, Gmail has no later page to recover it on | Watermark no longer advances past a run with any fetch failure |
| I6 | `MAX_ATTEMPTS` naming implied 3 total attempts; actually 3 retries + the original = 4. `auth_failure` was retried 3 times with no chance of success | Renamed to `MAX_RETRIES`; `auth_failure` skips the queue entirely, straight to the Watchdog |
| I7 | `queue()` had no per-message ack/retry — a thrown error left the whole batch to Cloudflare's own platform-level redelivery, stacking on top of the app's own retry chain | Every message acked itself (success or failure); `wrangler.toml`'s consumer sets `max_retries = 0` to match |
| M1 | Stale `wrangler.toml` comment (still described the Task-1 placeholder) | Fixed |
| M2 | `notificationEngine` required the *full* config (including Gmail secrets) just to send an alert — a broken Gmail secret could silence the Watchdog too | Narrowed to its own two secrets (`RESEND_API_KEY`, `NOTIFICATION_EMAIL`) |
| M4 | ~60 lines of fetch/parse/categorize/build-rows logic duplicated between `runBackfill`/`runOngoingPoll`, risking C1/I3's fixes landing in only one place | Extracted shared `fetchAndBuildRows` helper (kept the batch-insert/dedup step duplicated — it didn't need the fix and fighting Drizzle's batch typing for a shared wrapper wasn't worth it) |

**Deferred, with written rulings in the SDD ledger (`.superpowers/sdd/2026-11-03-ongoing-polling-reliability/progress.md`) — all noisy/cosmetic, none are data-loss:**
- **I4** — Watchdog re-sends its alert every hour while unhealthy (no debounce). Needs a new `lastNotifiedAt` column; revisit with Phase 7's notification preferences.
- **I5** — Watchdog's "2 consecutive failed runs" check can fire on a brand-new connection's very first failed attempt, before the retry chain even exhausts (~20 min). Needs a new "first-failed-at" column; cost of being wrong is one early email.
- **M3** — `GmailErrorType`'s `network_timeout` is declared but never actually produced (pre-existing from Phase 2, a fetch-level `TypeError` falls through to `unknown`). Cosmetic text accuracy only.
- **M5** — `scheduled()`'s own try/catch still shows cron invocations as "succeeded" on Cloudflare's dashboard even when the dispatched capture failed. Harmless now that C5 ensures `capture_runs` (what the Watchdog and any human actually check) gets the real status.
- **M6** — One redundant `captureRuns` read in `runOngoingPoll` (the scheduler already read the row). Trivial; kept for consistency with `runBackfill`'s identical existing pattern.

Fix commit: all 6 Critical + 5 Important + 2 Minor findings fixed in one TDD pass. **140/140 tests passing** (up from 114), clean `tsc --noEmit`. Merged to `master` (fast, clean `ort` merge; branch + worktree deleted after verifying the merged result's tests/build stayed green).

---

## Phase 6: Missed-transaction fallback — merged to master

**Plan:** `docs/superpowers/plans/2026-11-03-missed-transaction-fallback.md`
**Branch:** `worktree-missed-transactions` (merged, deleted)

Scope: the third, manual capture path (CUJ 3) for anything neither Gmail nor a bank statement ever sees, plus the app's first transaction-management API — list, get, correct a category, resolve a dedup candidate pair.

**Plan-level rulings:**
- Manual-missed category is always auto-assigned at logging time (via the existing `categorize()`), never user-supplied in that same request — correction happens afterward through the same `PATCH /transactions/:id/category` route every other source uses.
- The spec names `resolve-dedup`'s three resolution values (`kept`/`discarded`/`confirmed_distinct`) but doesn't spell out which value lands on which side of the pair. Resolved as: `kept` on the target writes `discarded`+soft-delete on its counterpart (and vice versa for `discarded`); `confirmed_distinct` writes the same value to both, deletes neither.
- `transactions.ts` and `missedTransactions.ts` are mounted into the real `app` — the first HTTP routes this project has ever actually exposed (`authGmail.ts` remains deliberately unmounted, a separate, earlier CSRF deferral).

**Work completed (4 tasks, all committed):**
1. `manualAdapter.ts` + `missedTransactions.ts` — validates input, auto-categorizes, writes a `committed` `manual_missed` row with `provenance: "{}"`, never dedup-checked.
2. `transactions.ts` — `GET /` (list, excludes soft-deleted, optional `?reviewStatus=` filter), `GET /:id`, `PATCH /:id/category`.
3. Same file — `POST /:id/resolve-dedup`.
4. Mounted both route files into `index.ts`'s real `app`.

**Final review (fresh-context Agent, opus) — 1 Critical + 5 Important + several Minor findings:**

| # | Finding | Fix |
|---|---|---|
| C1 | `resolve-dedup` had no state guard — resolving the same pair a *second* time (a changed mind, a double-click, or the frontend targeting the other side of an already-resolved pair) could soft-delete **both** halves of a real transaction, with a 200 response and no error | Added a `dedupResolution !== "pending"` guard returning 409 |
| I2 | The date regex accepted calendar-impossible values like `"2026-02-31"` — JS's `Date` normalizes these rather than throwing | Added a round-trip check through `Date` to catch what the regex alone can't |
| I3 | Malformed JSON on `PATCH /:id/category` and `POST /:id/resolve-dedup` threw uncaught → Hono's default 500, inconsistent with `missedTransactions.ts`'s own existing try/catch | Wrapped both in try/catch, returning 400 |
| I4 | `PATCH /:id/category` never validated `category` — a missing one threw a confusing 500 from Drizzle ("no values to set"); an empty string would have silently upserted a junk `category_rules` entry | Validates a non-empty trimmed string, 400 otherwise |
| I5 | `missedTransactions.ts` mapped *every* error to 400, including a genuine server fault (e.g. a D1 outage) — misreporting it as the caller's fault | Added a `ValidationError` class that only `manualAdapter`'s own input checks throw; the route maps only that to 400, rethrows everything else |

**Flagged, not fixed — a project-wide gap, not a Phase 6 regression:** the reviewer correctly pointed out that mounting these routes creates the app's *first-ever* reachable, **unauthenticated** HTTP surface — full read/write access to the transaction ledger (including bank-email excerpts in quarantined rows' `provenance`) with no auth layer in front of it. This has no spec requirement anywhere (the design doc never designs API auth) and the app isn't deployed anywhere yet (`wrangler.toml` still has a placeholder D1 `database_id`), so it wasn't treated as a Phase 6 merge-blocker — but it **must be resolved before any real deployment**. See "Open items flagged to the user" below; this needs a decision only you can make (Cloudflare Access in front of the Worker vs. a bearer-secret middleware vs. something else), not something to pick unilaterally.

**Deferred minors** (ledgered, not fixed): amount/vendor input coercion edge cases (`Number()`/`String()` accept more than they should), `:id` params not validated as positive integers, a missing dedup counterpart returning 400 instead of 409/500, the category-correction read-then-write not being atomic (low risk, single-user), no `ORDER BY` tiebreaker or pagination on the list endpoint.

**168/168 tests passing** (up from 161), clean `tsc --noEmit`. Merged to `master` (fast-forward; branch + worktree deleted after verifying the merged result's tests/build stayed green).

---

## Still ahead

- **Phase 7** (next step) — trends, budgets, bill reminders, remaining API
  routes (including mounting `authGmail.ts`, at which point I6(b)'s
  deferred CSRF `state` parameter must be addressed), and the deferred
  statement-import chunking/resumability design.
- **Phase 8** — frontend. Per explicit user instruction, use the
  Emil Kowalski / `emil-design-eng` and related animation/design skills
  (installed in `.claude/skills/` and `.agents/skills/`) when building it.

## Open items flagged to the user (not yet resolved)

- **API authentication — must resolve before any real deployment.**
  Phase 6 mounted this project's first-ever reachable HTTP routes
  (`/transactions`, `/missed-transactions`), and there is still no auth
  layer in front of them. As soon as this is deployed to a public
  `workers.dev` or custom domain, the full transaction ledger — amounts,
  vendors, and quarantined Gmail rows' raw subject/body excerpts — is
  readable and writable by anyone with the URL. The design doc never
  specifies an API-auth mechanism (single-user app, no spec gap I
  introduced), so this needs your decision: Cloudflare Access in front
  of the Worker (no code change) vs. a bearer-secret middleware on the
  Hono `app` (a few lines) vs. something else. More routes will mount in
  Phase 7, widening this same gap — worth deciding before Phase 7, not
  after.
- Spec correction needed: `string-similarity`/Jaro-Winkler reference
  (Phase 3) — the package is deprecated and implements a different
  algorithm than claimed.
- OAuth CSRF `state` parameter must be added before `authGmail.ts` is
  ever mounted/exposed publicly (Phase 7/8).
- Statement-import chunking/resumability for large files should be
  designed together with Phase 7's upload route, not bolted on after.
- Watchdog notification debounce (I4) and first-failure grace period
  (I5) — both need a new `capture_runs` column; natural to bundle with
  Phase 7's notification preferences work rather than a one-off migration.
- All of Phase 0-1's and Phase 2-3's deferred minors (see each section
  above) remain unaddressed — none are blocking, all are cheap to pick
  up when next touching their files.
