**Status: resolved** — 32 fixes applied (7 Blocker, 11 Major, 14 Nit), 0 declined, 0 contested/escalated. Note: Blocker 2 (bank statement profiles) remains partially open by nature — it's now an explicit Build Phases gate rather than an ambiguous "pending," but the actual bank list still requires the user's input before Phase 4 can start.

# Goldfish Annotated Review Report (Stage 9 — Implementation Readiness)

**Target:** `docs/designs/personal-spending-tracker.md` (lines 682-945, Detailed Implementation Plan)

## Prioritized Findings & AI Suggestions

### Blockers

1. **Email provider left "TBD" inside the plan itself** [`egm-implementation-readiness`] — ***PROPOSE FIX***: Name Resend as the provider in `config.ts` (item 3) and `notificationEngine.ts` (item 14), with a one-line sketch of its HTTP contract (POST to Resend's API, Bearer-token auth, JSON body with to/from/subject/html).
2. **Bank statement profile modules can't be scaffolded** [`egm-implementation-readiness`] — ***PROPOSE FIX (partial)***: This is genuinely gated on an Open Question I can't resolve myself (I don't know the user's actual banks). Fix: state explicitly in item 8 that profile modules are created one-per-bank only once the Open Question is resolved, and move this into the new Build Phases structure (below) as a named phase gate, rather than leaving it ambiguously "pending."
3. **Retry/backoff scheduling mechanism for Capture Scheduler is unspecified** [`egm-implementation-readiness`] — ***PROPOSE FIX***: Name the mechanism explicitly: Cloudflare Queues with delayed message delivery (`delaySeconds`) for each retry, not an in-process sleep — Workers have no built-in way to schedule a one-off callback minutes later otherwise.
4. **No file schedules budget/bill trigger evaluation** [`egm-implementation-readiness`] — ***PROPOSE FIX***: Add a second Cron Trigger (e.g. every 6 hours) in `wrangler.toml` (item 1) for budget/bill evaluation, wired in `index.ts` (item 26).
5. **Gmail backfill checkpoint (`pageToken`/`historyId`) has no schema storage** [`egm-codebase-details`] — ***PROPOSE FIX***: Add both fields to `capture_runs` in `schema.ts` (item 5).
6. **OAuth token storage has no defined table** [`egm-codebase-details`] — ***PROPOSE FIX***: Add a `gmail_credentials` table to `schema.ts` (item 5).
7. **Dedup resolution has no schema state or endpoint contract** [`egm-codebase-details` + `egm-implementation-readiness`, merged] — ***PROPOSE FIX***: Add a `dedup_resolution` enum column (`pending`/`kept`/`discarded`/`confirmed_distinct`) to `transactions` in `schema.ts`; state the resolve-endpoint contract in `routes/transactions.ts` (item 18).

### Majors

8. **Ambiguous dual-Cron dispatch (Capture Scheduler vs. Watchdog)** — ***PROPOSE FIX***: State the second cron schedule in `wrangler.toml` and describe `event.cron`-based dispatch in `index.ts`.
9. **`security.ts` crypto algorithm unspecified; flagged top risk but has no test file** — ***PROPOSE FIX***: Specify AES-256-GCM with a random 12-byte IV, key imported from a base64 Worker secret; add `security.test.ts`; include it in the Verification Plan's highest-risk-modules list.
10. **Fuzzy-matching library for `dedupEngine.ts` undeclared** — ***PROPOSE FIX***: Name Jaro-Winkler via a small npm package (e.g. `string-similarity`) and add it to `package.json`.
11. **No Phasing & Checkpoints structure for the 46-file list** — ***PROPOSE FIX***: Add a "### Build Phases" subsection with explicit ordering and a stable/testable state at each boundary (schema+migrations → D1 query spike → capture adapters → processing services → routes → frontend → infra), incorporating the bank-profile gate from Blocker 2.
12. **`watchdog.test.ts` covers logic that lives in `captureScheduler.ts`** — ***PROPOSE FIX***: Add `captureScheduler.test.ts` for retry/backoff coverage; narrow `watchdog.test.ts`'s description to the missed-run threshold only.
13. **Undeclared dependencies implied elsewhere** (`@cloudflare/vitest-pool-workers`, `eslint`, a CSV library, a frontend routing library) — ***PROPOSE FIX***: Add all four to the relevant `package.json` entries (items 2, 32); name `papaparse` for CSV and `react-router-dom` for routing.
14. **Chunked batch-processing cross-reference dangling for backfill parsing** — ***PROPOSE FIX***: Add chunking language to `gmailAdapter.ts` (item 7)'s Proposed Changes; correct the intro's "items 10, 12" cross-reference to "items 7, 12."
15. **Two incompatible Target Files description formats across the 46 entries** — ***PROPOSE FIX***: Add one explanatory sentence before the Target Files list stating the convention: core logic files (adapters, services, schema) get full Type/Scope + Proposed Changes detail; routes, tests, frontend, and infra files get a condensed one-liner since their purpose is evident from name and context.
16. **"The two capture adapters" when three exist** — ***PROPOSE FIX***: Reword to "the Gmail and statement adapters" in the Verification Plan.
17. **Terminology drift: "the narrow manual-entry form"** — ***PROPOSE FIX***: Reword item 38 to "the narrow missed-transaction logging form."
18. **Unverifiable superlative "the single biggest source of bespoke-code risk"** — ***PROPOSE FIX***: Soften to "a major source of bespoke-code risk."

### Nits

19. `billReminderTrigger.ts` lead time unspecified — ***PROPOSE FIX***: add placeholder default (3 days before due date).
20. `category` free-text with no FK not called out — ***PROPOSE FIX***: add one-line note.
21. No test files for notificationEngine/budgetAlertTrigger/billReminderTrigger/trendsService; statement test excludes PDF — ***PROPOSE FIX***: extend item 30's scope to include PDF/bank-profile cases; note the other four as consciously deprioritized given the project's test-coverage statement (dedup/watchdog/adapters prioritized).
22. `api/client.ts` RPC vs. hand-rolled unspecified — ***PROPOSE FIX***: specify Hono's `hc` RPC client.
23. No frontend types file for budgets/bills/capture_runs — ***PROPOSE FIX***: broaden item 34 to cover all entity types, not just transactions.
24. Inconsistent cross-reference style ("Target Files item 7" vs. "item 8") — ***PROPOSE FIX***: drop the "Target Files" prefix everywhere, use "item N" uniformly.
25. Ambiguous "bullet below" referenced twice — ***PROPOSE FIX***: label "first bullet below" / "second bullet below."
26. Missing relative pronoun "that" (line 689) — ***PROPOSE FIX***: trivial grammar fix.
27. Inconsistent bold-span length between two parallel bullets — ***PROPOSE FIX***: match bolding convention.
28. Redundant 3x restatement of Gmail-REST/PDF decisions — ***PROPOSE FIX***: fold into one statement (combined with fix for #25).
29. Inconsistent Type/Scope granularity for items 10-11 — ***PROPOSE FIX***: shorten labels, move detail to Proposed Changes.
30. Header promises "/Modify" never used — ***PROPOSE FIX***: drop "/Modify" from the section header.
31. Item 45's "or" bundling signals unresolved uncertainty — ***PROPOSE FIX***: commit to Cloudflare Pages dashboard project settings (not a `wrangler.toml`) as the mechanism.
32. Inconsistent subsection header style across 7 subsections — ***PROPOSE FIX***: normalize all to "em dash + descriptor" (fix "Frontend" and "Infra / project-level" headers).

## Summary

* Blockers: 7, all PROPOSE FIX (one partial — bank-profile scaffolding stays genuinely gated on an unresolved Open Question, now made an explicit phase gate instead of ambiguous)
* Major: 11, all PROPOSE FIX
* Nit: 14, all PROPOSE FIX (cheap, no DECLINEs this round — all have concrete, low-cost fixes)
* CONTEST: 0, ESCALATE: 0
