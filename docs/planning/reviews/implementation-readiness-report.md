# Goldfish Review Report

**Target:** `D:\projects\alfaaz\docs\designs\personal-spending-tracker.md` (`Lines 682-945`, "## Detailed Implementation Plan" to end of file)

**Stage:** 9 — Implementation Readiness Test (egm-review loop)

**Background (not review targets):** `D:\projects\alfaaz\concepts_brief.md` (brainstorm history), `D:\projects\alfaaz\design_draft.md` (superseded intermediate draft), lines 1-681 of the target document (Technical Plan / feature spec, read for consistency context only).

## Reviewer Status

| Reviewer | Standard Applied | Status |
| --- | --- | --- |
| `egm-implementation-readiness` | `implementation-readiness-standard.md` | completed |
| `egm-codebase-details` | `implementation-readiness-standard.md` | completed |
| `egm-style` | (built-in style criteria) | completed |

All three reviewers returned a single, complete pass each (no retries needed).

## Severity Breakdown

- Blockers: 6
- Major: 11
- Nit: 14

## Prioritized Findings (Blockers → Major → Nits)

### Email notification provider left as "TBD" inside the implementation plan itself - Severity: Blocker
* **Reviewer Lens:** `egm-implementation-readiness`
* **Affected Scope:** Lines 725 (`config.ts`, item 3), 819-826 (`notificationEngine.ts`, item 14)
* **Discrepancy Description**: `config.ts` reads "the email-provider API key (provider TBD...)" and `notificationEngine.ts` sends via "the chosen email provider (provider TBD...)." This is a concrete coding decision — which HTTP API, auth header, payload shape, env var name — left unresolved inside the Target Files list itself, not just the background Open Questions.
* **Rationale & Recommendation**: Name the provider (e.g. Resend or Postmark) and sketch its request/response contract before this section is actionable; an implementer cannot write either file as specified.

### Bank statement profile modules cannot be scaffolded - Severity: Blocker
* **Reviewer Lens:** `egm-implementation-readiness`
* **Affected Scope:** Lines 768-774 (`statementAdapter.ts`, item 8)
* **Discrepancy Description**: `backend/src/adapters/bankProfiles/`, "one per supported bank format — exact banks pending the Open Question above," means the implementer doesn't know how many profile modules to create or their column/layout mapping.
* **Rationale & Recommendation**: This is the single largest concrete blocker in the plan. Resolve the "exact bank statement formats in scope" Open Question (bank list + sample layouts) before this file and its submodules can be built at all.

### Retry/backoff scheduling mechanism for the Capture Scheduler is unspecified - Severity: Blocker
* **Reviewer Lens:** `egm-implementation-readiness`
* **Affected Scope:** Lines 784-793 (`captureScheduler.ts`, item 10)
* **Discrepancy Description**: "Exponential backoff (1/5/15 min)... implemented as re-invocation state rather than an in-process sleep" names no actual mechanism. Cloudflare Workers Cron Triggers fire on a fixed hourly schedule (per `wrangler.toml`, item 1); nothing in the plan provides a way to schedule a one-off callback minutes later from inside a bounded invocation (e.g. a Durable Object alarm, Cloudflare Queues delayed delivery, or a finer-grained cron plus a persisted "next retry due" timestamp).
* **Rationale & Recommendation**: Pick and state the retry-scheduling primitive explicitly; as written the implementer must invent the entire mechanism, which the Zero-Decision Rule prohibits.

### Nothing in the Target Files list schedules budget/bill trigger evaluation - Severity: Blocker
* **Reviewer Lens:** `egm-implementation-readiness`
* **Affected Scope:** Lines 713-717 (`wrangler.toml`, item 1), 819-837 (`notificationEngine.ts`, `budgetAlertTrigger.ts`, `billReminderTrigger.ts`, items 14-16), 862-867 (`index.ts`, item 26)
* **Discrepancy Description**: `wrangler.toml` only defines a Cron Trigger for the Capture Scheduler; `index.ts` only wires the `scheduled` handler for `captureScheduler`/`watchdog`. No file is responsible for periodically invoking `budgetAlertTrigger.evaluate()` or `billReminderTrigger.evaluate()`.
* **Rationale & Recommendation**: Add a scheduling entry (cron + handler wiring) for the budget/bill evaluation loop, or state explicitly where it is invoked from (e.g. on every transaction commit vs. its own cron).

### Gmail backfill checkpoint state (`pageToken`/`historyId`) has no defined storage location - Severity: Blocker
* **Reviewer Lens:** `egm-codebase-details`
* **Affected Scope:** Lines 731-744 (`schema.ts`, item 5) vs. 753-767 (`gmailAdapter.ts`, item 7), and CUJ 1 / Performance NFR (background)
* **Discrepancy Description**: `gmailAdapter.ts` must persist a resumable backfill `pageToken` and a separate ongoing `historyId` watermark (explicitly required by CUJ 1 and the Performance & Latency NFR), but item 5's "all D1 tables in one place" (transactions, `capture_runs`, `category_rules`, budgets, bills) contains no column for either value.
* **Rationale & Recommendation**: `schema.ts` is described as exhaustive yet omits state another Target File depends on. Add the checkpoint fields (e.g. to `capture_runs` or a new table) before implementation.

### OAuth token storage has no defined table - Severity: Blocker
* **Reviewer Lens:** `egm-codebase-details`
* **Affected Scope:** Lines 727-730 (`security.ts`, item 4), 855-856 (`authGmail.ts`, item 22) vs. 731-744 (`schema.ts`, item 5)
* **Discrepancy Description**: `security.ts` encrypts/decrypts the Gmail OAuth token "at rest in D1," and `authGmail.ts` owns connect/callback/reconnect — both imply a persisted token record — but `schema.ts`'s enumerated ("all D1 tables") list has no table for it.
* **Rationale & Recommendation**: Add an explicit token/credentials table (or column set) to `schema.ts`; without it the implementer must invent storage shape and keying on their own.

### Dedup resolution has no represented state or endpoint contract - Severity: Blocker
* **Reviewer Lens:** `egm-codebase-details` (schema angle) + `egm-implementation-readiness` (endpoint angle) — merged, same root cause
* **Affected Scope:** Background lines 362-366 (Technical Plan: unresolved `dedup_group_id` pairs excluded from aggregation) vs. 731-744 (`schema.ts`), 827-843 (`budgetAlertTrigger.ts`, `billReminderTrigger.ts`, `trendsService.ts`, items 15-17), 847-848 (`routes/transactions.ts`, item 18: "resolve dedup candidates")
* **Discrepancy Description**: The design requires distinguishing a "resolved" dedup pair from an "unresolved" one for aggregation purposes, but the schema's only relevant column is a nullable `dedup_group_id` with no resolution-status field. None of items 15-17's Proposed Changes mention the exclusion rule at all, and item 18 never states what a "resolve" action writes to the DB (approve-as-is / edit-then-commit / reject — per the undesigned Open Question on this topic).
* **Rationale & Recommendation**: Add a resolution-status column (e.g. `dedup_resolution`: `pending`/`kept`/`discarded`/`confirmed-distinct`) to the schema, reference it explicitly in items 15-17's exclusion logic, and define the `routes/transactions.ts` resolve-endpoint contract. As specified, this is unimplementable without inventing both the data model and the API semantics.

### Ambiguous Cron Trigger / scheduled-handler dispatch between Capture Scheduler and Watchdog - Severity: Major
* **Reviewer Lens:** `egm-implementation-readiness` + `egm-codebase-details` (both independently flagged)
* **Affected Scope:** Lines 713-717 (`wrangler.toml`, item 1), 794-800 (`watchdog.ts`, item 11), 862-867 (`index.ts`, item 26)
* **Discrepancy Description**: `wrangler.toml`'s Proposed Changes mention only one (hourly) Cron Trigger "for the Capture Scheduler handler." `watchdog.ts` says it's invoked by "its own Cron Trigger independent of `captureScheduler`," and `index.ts` references "wrangler.toml's Cron Triggers" (plural) for both. `wrangler.toml` never declares the second trigger, watchdog's run interval is never stated, and Cloudflare Workers expose a single `scheduled()` handler per Worker — the dispatch logic keyed on `event.cron` is never specified.
* **Rationale & Recommendation**: State the second cron schedule in item 1 and specify the `event.cron`-based dispatch in item 26.

### `security.ts` crypto implementation details unspecified, and it's the design's own highest-flagged risk yet has no test file - Severity: Major
* **Reviewer Lens:** `egm-implementation-readiness` (algorithm gap) + `egm-codebase-details` (risk/test inconsistency) — merged
* **Affected Scope:** Lines 727-730 (`security.ts`, item 4), 690-697 (intro, naming custom Web Crypto encryption as one of four biggest bespoke-risk instances), 933-936 (Verification Plan's "highest-risk modules" list — omits `security.ts`), 871-883 (test items 27-31 — no `security.test.ts`)
* **Discrepancy Description**: "Encrypt/decrypt helpers (Web Crypto API)" names the API family but not algorithm, mode, IV handling, or key format/length — a cryptographic decision the Zero-Decision Rule forbids leaving implicit. Compounding this, the intro calls `security.ts` one of the top four bespoke-risk files, yet the Verification Plan's own "highest-risk modules" sentence a few hundred lines later omits it, and no test file is listed for it anywhere in items 27-31.
* **Rationale & Recommendation**: Specify the algorithm (e.g. AES-256-GCM, random 12-byte IV, key import format from a base64 Worker secret) and add a `security.test.ts` to the test list; reconcile the two risk statements.

### Vendor fuzzy-matching algorithm/library for `dedupEngine.ts` is undeclared - Severity: Major
* **Reviewer Lens:** `egm-implementation-readiness`
* **Affected Scope:** Lines 801-812 (`dedupEngine.ts`, item 12), 718-721 (`package.json`, item 2)
* **Discrepancy Description**: "Vendor fuzzy-matching (exact thresholds pending the Open Question above)" names no algorithm (Levenshtein? Jaro-Winkler?) or npm package, and `package.json`'s dependency list has no string-similarity library.
* **Rationale & Recommendation**: Name the library/algorithm and add it to `package.json`; thresholds can remain an Open Question, but the mechanism itself should not be.

### No phasing or checkpoint structure for the 46-file Target Files list - Severity: Major
* **Reviewer Lens:** `egm-implementation-readiness` + `egm-codebase-details` (both independently flagged)
* **Affected Scope:** Lines 709-923 (entire Target Files list)
* **Discrepancy Description**: The applied standard requires partitioning work into incremental phases, each leaving the codebase stable/buildable/testable. The 46 entries are grouped only by architectural layer (data model, adapters, services, routes, tests, frontend, infra) with no stated build order, dependency sequencing, or checkpoint boundaries. The Risks & Mitigations section (background, line 640) mandates a "pre-build spike validating... query shapes against D1 before committing to the schema," but this spike is never represented as an actionable step/phase gate ahead of `schema.ts` (item 5) / the migration (item 6).
* **Rationale & Recommendation**: Add an explicit phase ordering (e.g. Phase 0: D1 spike → Phase 1: schema+migrations → Phase 2: adapters → ...) with a stated stable/testable state at each boundary.

### `watchdog.test.ts` is assigned coverage of logic that lives in `captureScheduler.ts`, and that logic has no test file of its own - Severity: Major
* **Reviewer Lens:** `egm-implementation-readiness` + `egm-codebase-details` (both independently flagged)
* **Affected Scope:** Lines 881-883 (`watchdog.test.ts`, item 31) vs. 784-793 (`captureScheduler.ts`, item 10), 794-800 (`watchdog.ts`, item 11)
* **Discrepancy Description**: `watchdog.test.ts` is described as covering "the retry/backoff sequence," but the retry/backoff logic (3 retries, 1/5/15-min exponential backoff on API-call failure) is `captureScheduler.ts`'s responsibility (item 10), not `watchdog.ts`'s (item 11, which only reads `capture_runs` state and escalates after 2 missed runs). No `captureScheduler.test.ts` exists anywhere in items 27-31.
* **Rationale & Recommendation**: Reassign the retry/backoff test coverage to a new `captureScheduler.test.ts`, or correct item 31's description if it was a labeling error.

### Dependencies implied by the Verification Plan / other sections are not declared in `package.json` - Severity: Major
* **Reviewer Lens:** `egm-codebase-details`
* **Affected Scope:** Lines 718-721 (`package.json`, item 2) vs. 928-932 (Verification Plan — `@cloudflare/vitest-pool-workers`, `eslint`), 768-774 (CSV parsing, item 8 — no CSV library named despite PDF getting one, `unpdf`), 887-888 / 910-911 (frontend `package.json` / `App.tsx` routing across 8 pages — no routing library, e.g. `react-router-dom`, named anywhere)
* **Discrepancy Description**: Three separate dependencies are implied but never declared: the vitest Workers pool and eslint (needed by the stated Verification Plan commands), a CSV-parsing library (the plan is careful to name a PDF library but silent on CSV, leaving "hand-rolled vs. library" as an undecided correctness-affecting choice for quoted/edge-case rows), and a frontend routing library for wiring 8 page components together.
* **Rationale & Recommendation**: Add all three to the respective `package.json` descriptions (items 2 and 32) and, for CSV, state library vs. hand-rolled explicitly.

### Chunked batch-processing cross-reference is dangling for the backfill-parsing half of the requirement - Severity: Major
* **Reviewer Lens:** `egm-codebase-details`
* **Affected Scope:** Lines 690-697 (intro, citing "items 10, 12" for chunked batch processing) vs. 784-793 (`captureScheduler.ts`, item 10) and 753-767 (`gmailAdapter.ts`, item 7)
* **Discrepancy Description**: Item 12 (`dedupEngine.ts`) does describe chunking explicitly. Item 10 (`captureScheduler.ts`)'s own Proposed Changes only describe retry/backoff, never chunked backfill-email parsing; item 7 (`gmailAdapter.ts`), which actually performs backfill parsing, also never mentions chunking.
* **Rationale & Recommendation**: Either add chunking language to item 7's Proposed Changes (the file that actually needs it) or correct the intro's cross-reference.

### Structural inconsistency across the 46 Target Files entries: two incompatible description formats - Severity: Major
* **Reviewer Lens:** `egm-style`
* **Affected Scope:** Lines 713-843 (items 1-17, detailed **Type/Scope** + **Proposed Changes** format) vs. 847-922 (items 18-25, 27-46, condensed single-line format); break occurs mid-subsection at item 26 (lines 862-867), which reverts to the detailed format inside the "API routes" subsection (header at line 845) alongside items 18-25's condensed form.
* **Discrepancy Description**: Roughly half the entries carry explicit Type/Scope metadata and half don't, with no stated rationale for the split, and the inconsistency appears inside a single subsection (not just between subsections), making it look accidental.
* **Rationale & Recommendation**: Normalize all 46 entries to one format (the detailed one is more implementation-ready) or explicitly state why routes/tests/frontend/infra get a lighter format.

### Unclear antecedent: "the two capture adapters" when three exist - Severity: Major
* **Reviewer Lens:** `egm-style`
* **Affected Scope:** Lines 933-936 (Verification Plan, Test Coverage Requirement)
* **Discrepancy Description**: The plan defines three capture adapters (`gmailAdapter.ts`, `statementAdapter.ts`, `manualAdapter.ts`, items 7-9), but says "the dedup engine, watchdog, and the two capture adapters are the highest-risk modules." Which two is inferable only by cross-referencing the test list (items 29-30 cover Gmail and statement; there is no `manualAdapter.test.ts`).
* **Rationale & Recommendation**: State explicitly "the Gmail and statement adapters" to avoid forcing the reader to reconstruct the count.

### Terminology drift reintroduces the rejected "manual-entry" concept name - Severity: Major
* **Reviewer Lens:** `egm-style`
* **Affected Scope:** Lines 900-901 (`LogMissedTransaction.tsx`, item 38)
* **Discrepancy Description**: Item 38 calls itself "the narrow manual-entry form," but the document elsewhere (Non-Goals, Alternative H, background) is deliberate about distinguishing the narrow "log a missed transaction" action from "manual entry" / "full manual entry as a standing capture channel," which was explicitly rejected.
* **Rationale & Recommendation**: Reword to "the narrow missed-transaction logging form" or similar, to avoid blurring a boundary the design otherwise keeps explicit.

### Unverifiable superlative claim about bespoke-code risk - Severity: Major
* **Reviewer Lens:** `egm-style`
* **Affected Scope:** Lines 687-688
* **Discrepancy Description**: "This choice is the single biggest source of bespoke-code risk in this design" is an absolute, unqualified ranking claim with no supporting measurement.
* **Rationale & Recommendation**: Soften to "a major source of bespoke-code risk" or quantify (e.g. number of library behaviors reimplemented by hand).

### `billReminderTrigger.ts` "upcoming" lead time is unspecified - Severity: Nit
* **Reviewer Lens:** `egm-implementation-readiness`
* **Affected Scope:** Lines 832-836 (item 16)
* **Discrepancy Description**: "Evaluates the manual bill registry for upcoming due dates" does not define the lead time counted as "upcoming" (e.g., 3 days before `next_due_date`).
* **Rationale & Recommendation**: State the lead-time window explicitly, even as a placeholder default.

### No note on `category` being free-text with no taxonomy/FK - Severity: Nit
* **Reviewer Lens:** `egm-implementation-readiness`
* **Affected Scope:** Lines 731-744 (`schema.ts`, item 5)
* **Discrepancy Description**: `category` has no enum/lookup table, consistent with the undefined taxonomy Open Question, but this isn't called out, so the implementer may wonder if an FK was intended.
* **Rationale & Recommendation**: Add a one-line note: "free-text for now, no FK, until taxonomy is finalized."

### Several services have no assigned test file; statement adapter test scope excludes PDF/bank-profile parsing - Severity: Nit
* **Reviewer Lens:** `egm-implementation-readiness`
* **Affected Scope:** Lines 871-883 (test items 27-31) vs. 813-843 (`notificationEngine.ts`, `budgetAlertTrigger.ts`, `billReminderTrigger.ts`, `trendsService.ts`, items 14-17), 879-880 (`statementAdapter.test.ts`, item 30)
* **Discrepancy Description**: No test file is listed for notificationEngine, budgetAlertTrigger, billReminderTrigger, or trendsService. `statementAdapter.test.ts` is scoped only to "CSV parsing against sample files," with no mention of PDF/bank-profile parsing despite that being one of the plan's four named bespoke-risk areas.
* **Rationale & Recommendation**: Add test coverage (or explicitly deprioritize, with reasoning) for these modules; extend item 30's scope to include PDF/bank-profile cases.

### `api/client.ts` doesn't state Hono RPC client vs. hand-rolled fetch wrapper - Severity: Nit
* **Reviewer Lens:** `egm-codebase-details`
* **Affected Scope:** Lines 889-890 (item 33)
* **Discrepancy Description**: Described only as "a typed wrapper around the Hono JSON endpoints" — doesn't say whether it uses Hono's built-in RPC client (`hc`) or a hand-rolled fetch wrapper.
* **Rationale & Recommendation**: Name the approach explicitly; low impact but still an undecided detail.

### No frontend types file planned for budgets/bills/capture_runs - Severity: Nit
* **Reviewer Lens:** `egm-codebase-details`
* **Affected Scope:** Lines 891-892 (`types/transaction.ts`, item 34) vs. 904-909 (`Budgets.tsx`, `Bills.tsx`, `CaptureHealth.tsx`, items 40-42)
* **Discrepancy Description**: Only one frontend types file is planned (mirroring `transactions`); no types file or inline-typing instruction is specified for the schemas items 40-42 need to render.
* **Rationale & Recommendation**: Either broaden item 34's scope or add sibling type files/instructions for budgets, bills, and capture_runs.

### Inconsistent cross-reference style within one sentence group - Severity: Nit
* **Reviewer Lens:** `egm-style`
* **Affected Scope:** Lines 690-697
* **Discrepancy Description**: "Target Files item 7" is followed by "item 8," "items 10, 12," and "item 4" — the first reference spells out "Target Files item," the rest drop the prefix.
* **Rationale & Recommendation**: Pick one form consistently (just "item N" reads cleanest).

### Ambiguous "bullet below" referenced twice with no distinguishing label - Severity: Nit
* **Reviewer Lens:** `egm-style`
* **Affected Scope:** Lines 690-708
* **Discrepancy Description**: Both the Gmail-REST and PDF-library decisions are forward-referenced as "(bullet below...)" with nothing distinguishing "first" from "second"; the reader must match by content alone.
* **Rationale & Recommendation**: Use "first bullet below" / "second bullet below," or fold the bullets into the intro (see redundancy finding below).

### Grammar: missing relative pronoun - Severity: Nit
* **Reviewer Lens:** `egm-style`
* **Affected Scope:** Line 689
* **Discrepancy Description**: "...is what forces reinventing functionality mature libraries already provide" should read "...functionality that mature libraries already provide."
* **Rationale & Recommendation**: Insert "that."

### Inconsistent bold-span length between two parallel bullets - Severity: Nit
* **Reviewer Lens:** `egm-style`
* **Affected Scope:** Lines 699-708
* **Discrepancy Description**: Bullet 1 bolds its entire first sentence; bullet 2 bolds only a fragment, leaving the trailing clause and parenthetical unbolded.
* **Rationale & Recommendation**: Apply the same bolding convention to both.

### Redundant restatement of the Gmail-REST / PDF-library decisions three times - Severity: Nit
* **Reviewer Lens:** `egm-style`
* **Affected Scope:** Lines 690-708 (intro + bullets) vs. 753-774 (items 7-8)
* **Discrepancy Description**: Both facts are stated once in the intro paragraph, once in the two standalone bullets, and again in items 7 and 8's Proposed Changes.
* **Rationale & Recommendation**: Fold the standalone bullets into the intro or into items 7/8 directly rather than restating three times.

### Inconsistent granularity in the Type/Scope field for items 10-11 - Severity: Nit
* **Reviewer Lens:** `egm-style`
* **Affected Scope:** Lines 785 (item 10), 795-796 (item 11)
* **Discrepancy Description**: Most Type/Scope values are short category labels (2-4 words); items 10 and 11 instead pack implementation detail into this field that belongs in Proposed Changes.
* **Rationale & Recommendation**: Shorten the Type/Scope labels and move the detail into Proposed Changes for consistency.

### Section header promises a "/Modify" category never used - Severity: Nit
* **Reviewer Lens:** `egm-style`
* **Affected Scope:** Line 709
* **Discrepancy Description**: "Target Files to Create/Modify" — all 46 entries are tagged "(Create)"; "(Modify)" never appears (expected for a greenfield project, but still dead weight in the header).
* **Rationale & Recommendation**: Drop "/Modify" from the header or confirm no existing files are touched.

### Item 45's "or" bundling signals unresolved uncertainty, unlike other bundled entries - Severity: Nit
* **Reviewer Lens:** `egm-style`
* **Affected Scope:** Lines 918-919 (item 45)
* **Discrepancy Description**: Other multi-file entries (items 6, 32, 43) list a definite pair joined by a comma; item 45 instead offers two alternatives joined by "or," reading as an open decision smuggled into a "Create" entry.
* **Rationale & Recommendation**: Either decide which file this is and bundle it the same way as other entries, or explicitly flag it as an open decision.

### Inconsistent subsection header style across the seven subsections - Severity: Nit
* **Reviewer Lens:** `egm-style`
* **Affected Scope:** Lines 711, 751, 782, 845, 869, 885, 913
* **Discrepancy Description**: Most subsection headers use an em dash before a descriptor ("Backend — core & data model," etc.); "#### Frontend" has no descriptor, and "#### Infra / project-level" uses a slash instead of an em dash.
* **Rationale & Recommendation**: Apply one heading pattern uniformly across all seven subsections.

## Summary

The Detailed Implementation Plan (lines 682-945) is well-organized for the capture/adapter files but fails the applied standard's Zero-Decision Rule in several concrete, implementer-blocking places: an undetermined email provider, an unspecified bank-profile list, an unspecified retry-scheduling mechanism, no scheduler for budget/bill triggers, and three missing pieces of schema state (Gmail backfill checkpoint, OAuth token storage, dedup-resolution status) that other Target Files silently depend on. It also lacks the standard's required Phasing & Checkpoints structure entirely. Beyond readiness, the style lens found a real structural inconsistency across the 46-entry Target Files list (two incompatible description formats, inconsistent subsection headers, and several clarity/grammar nits), plus one notable terminology drift that risks blurring a boundary the rest of the document is careful to keep explicit.
