# Personal Spending Tracker (Web App)

*   **Author:** mh.hassaan03@gmail.com
*   **Status:** Draft
*   **Date:** 2026-11-02

--------------------------------------------------------------------------------

## Overview

A web app for tracking personal spending, built for one primary user handling
roughly 100 transactions a month. Spending data comes in through two automated
channels — NayaPay transaction emails (read directly from Gmail) and bank/card
statement files (PDF or CSV) — plus a narrow manual option for anything those
two miss. Every transaction gets a category assigned automatically, which the
user can correct. On top of that, the app shows spending trends, warns the
user when a budget is close to being exceeded, and reminds them about
recurring bills and subscriptions.

## The Problem

The user tried tracking spending manually before and stopped, for two
reasons: they kept forgetting to log transactions, and categorizing every
line by hand was tedious. There is no bank-sync API available for the user's
banks that would let the app pull transactions automatically — except for
NayaPay, which emails a notification for every transaction. That makes Gmail
itself a usable data source for that one account.

The proposed solution removes the two specific frictions that killed the
earlier attempt: transactions from NayaPay arrive automatically via email, so
there is nothing to remember for that account, and categorization is
automatic with a quick correction instead of a manual pick every time. For
everything outside NayaPay's automatic coverage (other accounts, statement
imports, anything either channel misses), the user still has to act — that
tradeoff is recorded explicitly in Non-Goals below, not left implicit.

## Goals

*   Automatically capture every NayaPay transaction by reading Gmail directly
    (sender/subject-based query, no label or Gmail Filter setup required),
    covering both a one-time import of past emails and ongoing capture of new
    ones.
*   Import bank/card statements from PDF and CSV files for the user's other
    account(s).
*   Provide a narrow "log a transaction we missed" action for anything outside
    NayaPay-email or statement coverage (e.g. cash spending) — separate from,
    and much lighter-weight than, a full manual-entry system.
*   Automatically assign a spending category to every transaction, with a
    fast way for the user to correct it; corrections should improve future
    categorization for that vendor.
*   Detect when the same transaction has been captured by more than one
    channel (e.g. a NayaPay email and a statement row) and let the user
    decide which copy to keep.
*   Show spending trends and breakdowns — where money went most, where it
    went least, and how spending changes over time.
*   Alert the user when spending is approaching or has crossed a budget
    limit.
*   Remind the user about upcoming recurring bills and subscriptions.
*   Detect and alert the user if the NayaPay email-capture mechanism itself
    stops working (e.g. the background job fails to run, or Gmail rejects
    its requests), so a silent failure doesn't quietly turn into untracked
    spending.

## Non-Goals

*   **Multi-user / family support.** The app is single-user for v1; adding
    other people to see or log spending is explicitly deferred.
*   **Bank-sync API integration for any bank other than NayaPay's email
    path.** No other bank offers a usable sync API for this user; v1 does not
    attempt to build or integrate one.
*   **OCR / receipt photo scanning.** Dropped from scope entirely during
    brainstorming — not deferred, not planned for a later version of this
    design.
*   **Full manual entry as a standing capture channel.** The "log a missed
    transaction" action (see Goals) is intentionally narrow and is not a
    general-purpose way to enter any transaction by hand; it exists only to
    patch gaps the two automated channels leave.
*   **A trained ML categorization model.** At ~100 transactions/month there
    isn't enough data to train one usefully; categorization is rule/keyword
    based with per-vendor correction instead.
*   **Generic, bank-agnostic statement parsing.** Statement import is scoped
    to the specific 1–3 bank formats the user actually has, not a parser
    meant to handle arbitrary banks.
*   **Real-time, push-based Gmail capture (webhooks).** V1 uses scheduled
    polling; push-based capture is a possible future improvement, not part of
    this design.
*   **A health-check equivalent for statement import.** Statement import is
    user-initiated (the user uploads a file when they have one) — there is no
    background job on that channel for a health check to monitor. This is a
    deliberate scoping choice, not an oversight.
*   **Accepted gap:** any transaction that is neither a NayaPay email, a row
    in an imported statement, nor manually logged through the narrow "missed
    transaction" action simply isn't recorded in v1. This is a known,
    accepted limitation, not something this design attempts to close
    completely.

## Open Questions

*   **Category taxonomy**: the actual list of categories/subcategories the
    app will use has not been defined yet.
*   **Exact bank statement formats in scope**: which 1–3 banks, their CSV
    column layouts, and whether any statements are scanned (image-based) PDFs
    rather than text-based ones.
*   **Budget period definition**: calendar month vs. a rolling window, and
    the exact alert-threshold model (e.g. alert at 80%/100% of budget, or a
    different scheme).
*   **Notification delivery channel**: which email-sending service/provider
    to use for alerts and reminders.
*   **NayaPay email parsing approach**: how the email body will be parsed
    into amount/vendor/date, how to handle NayaPay changing their email
    template later, and the exact behavior when a parse fails (quarantine for
    review, per Goals above, but the detection logic itself is undefined).
*   **OAuth token storage and lifecycle**: how the Gmail OAuth token is
    stored securely, what happens when it expires, and how the user
    reconnects.
*   **De-duplication matching rule specifics**: exact date tolerance, amount
    matching, and vendor-name fuzzy-matching thresholds used to detect a
    transaction captured by both channels; whether NayaPay's email body
    contains a transaction reference usable as a stronger match key.
*   **Data retention policy**: how long raw email content and OAuth tokens
    are kept.
*   **Rationale for NayaPay-only scoping**: not yet written down anywhere
    user-facing — worth stating explicitly once other accounts are
    considered later.
*   **UX for the "log a missed transaction" action**: where it lives in the
    app and what it looks like has not been designed yet, only that it must
    exist and must not participate in the cross-channel de-duplication logic.

--------------------------------------------------------------------------------

## Technical Plan (Architecture)

The system is built around one idea: every transaction, regardless of where
it came from, lands in a single canonical store, and everything downstream
(categorization, trends, alerts) reads from that one store instead of
knowing anything about Gmail, statement files, or the manual-entry action.

### Canonical Transaction model

One schema, shared by all three capture paths:

*   `id` — internal identifier.
*   `amount` — integer, minor units (e.g. cents) to avoid floating-point
    rounding issues.
*   `date` — transaction date.
*   `vendor_raw` / `vendor_normalized` — as parsed, and a cleaned-up version
    used for categorization and vendor matching.
*   `category` — assigned by the categorization engine; user-correctable.
*   `source` — one of `gmail_email`, `statement_import`, `manual_missed`.
*   `provenance` — source-specific metadata (see below); used for
    idempotency and de-duplication.
*   `review_status` — `pending_review` (quarantined, needs confirmation
    before it's trusted) or `committed`.
*   `dedup_group_id` — set when this record has been matched against another
    as a likely duplicate; null otherwise.
*   `deleted_at` — soft-delete marker (nothing is hard-deleted).

Provenance by source:

*   `gmail_email`: Gmail message ID, thread ID, raw email body, the parser
    version used, and the sync watermark (so re-polling doesn't reprocess
    the same message).
*   `statement_import`: a reference to the uploaded file plus the row index
    within it.
*   `manual_missed`: none beyond the user-entered fields — this source has
    no idempotency key, by design, since it is not expected to collide with
    anything (see De-duplication below).

### Capture paths

**1. NayaPay Gmail import.** A scheduled job (the "Capture Scheduler") polls
Gmail roughly every hour, querying by NayaPay's sender address and/or a
subject-line pattern — not a label, not a Gmail Filter. The same query
mechanism is used both for the one-time historical backfill and for every
ongoing poll afterward. Each matching email is parsed into a draft
transaction; low-confidence parses go to `pending_review` instead of being
committed outright.

Important limitation to carry forward into implementation: the Gmail OAuth
scope (`gmail.readonly`) grants the app read access to the whole mailbox —
Gmail has no scope that can be restricted to one label or sender ahead of
time. The sender/subject restriction is enforced by the app's own query
logic, not by Google. This should be stated plainly wherever the app
describes what it accesses (e.g. a privacy/permissions screen), not left
implicit.

**2. Statement import.** The user uploads a PDF or CSV file. CSV is parsed
directly into transactions, one row at a time. PDF parsing is scoped only to
the specific bank formats the user actually has — not a generic parser.
Low-confidence rows (e.g. an unexpected layout) go to `pending_review`.

**3. Log a missed transaction.** A narrow, lightweight form for anything
neither automated channel catches — cash spending, a bank with no statement
or email path, or a gap in coverage. It writes directly into the canonical
store as `source: manual_missed`, `review_status: committed` (nothing to
quarantine, since there's no parse confidence involved), and is explicitly
excluded from the de-duplication logic below.

### De-duplication

Because there are only two automated channels, there is exactly one
cross-channel relationship to check: `gmail_email` against
`statement_import`. When a new transaction is committed, the de-duplication
engine compares it against existing transactions using date proximity,
amount match, and vendor fuzzy-matching. A match produces a candidate pair
with a shared `dedup_group_id` and is surfaced to the user to pick which one
to keep (or keep both, if they decide they aren't actually duplicates).
Candidate matches from a large backfill import are queued for batch review
rather than interrupting the user one at a time.

`manual_missed` records are never compared against anything — they're
assumed not to overlap with the automated channels, since the whole point of
that action is to log something those channels didn't see.

### Categorization

A rule/keyword table maps normalized vendor names to categories. When the
app's guess is wrong, the user corrects it, and that correction updates the
rule for that vendor going forward — the next transaction from the same
vendor uses the corrected category automatically. No machine-learning model
is used; at ~100 transactions/month there isn't enough data to train one
usefully.

### Reliability: Gmail capture health alert

A single email-absence check doesn't work (plenty of real days have no
NayaPay spending at all), so the alert instead watches the *mechanism*, not
the data:

*   The Capture Scheduler records `last_attempted_run`, `last_successful_run`,
    a `run_status` (`success | job_did_not_run | api_call_failed`), and an
    `error_type` (`auth_failure | rate_limit | network_timeout | unknown`)
    on every scheduled run.
*   A separate watchdog component (external to the polling job itself, since
    a job that doesn't run can't report its own absence) checks this state.
    If 2 consecutive scheduled hourly runs are missing a successful
    completion, it escalates.
*   On an API-call failure, the job retries up to 3 times with exponential
    backoff (1 min, 5 min, 15 min) before the failure is escalated to the
    user. A single transient failure is logged internally only.
*   Every user-facing alert names the specific failure reason (e.g. "Gmail
    access expired — reconnect your account" vs. "Gmail is rate-limiting
    requests" vs. "the sync job didn't run") rather than one generic message.
*   Statement import has no equivalent check — it's a user-initiated upload,
    not a scheduled job, so there's nothing for a health check to monitor.

### Trends, budget alerts, and bill reminders

These three all read from the same committed-transaction store:

*   **Trends/breakdowns** aggregate committed transactions by category and
    time period, labeling sparse or missing coverage explicitly (e.g. "no
    statement imported for this account yet") rather than showing a
    misleadingly empty chart.
*   **Budget alerts** and **bill/subscription reminders** are both, at their
    core, the same shape: a rule, a trigger condition, and a notification.
    They share one Notification Engine for delivery (email as the primary
    channel, since this is a web app and browser push isn't reliable across
    browsers/tabs). The Gmail capture health alert also delivers through
    this same layer, but its trigger/evaluation logic lives next to the
    Capture Scheduler, not inside the Notification Engine's own rule loop —
    it needs to keep working even when the data pipeline it's watching is
    unhealthy.
*   Bill/subscription detection starts as a manual registry (the user tells
    the app what recurs); automatic detection from recurring vendor+amount+
    interval patterns is layered in later, once enough transaction history
    exists to make that reliable.

### Data flow

```text
                    ┌─────────────────────┐
                    │   Gmail (NayaPay)    │
                    └──────────┬───────────┘
                               │ sender/subject query (poll, hourly)
                               ▼
                    ┌─────────────────────┐        ┌──────────────────┐
                    │  Capture Scheduler   │──────▶│  Watchdog /       │
                    │  + Email Adapter      │ state  │  Health Alert     │
                    └──────────┬───────────┘        └─────────┬────────┘
                               │                                │
     ┌─────────────────────┐  │                                │
     │  Statement upload    │  │                                │
     │  (PDF/CSV)            │  │                                │
     └──────────┬───────────┘  │                                │
                │ parse         │                                │
                ▼                ▼                                │
         ┌─────────────────────────────┐                          │
         │   Canonical Transaction      │                          │
         │   Store (pending_review /    │                          │
         │   committed)                 │                          │
         └───────────┬─────────────────┘                          │
                     │  ▲                                         │
   ┌──────────────┐  │  │ quarantine review / correction          │
   │ "Log missed  │──┘  │                                         │
   │ transaction" │     │                                         │
   └──────────────┘     │                                         │
                     ┌───┴────────────┐                           │
                     │ De-dup engine   │                           │
                     │ (email↔statement)│                          │
                     └───┬─────────────┘                           │
                         │                                         │
            ┌────────────┼──────────────┐                          │
            ▼            ▼              ▼                          │
     ┌────────────┐┌────────────┐┌──────────────┐                 │
     │ Trends /    ││ Budget      ││ Bill/sub      │                 │
     │ Breakdowns  ││ Alerts      ││ Reminders     │                 │
     └────────────┘└──────┬──────┘└──────┬────────┘                 │
                          │               │                          │
                          └──────┬────────┘                          │
                                 ▼                                   │
                        ┌─────────────────┐                         │
                        │ Notification     │◀────────────────────────┘
                        │ Engine (email)    │
                        └─────────────────┘
```

--------------------------------------------------------------------------------

## Alternatives Considered

### Alternative A: ML or LLM-based categorization instead of rules

*   **Pros**: Could generalize to vendors never seen before without a rule
    being written for them first.
*   **Cons**: A trained classifier needs far more transaction history than
    ~100/month produces to be reliably accurate. An LLM call per transaction
    adds cost and latency for no clear benefit at this volume, and is harder
    to debug when it gets something wrong.
*   **Reason for Rejection**: Rule/keyword matching with per-vendor
    correction is transparent, immediately debuggable, and improves with
    every correction the user makes — which a black-box model doesn't offer
    at this scale. An LLM call remains a reasonable fallback only for vendors
    that match no existing rule.

### Alternative B: Generic, bank-agnostic statement parser

*   **Pros**: Would, in theory, work for any bank the user adds later
    without custom work.
*   **Cons**: Bank statement layouts vary enough that a genuinely generic
    parser is a much bigger undertaking than parsing the 1–3 formats this
    user actually has.
*   **Reason for Rejection**: Not worth building for a single user's fixed,
    small set of sources. Statement import is scoped to the specific banks
    in use.

### Alternative C: Two separate systems for budget alerts and bill reminders

*   **Pros**: Simpler to reason about in isolation, since each would only
    need to handle its own case.
*   **Cons**: Both features are fundamentally the same shape — a rule, a
    trigger condition, a notification — so building them separately means
    duplicating delivery, preference, and de-duplication logic for no real
    benefit.
*   **Reason for Rejection**: One shared Notification Engine with pluggable
    trigger types avoids that duplication.

### Alternative D: Browser push or SMS as the primary notification channel

*   **Pros**: Push notifications can feel more immediate than email; SMS
    doesn't depend on the user having the app's tab open.
*   **Cons**: This is a web app, not a native app — browser push support is
    inconsistent across browsers and requires the tab/site to be granted
    permission and often kept active. SMS requires a paid third-party
    provider and phone number collection for no clear benefit over email at
    this scale.
*   **Reason for Rejection**: Email works regardless of whether a browser
    tab is open and needs no extra permission grant, making it the reliable
    default; in-app notification is a reasonable secondary channel, and
    push remains a possible future addition, not a v1 requirement.

### Alternative E: OCR receipt scanning

*   **Pros**: Would let the user capture cash purchases or receipts from
    accounts with no email/statement path, by photographing a receipt.
*   **Cons**: Adds a vendor dependency (an OCR/receipt-parsing API),
    receipt-photo storage and retention policy questions, and its own schema
    variant and de-duplication surface — all for a capability that doesn't
    address the two capture channels that matter most (NayaPay email,
    statements).
*   **Reason for Rejection**: Dropped from scope entirely during
    brainstorming. It was never the main driver of the project's core
    problem (forgetting to log, tedious categorization), and removing it
    simplifies the schema and de-duplication logic without losing a channel
    that would have mattered most.

### Alternative F: Push-based (webhook) Gmail capture instead of polling

*   **Pros**: New emails would be picked up immediately instead of waiting
    for the next scheduled poll.
*   **Cons**: Requires setting up a public webhook endpoint and Google
    Pub/Sub integration — meaningfully more infrastructure than a scheduled
    job.
*   **Reason for Rejection**: At ~100 transactions/month, the latency
    difference between "immediate" and "within the hour" is irrelevant to
    the user, and scheduled polling reuses the same scheduler infrastructure
    the Notification Engine already needs. Push-based capture is a possible
    future improvement, not a v1 requirement.

### Alternative G: Gmail label + user-created Filter for scoping capture

*   **Pros**: A label gives a persistent, inspectable artifact — the user
    can see directly in Gmail which emails the app considers "in scope."
*   **Cons**: Requires the user to create a Gmail Filter rule themselves for
    new emails to be auto-labeled going forward, and separately bulk-label
    years of historical emails for backfill to work — two manual setup steps
    with no enforcement if either is skipped or mis-configured.
*   **Reason for Rejection**: Querying Gmail directly by NayaPay's sender
    address and/or subject pattern does the same job without any setup step
    from the user, and uses one mechanism for both backfill and ongoing
    capture instead of two. Both approaches are equally unable to make
    Google itself enforce the restriction — the app's own query logic is
    the real boundary either way, and that limitation is stated directly in
    the Technical Plan rather than hidden behind the label's appearance of
    being a hard restriction.

### Alternative H: Keep manual entry as a full, standing capture channel

*   **Pros**: Gives the user a way to record absolutely any transaction,
    with no gap in coverage.
*   **Cons**: A freeform manual-entry channel has no natural way to detect
    if the user accidentally enters a transaction twice, and routinely
    overlaps with NayaPay's email capture for the same account — every
    manually-entered NayaPay transaction is a potential duplicate against an
    email that may arrive before or after it, on an ongoing basis, not just
    once during a backfill.
*   **Reason for Rejection**: Removing manual entry as a full channel
    eliminates that ongoing collision problem. The resulting coverage gap
    (nothing catches cash spending or an uncovered bank) is addressed
    instead by a narrow, dedup-exempt "log a missed transaction" action,
    which has no idempotency burden because it isn't expected to overlap
    with anything the automated channels already capture.

### Alternative I: Raw "no NayaPay email in 24 hours" as the reliability alert

*   **Pros**: Simple to state and simple to implement — just check whether
    any matching email arrived in the last day.
*   **Cons**: At ~100 transactions/month, plenty of ordinary days have zero
    NayaPay spending. An alert based on raw email absence would fire
    constantly on completely normal inactivity, training the user to ignore
    it — the opposite of what a reliability alert is for. It also conflates
    three different root causes (the job didn't run, the job ran but Gmail
    rejected the request, or there's genuinely nothing to report) into one
    undifferentiated signal.
*   **Reason for Rejection**: Watching the capture mechanism's own health
    (did the scheduled job run, did its Gmail API call succeed) instead of
    the data it's trying to find avoids false-positives on ordinary no-spend
    days, and lets the alert name the actual, specific problem when
    something does go wrong.

--------------------------------------------------------------------------------

## Non-Functional Requirements

*   **Security & Privacy**: The Gmail OAuth token must be encrypted at rest
    (see `backend/src/security.ts` below) and the app must only ever issue
    sender/subject-scoped Gmail queries in code, never an inbox-wide read,
    even though the underlying grant permits it. Statement files may
    contain full account numbers; they should not be rendered back to the
    frontend unmasked unless the user is actively viewing that specific
    upload.
*   **Performance & Latency**: Irrelevant at ~100 transactions/month for
    steady-state operation. The one real performance concern is the Gmail
    historical backfill, which may need to page through years of email —
    the backfill adapter must support resuming from a checkpoint rather than
    re-scanning from scratch if interrupted.
*   **Rollout & Rollback**: Since NayaPay email becomes the primary capture
    source for that account, the first production backfill + first week of
    polling should run with the Gmail capture health alert active from day
    one, so a broken parser or a missed poll is caught immediately rather
    than discovered weeks later as "my NayaPay spending looks wrong."

--------------------------------------------------------------------------------

## Detailed Implementation Plan

Stack: **TypeScript on Cloudflare Workers (Hono) + Cloudflare D1, React
(Vite) frontend on Cloudflare Pages**, per the owner's architecture
decisions above. This replaces this draft's earlier Python/FastAPI/Postgres
plan entirely — not a partial swap. Two consequences of the Workers runtime
worth stating plainly rather than discovering during implementation:

*   **Gmail access uses direct REST calls (`fetch`) against the Gmail API,
    not the `googleapis` Node SDK.** That SDK depends on Node APIs
    (`fs`, persistent sockets) that Workers' `nodejs_compat` layer does not
    fully cover; hand-rolled `fetch` calls against Gmail's documented REST
    endpoints avoid that risk entirely.
*   **PDF parsing needs a Workers-compatible library** (e.g. `unpdf`, which
    is built for serverless/edge runtimes) rather than a library that
    expects filesystem access. CSV parsing has no such constraint.

### Target Files to Create/Modify

#### Backend — core & data model

1.  `backend/wrangler.toml` (Create)
    *   **Type/Scope**: Cloudflare Workers project configuration.
    *   **Proposed Changes**: Declares the Worker, binds the D1 database,
        and defines the Cron Trigger schedule (hourly) for the Capture
        Scheduler handler.
2.  `backend/package.json` (Create)
    *   **Type/Scope**: Node/TypeScript project manifest.
    *   **Proposed Changes**: Declares dependencies: `hono`, `drizzle-orm`,
        `drizzle-kit`, `unpdf`, `vitest`, Cloudflare Workers types.
3.  `backend/src/config.ts` (Create)
    *   **Type/Scope**: Settings module.
    *   **Proposed Changes**: Reads Worker secrets/bindings — Gmail OAuth
        client ID/secret, email-provider API key (provider TBD, see Open
        Questions), the token-encryption key.
4.  `backend/src/security.ts` (Create)
    *   **Type/Scope**: Security helper module.
    *   **Proposed Changes**: Encrypt/decrypt helpers (Web Crypto API) for
        the Gmail OAuth token at rest in D1.
5.  `backend/src/db/schema.ts` (Create)
    *   **Type/Scope**: Drizzle ORM schema definitions.
    *   **Proposed Changes**: Defines all D1 tables in one place — the
        canonical `transactions` table (`id`, `amount` integer minor units,
        `date`, `vendor_raw`, `vendor_normalized`, `category`, `source`
        [`gmail_email`/`statement_import`/`manual_missed`], `provenance`
        [JSON-as-text column, shape varies by `source`], `review_status`
        [`pending_review`/`committed`], `dedup_group_id` nullable,
        `deleted_at` nullable); `capture_runs` (`last_attempted_run`,
        `last_successful_run`, `run_status`
        [`success`/`job_did_not_run`/`api_call_failed`], `error_type`
        nullable); `category_rules` (`vendor_normalized` → `category`);
        `budgets` (category, limit amount, period type); `bills` (vendor,
        expected amount, expected interval, next-due date).
6.  `backend/drizzle.config.ts`, `backend/migrations/0000_initial.sql`
    (Create)
    *   **Type/Scope**: D1 migrations (via `drizzle-kit`/`wrangler d1
        migrations`).
    *   **Proposed Changes**: Initial migration creating all tables above.

#### Backend — capture adapters

7.  `backend/src/adapters/gmailAdapter.ts` (Create)
    *   **Type/Scope**: Integration adapter.
    *   **Proposed Changes**: Queries Gmail via direct REST calls
        (`messages.list` / `messages.get`) scoped by sender address/subject
        pattern (not label-based), for both backfill and incremental
        polling (using a stored `historyId` watermark). Parses matching
        emails into draft transaction rows with `source: gmail_email`;
        low-confidence parses are written with `review_status:
        pending_review`. Records query-version and scanned/matched counts
        for drift detection.
8.  `backend/src/adapters/statementAdapter.ts` (Create)
    *   **Type/Scope**: Integration adapter.
    *   **Proposed Changes**: Parses uploaded CSV files directly; PDF files
        via `unpdf` plus per-bank-format profile modules
        (`backend/src/adapters/bankProfiles/`, one per supported bank
        format — exact banks pending the Open Question above). Writes rows
        with `source: statement_import`, `provenance: {fileRef, rowIndex}`.
9.  `backend/src/adapters/manualAdapter.ts` (Create)
    *   **Type/Scope**: Integration adapter.
    *   **Proposed Changes**: Handles the "log a missed transaction" form
        submission — writes directly with `source: manual_missed`,
        `review_status: committed`, no provenance beyond user input, and is
        never passed to the de-duplication engine.

#### Backend — processing services

10. `backend/src/services/captureScheduler.ts` (Create)
    *   **Type/Scope**: Cron Trigger handler (invoked hourly by
        `wrangler.toml`'s schedule, not a persistent process).
    *   **Proposed Changes**: On each invocation, calls `gmailAdapter`,
        updates `capture_runs` state (attempted/successful timestamps,
        status, error type), and retries API-call failures up to 3 times
        with exponential backoff (1/5/15 min, implemented as re-invocation
        state rather than an in-process sleep, since a single Worker
        invocation has a bounded execution time) before marking the run
        failed.
11. `backend/src/services/watchdog.ts` (Create)
    *   **Type/Scope**: Reliability monitor, invoked by its own Cron
        Trigger independent of `captureScheduler`.
    *   **Proposed Changes**: Checks `capture_runs` state; if 2 consecutive
        expected hourly runs have no recorded successful completion, calls
        `notificationEngine` with a named failure reason (job-did-not-run
        vs. the specific `error_type`).
12. `backend/src/services/dedupEngine.ts` (Create)
    *   **Type/Scope**: Matching logic.
    *   **Proposed Changes**: On every new `gmail_email` or
        `statement_import` transaction, compares against existing committed
        transactions from the *other* source using date proximity, amount
        equality, and vendor fuzzy-matching (exact thresholds pending the
        Open Question above); on a match, assigns a shared `dedup_group_id`
        to both rows for user resolution. Supports batch comparison for
        backfill-scale imports, chunked to stay within a single Worker
        invocation's execution-time limit.
13. `backend/src/services/categorizationEngine.ts` (Create)
    *   **Type/Scope**: Business logic.
    *   **Proposed Changes**: Looks up `vendor_normalized` in
        `category_rules`; assigns the matched category or a default
        "Uncategorized." When the user corrects a transaction's category,
        upserts the `category_rules` entry for that vendor.
14. `backend/src/services/notificationEngine.ts` (Create)
    *   **Type/Scope**: Shared delivery layer.
    *   **Proposed Changes**: Defines a `Trigger` interface (evaluate →
        notify); sends outbound notifications via the chosen email provider
        (provider TBD, see Open Questions — must have a Workers-compatible
        HTTP API, e.g. Resend or Postmark, since the Workers runtime can't
        use SMTP sockets directly). Does not contain trigger evaluation
        logic itself — that lives in the individual trigger modules below.
15. `backend/src/services/budgetAlertTrigger.ts` (Create)
    *   **Type/Scope**: Trigger implementation.
    *   **Proposed Changes**: Evaluates committed transactions against
        active budgets; calls `notificationEngine` when a threshold is
        crossed (exact threshold model pending the Open Question above).
16. `backend/src/services/billReminderTrigger.ts` (Create)
    *   **Type/Scope**: Trigger implementation.
    *   **Proposed Changes**: Evaluates the manual bill registry for
        upcoming due dates; calls `notificationEngine`. Auto-detection from
        recurring transaction patterns is explicitly out of scope for this
        file's first version (layered on later per the Goals/build-order).
17. `backend/src/services/trendsService.ts` (Create)
    *   **Type/Scope**: Aggregation/query logic.
    *   **Proposed Changes**: Aggregates committed transactions by category
        and time period for the dashboard; labels periods/sources with
        little or no data explicitly rather than rendering a misleading
        empty chart.

#### Backend — API routes (Hono)

18. `backend/src/routes/transactions.ts` (Create) — list/get transactions,
    correct a category, list/resolve dedup candidates.
19. `backend/src/routes/missedTransactions.ts` (Create) — the "log a missed
    transaction" endpoint, delegating to `manualAdapter`.
20. `backend/src/routes/statements.ts` (Create) — statement file upload
    endpoint, delegating to `statementAdapter`.
21. `backend/src/routes/capture.ts` (Create) — manual backfill trigger,
    current capture-health status (for the frontend's Capture Health page).
22. `backend/src/routes/authGmail.ts` (Create) — Gmail OAuth connect,
    callback, and reconnect endpoints.
23. `backend/src/routes/trends.ts` (Create) — trends/breakdown query
    endpoint.
24. `backend/src/routes/budgets.ts` (Create) — budget CRUD endpoints.
25. `backend/src/routes/bills.ts` (Create) — bill/subscription registry CRUD
    endpoints.
26. `backend/src/index.ts` (Create)
    *   **Type/Scope**: Worker entrypoint.
    *   **Proposed Changes**: Instantiates the Hono app, mounts all routers
        above for the `fetch` handler, and exports the `scheduled` handler
        that `wrangler.toml`'s Cron Triggers invoke for
        `captureScheduler`/`watchdog`.

#### Backend — tests

27. `backend/test/dedupEngine.test.ts` (Create) — covers true-duplicate
    matches, near-miss non-matches, and backfill-scale batch comparisons.
28. `backend/test/categorizationEngine.test.ts` (Create) — covers rule
    lookup, default "Uncategorized" fallback, and correction-updates-the-
    rule behavior.
29. `backend/test/gmailAdapter.test.ts` (Create) — covers parsing against
    recorded sample NayaPay emails (fixtures), and behavior when a sample
    doesn't match the expected template (should quarantine, not crash).
30. `backend/test/statementAdapter.test.ts` (Create) — covers CSV parsing
    against sample files for each in-scope bank format.
31. `backend/test/watchdog.test.ts` (Create) — covers the 2-missed-run
    threshold, the retry/backoff sequence, and that a successful poll with
    zero matches does *not* trigger an alert.

#### Frontend

32. `frontend/package.json`, `frontend/vite.config.ts` (Create) — React +
    Vite project setup.
33. `frontend/src/api/client.ts` (Create) — typed wrapper around the Hono
    JSON endpoints.
34. `frontend/src/types/transaction.ts` (Create) — TypeScript types mirroring
    the backend's `transactions` schema.
35. `frontend/src/pages/Dashboard.tsx` (Create) — trends/breakdowns view,
    reading from `/trends`, with explicit sparse/missing-coverage states.
36. `frontend/src/pages/Transactions.tsx` (Create) — transaction list with
    inline category correction.
37. `frontend/src/pages/DedupReview.tsx` (Create) — shows candidate
    duplicate pairs (grouped by `dedup_group_id`) for the user to keep or
    discard, with a batch-resolution view for backfill-scale result sets.
38. `frontend/src/pages/LogMissedTransaction.tsx` (Create) — the narrow
    manual-entry form, posting to `/missed-transactions`.
39. `frontend/src/pages/StatementUpload.tsx` (Create) — file upload UI for
    PDF/CSV statements.
40. `frontend/src/pages/Budgets.tsx` (Create) — budget CRUD UI.
41. `frontend/src/pages/Bills.tsx` (Create) — bill/subscription registry
    CRUD UI.
42. `frontend/src/pages/CaptureHealth.tsx` (Create) — shows Gmail capture
    health status (last successful run, current alert state) and a
    reconnect-Gmail action for when the OAuth token expires.
43. `frontend/src/App.tsx`, `frontend/src/main.tsx` (Create) — route
    definitions and app entrypoint wiring the pages above together.

#### Infra / project-level

44. `.dev.vars.example` (Create) — documents required Worker
    secrets/bindings (Gmail OAuth client ID/secret, email-provider API key,
    token-encryption key) without real values, for local `wrangler dev`.
45. `frontend/wrangler.toml` or Cloudflare Pages project config (Create) —
    Pages deployment configuration for the React build.
46. `README.md` (Create) — setup and local-run instructions, including
    `wrangler d1 migrations apply` and `wrangler dev`/`wrangler deploy`
    steps.

### Verification Plan

*   **Compilation/Build**: `tsc --noEmit` for the backend, `npm run build`
    for the frontend (Vite).
*   **Unit Tests**: `vitest run` against the Workers runtime (via
    `@cloudflare/vitest-pool-workers`) — in particular, the dedup,
    categorization, Gmail-adapter, statement-adapter, and watchdog tests
    listed above.
*   **Static Analysis & Linting**: `eslint` for both backend and frontend.
*   **Test Coverage Requirement**: Not formally set for a single-user
    personal project; the dedup engine, watchdog, and the two capture
    adapters are the highest-risk modules and should be prioritized for
    coverage over the CRUD/route glue code.
*   **E2E/Integration**: `wrangler dev` locally against a real D1 instance
    (via `--local` or a preview D1 database) for a manual pass through the
    Critical User Journey of connecting Gmail, running an initial backfill
    against a real (or fixture) NayaPay inbox, uploading one statement
    file, and confirming the de-duplication UI surfaces the expected
    overlap — this is the highest-value manual check before considering v1
    done, since it's the one path no unit test can fully substitute for.

--------------------------------------------------------------------------------

*Drafted with EGM*
