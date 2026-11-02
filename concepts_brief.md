# Concept Brief: Personal Spending Tracker (Web App)

**Mode:** BRAINSTORM
**Reviewers (Goldfish lenses):** egm-design, egm-codebase-details, egm-zoom-out, egm-comprehension, egm-implementation-readiness, egm-structural

**Revision:** Round 4 — extends Round 1 (manual + OCR + statement-import), Round 2 (added Gmail/NayaPay email import), and Round 3 (sender/subject-query Gmail mechanism, dropped OCR, added a 24h silence alert) with two changes:

1. **Manual entry dropped as a capture channel — removed entirely, not deferred.** This was done specifically to sidestep Round 3's Analysis #2 finding that manual entry has no natural idempotency key and creates routine, ongoing manual-vs-email collision risk. Capture channels are now **two**: NayaPay Gmail import (unchanged mechanism) and PDF/CSV statement import (unchanged).
2. **The 24-hour silence alert is redesigned from raw email-absence to a polling-job mechanism-health check** — it now fires if the Gmail-polling job fails to run on schedule, or runs but its Gmail API call fails/errors, and explicitly must **not** fire merely because a successful poll found zero new transactions. This is the fix Round 3's Analysis #11 itself recommended.

Net channel count: **3 → 2** capture channels. Net capability count: **7 → 6** (2 capture + auto-categorization + trends/breakdowns + budget alerts + bill reminders), plus the redesigned mechanism-health alert as a seventh, narrower-scoped reliability capability, unchanged in kind from Round 3.

All six review lenses converged independently on the same headline conclusion this round: **the two changes are not symmetric in outcome.** The alert redesign is a clean, near-complete resolution of Round 3's dominant open finding (#11), with only a short, concrete punch list of implementation parameters left to pin. The manual-entry removal, by contrast, *does* cleanly close out the specific idempotency/collision problem Round 3's Analysis #2 raised — but in doing so it opens a new, independently-discovered gap that all six lenses flagged without prompting: **with manual entry gone, there is now zero capture path for any transaction that is neither a NayaPay email nor an imported statement row** (cash spend, an unsupported bank, a parser miss, a gap between statement uploads). This is reported below as new Analysis **#12**, and a closely related conflation risk (manual *entry* vs. manual *correction* of an already-ingested, quarantined record) as new Analysis **#13**.

Per the structural lens's reaffirmed recommendation, prior finding numbers (#1–#11) are preserved as stable anchors. Content that is now fully moot (the manual-entry-specific sub-problems inside #2) is removed in place, exactly as Round 3 removed OCR-specific content — but, per the structural lens's explicit caution, #2 is **not** deleted outright, because part of what it described (a capture-channel gap) has *reopened in a new form* rather than vanished; that reopened content is carried into new Analysis #12 with an explicit cross-reference, so a reader who finds #2 cited elsewhere in this document is not left with a silently broken pointer.

---

## Overview

A personal spending tracker web app for a single primary user (v1), covering **six** capabilities: NayaPay Gmail email import, PDF/CSV bank statement import, auto-categorization (with user correction), trends/breakdowns, budget alerts, and bill/subscription reminders — plus a narrow, Gmail-polling-specific reliability feature (mechanism-health alert, formerly the "24-hour silence alert").

**Context that shapes everything below:**
- No bank-sync API is available for the user's banks, with one exception: NayaPay sends a per-transaction notification email, captured by directly querying Gmail for messages matching NayaPay's sender address and/or subject-line pattern — no label, no user-created Gmail Filter. The same query mechanism serves both one-time historical backfill and ongoing polling. (Unchanged from Round 3.)
- The underlying OAuth grant is still mailbox-wide (`gmail.readonly` or equivalent); Gmail offers no narrower grant. The app's query is an application-enforced boundary, not a Google-enforced one — stated adjacently to the feature description, not buried. (Unchanged from Round 3, Analysis #9.)
- **Manual entry is removed from v1 entirely, not deferred.** It is not merely downgraded from "full channel" to "fallback" — it does not exist as a user-facing capability at all. **This leaves an explicit, product-level gap, not an implementation detail: any transaction that is cash, at a bank with no statement/email path, or missed by both automated channels for any reason, cannot be recorded in v1.** This must be stated as an accepted risk/Non-Goal (see below and Analysis #12), not left for a reader to infer from channel-count arithmetic.
- **Manual entry's removal does not remove the ability to correct an already-ingested record.** The existing quarantine/review step for low-confidence email and statement parses (Key Decision #8, unchanged) still requires some edit surface to fix a misparsed vendor/amount/date before commit. This edit-an-existing-quarantined-record capability is explicitly retained and is architecturally distinct from the removed freeform "create a transaction from nothing" capability — see Analysis #13. The two must not be conflated in downstream spec work.
- OCR receipt scanning remains removed from scope entirely (Round 3, unchanged).
- Expected volume is small: ~100 transactions/month, single user.
- The project exists because a prior manual-tracking attempt failed for two reasons: the user **forgot to log transactions**, and found **per-line categorization tedious**. The Gmail/NayaPay channel attacks the "forgetting" half for one account. With manual entry now gone, every transaction outside NayaPay-email and statement coverage is not merely under-mitigated (Round 3's framing) — it is **structurally unrecorded**, a materially different and more severe statement than Round 3 carried. See Analysis #12.
- The redesigned alert is intended as a backstop specifically for the Gmail-polling mechanism's own failure mode (job didn't run / job ran but the API call failed) — it is not a general capture-health monitor, and it must not fire on a successful poll that simply found nothing new. (Updated per Analysis #11.)
- Platform is a web app, not native mobile — email remains the primary notification-delivery channel. (Unchanged.)
- The user was explicitly offered the option to defer alerts/trends/reminders to a later release and **declined**. That remains an accepted, known risk and is not reopened here. **Note, however, that the manual-entry removal is a different kind of scope change** — it narrows a capability the user had previously seen confirmed as a full v1 channel (Round 3), driven by an architecture simplification rather than a user request. This brief records that fact plainly rather than presenting the removal as a cost-free win; it is a reasonable call for v1, but it is a tradeoff, and should be presented to the user as one if/when this brief is reviewed with them.

**Net scope framing (zoom-out lens):** by capability count, Round 3 was 3 capture + 4 consumer + 1 reliability = 8; Round 4 is 2 capture + 4 consumer + 1 reliability = 7. Unlike Round 3's OCR removal (which traded out a self-contained, independently-droppable capability with no downstream dependents), this round's manual-entry removal **deletes the backstop that Round 1–3's own narrative relied on** for every account and expense type outside NayaPay-email and statement coverage. The reduction in dedup/schema surface is real and should be credited (3 pairwise channel relationships → 1), but it must not be presented to stakeholders as a pure simplification win — it is a simplification that trades a well-understood, already-partially-mitigated problem (manual↔email collision) for a new, previously-absent hard gap (zero capture path for anything else). Both the health-check alert and the manual-entry removal are detailed below; the former is close to implementation-ready, the latter needs one explicit, short decision recorded before this brief is treated as final.

---

## Analysis

Status tags below mark each finding's standing as of Round 4: `[Round 4 — resolved]`, `[Round 4 — mitigated]` (materially improved but not fully closed), `[Round 4 — unchanged]`, `[Round 4 — reopened]`, `[Round 4 — obviated by scope removal]` (the problem didn't get solved, the thing that had the problem was removed), or `[Round 4 — new]`.

### 1. The feature list still does not, by itself, solve its own stated problem — `[Round 4 — reopened, widened]`

Round 3 stated this finding's open half as: "for every other account [besides NayaPay], and for categorization tedium generally, the single-gesture correction UX remains unaddressed; email capture reduces but does not eliminate the forgetting problem, proven for exactly one account." That framing implicitly assumed manual entry still existed as *some* mitigation for "every other account." With manual entry now removed, that mitigation is gone, not merely unaddressed — see Analysis #12 for the full statement of this gap. This finding is widened, not narrowed, by Round 4's change.

### 2. Capture-channel de-duplication — `[Round 4 — mitigated / obviated by scope removal, partially reopened under #12]`

Round 3's Analysis #2 raised two problems, both specific to manual entry's confirmed full-channel status:
- **No natural idempotency key for manual entry.** `[Round 4 — obviated by scope removal]` There is no manual channel left to need a token; this sub-problem is moot, following the same precedent Round 3 used to remove OCR-specific content outright.
- **Manual↔email routine, steady-state collision risk.** `[Round 4 — obviated by scope removal]` With manual entry gone, there is no manual-side input to collide with email capture. This sub-problem is moot for the same reason.

De-dup combinatorics shrink accordingly: from **three channels / three pairwise relationships** (manual↔email, manual↔statement, email↔statement) to **two channels / one pairwise relationship** (email↔statement only). This is a genuine, non-cosmetic reduction and should be stated as such rather than left for the reader to recompute.

**This is not the same claim as "Analysis #2 is resolved."** The underlying idempotency-and-collision *design problem* was not solved — the channel that had the problem was removed. That distinction matters because removing the channel surfaces a different, higher-stakes problem in its place: with no fallback capture path at all, any transaction neither automated channel catches is now simply absent from the system, with no manual recourse to add or reconcile it. **This reopened consequence is carried forward as new Analysis #12**, not folded silently into this entry's "resolved" status.

### 3. Cold-start and sparse-data behavior — `[Round 4 — unchanged, context sharpened by #12]`

Unaffected directly by this round's two changes in mechanism, but its real-world severity is sharpened by Analysis #12: data asymmetry across accounts (rich NayaPay history vs. sparse/empty elsewhere) is no longer just a "coverage is uneven" problem — for non-NayaPay, non-statement-covered activity, there is now no mechanism at all to close that gap, ever, in v1. Per-source coverage labeling in trends UI remains required, and should now explicitly label the "manually uncoverable" gap as structural, not merely sparse.

### 4. The shared notify subsystem hosts qualitatively different trigger shapes — `[Round 4 — unchanged]`

Round 3's architecture is unaffected by either Round 4 change: budget alerts and bill reminders remain threshold-crossing triggers over trusted data; the mechanism-health alert (renamed from "silence alert," see Analysis #11) remains an absence/failure-detection trigger that must work even when the data pipeline it monitors is itself unhealthy. The recommendation stands unchanged: share only the outbound delivery layer; keep the alert's trigger/evaluation logic inside or adjacent to the Capture Scheduler, with an open-for-extension trigger-type model and a distinct urgency tier exempt from advisory-notification throttling.

### 5. Canonical Transaction model across two adapters, not three — `[Round 4 — mitigated]`

Dropping manual entry removes a second source-typed provenance-metadata shape from the canonical schema (the client-generated-idempotency-token variant Round 3 Analysis #5 left as an open question) — a real, now-moot simplification. The schema needs only two provenance shapes: email (Gmail message ID, thread ID, raw body, `parserVersion`, sync watermark) and statement (file reference, row index). This closes Round 3 Analysis #5's open manual-entry schema question outright — there is no manual adapter left to design one for.

As with Analysis #2, this is a reduction in schema *surface*, not in the schema's *hardest* problem: the email adapter remains the most structurally demanding of the two remaining adapters, exactly as Round 3 stated, because it parses semi-structured, vendor-controlled content rather than a clean CSV row.

### 6. Scope realism: producer/consumer distinction and build order — `[Round 4 — mitigated, build order updated]`

The producer/consumer distinction holds: email import remains the primary, push-triggered channel for the NayaPay account and should be proven early, including its de-dup behavior, before other channels are layered on. Round 4 removes the manual-entry step from the build order entirely (rather than leaving it as a stale reference), and the backfill step's rationale changes: Round 3 framed step 2 as "proving the dedup engine against its highest-volume collision case (backfill vs. years of manual history)" — with manual history gone, there is no manual data to dedup against at that step. See the revised build order in Key Decisions.

### 7. Technical feasibility per subsystem — `[Round 4 — unchanged]`

Round 3's conclusions for categorization (rule/keyword at this volume), statement import (CSV-first, narrowly-scoped PDF), and the Capture Scheduler vs. Notification Engine split are all unaffected by either Round 4 change. Polling remains the v1 recommendation for Gmail capture for the same reasons as before.

### 8. Implementation readiness: known un-made decisions — `[Round 4 — mitigated, with new items added]`

Manual entry's idempotency-mechanism decision (Round 3's open item, "to be confirmed") is now moot — there is no mechanism left to confirm. Category taxonomy, exact bank statement formats, budget period definition, notification delivery channel, and bill/subscription detection mode remain exactly as open as in prior rounds; dropping manual entry does not touch any of them.

**New items this round** (see Analyses #11–#13 for full detail): the mechanism-health alert needs concrete missed-schedule threshold, retry/backoff policy, and new state fields (last-attempted-run timestamp, last-successful-run timestamp, run-status enum, error-type classification) before it is buildable; the capture-fallback gap (Analysis #12) needs an explicit accepted-risk statement; and the manual-entry-vs-quarantine-correction distinction (Analysis #13) needs one clarifying sentence in the spec so the quarantine-review UI isn't mistakenly scoped out along with freeform manual entry.

### 9. Gmail integration risk surface — `[Round 4 — unchanged]`

Unaffected by either Round 4 change. All Round 3 content stands: the sender/subject-scoped query is an application-enforced boundary over a mailbox-wide OAuth grant (must be stated adjacently to the feature description); query-drift telemetry (persisted query version, emails scanned, emails matched) is required to distinguish a broken query from genuine mailbox inactivity; parsing reliability, credential lifecycle, retention policy, and NayaPay-only-scoping rationale remain open exactly as before.

### 10. Document- and spec-level ambiguities — `[Round 4 — updated]`

The dedup-threshold question (tighter/looser cross-channel matching given channel overlap) now applies to **exactly one pairwise relationship** (email↔statement), down from "up to two of three" in Round 3. Still a Nit-level, one-line decision.

### 11. The mechanism-health alert (formerly "24-hour silence alert") — `[Round 4 — mitigated, narrowed; renamed]`

All six lenses confirm the redesign directly implements Round 3's own recommendation and resolves the dominant problem that recommendation was written against: the alert's primary trigger is now poll-job mechanism health (job-didn't-run, or job-ran-but-the-Gmail-API-call-failed/errored), independent of whether any matching email existed, and it explicitly must not fire on a successful poll that found zero new transactions. This closes Round 3's bullet 2 (three unrelated root causes conflated into one signal) and directly resolves the false-positive-on-ordinary-inactivity problem (Round 3's bullet 1) for the specific case of "the job ran fine, there was just nothing to find."

**Residual, concrete gaps — all six lenses converged on the same short list, none of which is open-ended:**
- **No stated missed-schedule threshold.** "Fails to run on schedule" needs a concrete rule — e.g., one missed scheduled run vs. N consecutive misses vs. a fixed lateness-past-expected-cadence window. Left unstated, this recreates Round 3's original "no stated basis for the figure" problem one layer down, at the infrastructure level instead of the data level.
- **No stated retry/backoff policy before alerting.** A single transient Gmail API error (brief rate-limit, momentary network blip) should not immediately surface a user-facing alert — doing so risks exactly the alert-fatigue outcome this redesign exists to prevent. The spec needs to state whether a failure must persist across N consecutive attempts or survive a backoff window before escalating to the user, versus being logged internally and only escalated on sustained failure.
- **"Distinguish job-didn't-run vs. ran-but-API-failed if practical" is an unresolved hedge.** This must be resolved to a firm yes (and the two states named with concrete fields) or a firm no (ship one undifferentiated "Gmail capture health check failed" alert in v1, split deferred) — "if practical" gives an implementer no decision rule.
- **New state fields are implied but not named.** At minimum: last-attempted-run timestamp, last-successful-run timestamp, a run-status enum (`success | job-did-not-run | api-call-failed`), and an error-type/error-code field (auth failure vs. rate limit vs. network timeout vs. unknown). These belong in the Capture Scheduler's state model, built alongside the scheduler itself (build-order step 5), not deferred to the alert's own step.
- **"Job didn't run" requires a component external to the job itself.** A job that fails to execute cannot self-report its own absence — this needs either an external scheduler-level dead-man's-switch/watchdog, or equivalent cron-monitoring infrastructure, independent of the Capture Scheduler process the polling job runs inside. This is the design lens's sharpest addition this round: without a watchdog, "job didn't run" silently degrades back into an unmonitored failure mode.
- **Naming/threshold-semantics carryover.** If the feature is still called "the 24-hour silence alert," that name now misleadingly implies the old email-absence semantics. Either rename the feature (e.g., "Gmail capture health alert") or state explicitly what, if anything, a time window still means under the new mechanism-health design (e.g., an escalation/digest point distinct from per-cycle health checks).
- **Statement import and Gmail historical backfill remain uncovered — this is appropriate, not an oversight, but must be stated explicitly.** Statement import is user-initiated/pull-based; there is no scheduled background job on that channel to health-check, so "no equivalent check" is not an asymmetry to fix, it is a structural fact that should be written into the spec as a deliberate scoping statement rather than left as a silent gap (the same framing Round 3 already applied to the old alert's single-channel coverage).
- **"Who watches the watcher" remains open, unaffected by this redesign.** Round 3's minor point (an admin-visible "capture health last checked at <timestamp>" status line for the evaluator itself) still applies and is not addressed by the mechanism-health change.

**Net assessment**: this finding is correctly retagged `mitigated, narrowed` rather than `resolved` — the architectural shift is sound and closes the hardest part of Round 3's critique (false-positive rate, root-cause conflation), but a short, concrete, fully-enumerable list of implementation parameters remains before this feature is buildable. None of the remaining items is open-ended or requires another full multi-lens round; they are the kind of one-line decisions normal at this stage.

### 12. The capture-fallback gap: zero recourse for transactions outside NayaPay-email and statement coverage — `[Round 4 — new]`

All six review lenses, independently and without prompting, identified this as the single most consequential consequence of removing manual entry. With manual entry gone, there is **no path at all** to record: cash spending; a transaction at any bank/account with no NayaPay email and no statement uploaded (or not uploaded yet); or any transaction either automated channel fails to capture for any reason (a parser miss, Gmail query drift per Analysis #9, a skipped statement upload, or a gap between statement cycles). This is categorically different from Round 3's "sparse coverage for non-NayaPay accounts" framing (a *degraded* experience) — it is a **hard, structural zero**: previously, Round 1–3's entire narrative relied on manual entry as the backstop for exactly this case ("every other account... still depends on the same mitigations as Round 1," Round 3 Analysis #1). That backstop no longer exists.

This is explicitly the project's founding problem statement, reopened in a new guise: the project exists because the user forgot to log transactions manually; for anything outside the two automated channels, that is no longer a "forgetting" risk mitigated by friction-reduction — it is a channel that simply does not exist. Removing it may be the right call for v1 (it does remove a genuinely messy idempotency/collision problem, and a lean v1 scoped tightly to two reliable, automatable channels is a defensible product shape), but as currently stated, this tradeoff is implicit rather than decided. The brief must record one explicit stance, not leave it to be discovered later:

- **(a) Accept it as a stated v1 Non-Goal/known risk**: "Recording any transaction outside NayaPay-email or statement-import coverage — including cash spend — is not possible in v1; there is no manual fallback. This is an accepted, structural gap, not an oversight." — or —
- **(b) Reintroduce a minimal, narrowly-scoped correction/add affordance** distinct from "manual entry as a full standing channel" (e.g., a lightweight "log a transaction we didn't catch" action that is explicitly out of the cross-channel dedup model because it has no counterpart to collide with) — understanding that this would re-partially-reopen Round 3's Analysis #2 idempotency question, now scoped to a narrower, lower-volume surface.

Either is a legitimate, lockable decision. What is not acceptable, per every lens's independent framing, is silence — a reader of a prior round (where manual entry was a "confirmed full channel") encountering "removed entirely" with no adjacent statement of consequence will reasonably assume some override still exists, because no comparable consumer product ships with zero manual override. This must be stated adjacently to the capture-channels description in Overview, matching the standard this brief already holds itself to for the OAuth-mailbox-wide fact (Analysis #9) and the alert's single-channel coverage (Analysis #11).

### 13. Manual *entry* (creation) vs. manual *correction* (editing an already-ingested, quarantined record) — `[Round 4 — new]`

A related but distinct conflation risk, raised independently by the design and codebase-details lenses: "manual entry removed entirely" must not be read as also removing the ability to edit/correct a transaction that one of the two automated channels *did* capture but captured incorrectly (a misparsed amount, vendor, or date). Key Decision #8 (unchanged from Round 3) already requires that low-confidence email/statement parses be quarantined for user review before being committed as fully trusted — and "review" necessarily implies some UI surface to fix the quarantined record before it commits. That edit surface:

- Operates on an **already-keyed artifact** (the Gmail message ID or the statement file-ref + row index remains the identity anchor) — it is not a freeform creation with no originating artifact, so it does not reopen the idempotency problem Analysis #2 correctly closed.
- Is therefore **architecturally distinct** from the removed freeform manual-entry channel, and must be explicitly retained and named as such in the spec, or Key Decision #8's quarantine mechanism becomes a dead end with no resolution path.

This must be one clarifying sentence in the Overview and in Key Decision #8's restatement: manual entry (creating a transaction from nothing) is gone; manual correction (editing a quarantined, already-captured record before it commits, or correcting a category post-commit per the unchanged auto-categorization goal) is retained. These are two different capabilities and the brief must not let "manual entry removed entirely" read as broader than it is.

---

## Goals vs Non-Goals

### Goals (v1)
- Ship all **six** stated capabilities — NayaPay Gmail email import, PDF/CSV statement import, auto-categorization with correction, trends/breakdowns, budget alerts, bill/subscription reminders — per the user's prior decision not to narrow this set of consumer-facing scope. `(Round 4 — updated count: 7 → 6; manual entry removed, not narrowed)`
- Ship the mechanism-health alert (renamed from "24-hour silence alert") as the **seventh** consumer of the shared notification *delivery* layer, with trigger/evaluation logic kept distinct from the Notification Engine's rule-evaluation loop (Analysis #4, unchanged). Its primary trigger is Gmail-polling-job mechanism health (job-didn't-run or job-ran-but-API-call-failed), not email absence, and it must not fire on a successful poll with zero new transactions. `(Round 4 — redesigned per Analysis #11)`
- Establish one canonical, source-agnostic Transaction data model with source-typed provenance metadata across the **two** remaining channels (email, statement) — email carries the idempotency key (Gmail message ID), raw body, and parser version it specifically requires. `(Round 4 — updated: dropped manual entry's provenance shape entirely, not merely its idempotency mechanism)`
- Capture NayaPay transactions via a direct Gmail query scoped by sender/subject pattern — no label, no Gmail Filter — covering both backfill and ongoing polling under one mechanism. State adjacently that the OAuth grant is mailbox-wide regardless of this scoping. (Unchanged from Round 3.)
- Build a rule-based, vendor-keyword auto-categorization engine where every user correction permanently updates that vendor's mapping. (Unchanged.)
- Define and surface explicit empty/sparse-data states for trends, including per-source coverage labeling, and now explicitly labeling the capture-fallback gap (Analysis #12) as structural rather than merely sparse. `(Round 4 — updated per Analysis #3/#12)`
- Define a de-duplication strategy covering (a) per-source ingestion idempotency and (b) cross-channel fuzzy matching with a stated precedence/merge model, now scoped to exactly **one** pairwise relationship (email↔statement). `(Round 4 — updated: 3 channels → 2; manual-entry idempotency requirement removed as moot)`
- Any Gmail-capture outage must surface as a visible, self-notifying failure state via a mechanism-health signal (poll-job heartbeat + Gmail API call success/failure), with concrete missed-schedule threshold, retry/backoff policy, and state-field schema locked before implementation (Analysis #11). `(Round 4 — updated: adds the concrete parameter list the design must pin)`
- **Capture-fallback gap resolved (Analysis #12, option (b) adopted):** ship a narrow "log a transaction we missed" affordance — a lightweight add action for transactions outside NayaPay-email/statement coverage (cash, uncovered banks, parser misses). It is explicitly **exempt from the cross-channel dedup model** (nothing automated to collide with) and is **not** a reintroduction of full manual entry — it has no idempotency/collision burden because it is not meant to duplicate what the two automated channels already capture. `(Round 5 — resolved, user decision: option (b))`
- **State explicitly that manual correction of an already-ingested, quarantined record is retained**, distinct from the removed freeform manual-entry channel (Analysis #13). `(Round 4 — new, required)`

### Non-Goals (v1)
- Multi-user / family / shared-account support (explicitly deferred by the user).
- Live bank-sync / bank API integration for any bank other than NayaPay's email-based path.
- Generic, bank-agnostic PDF statement parsing — v1 scopes PDF parsing to the user's actual 1–3 bank formats.
- A trained ML classifier for categorization — rule/keyword + per-vendor correction override is the v1 mechanism.
- Per-source special-cased business logic in categorization, trends, or alerts.
- Precomputed/cached aggregates without an explicit invalidation hook on category correction.
- OCR receipt scanning / line-item receipt parsing — dropped entirely in Round 3, not deferred. (Unchanged.)
- Email-based import for any bank other than NayaPay in v1. (Unchanged.)
- Inbox-wide scanning or processing of any email outside the app's own sender/subject-scoped query, even though the OAuth grant is mailbox-wide. (Unchanged.)
- Push-based (Pub/Sub webhook) real-time Gmail capture in v1 — polling is the v1 mechanism; webhook-based push is deferred. (Unchanged.)
- General capture-health monitoring across every channel — the mechanism-health alert covers Gmail-polling mechanism health only; statement-import has no scheduled background job and therefore no equivalent check is structurally meaningful (must be stated as a deliberate fact, per Analysis #11, not a silent gap). `(Round 4 — updated framing)`
- **Manual entry as a full, standing channel — removed, not deferred.** What replaces it is a narrow, dedup-exempt "log a missed transaction" affordance (Analysis #12, option (b)), not a reopening of Round 3's full manual-entry channel: no idempotency/collision burden, no routine manual↔email overlap, used only to fill a gap neither automated channel caught. `(Round 5 — resolved)`
- Manual entry as a **full, standing capture channel** remains removed (Round 4). Resolved by the user: Analysis #12's gap is closed via option (b) — a narrow "log a transaction we missed" affordance, not a reopening of full manual entry. `(Round 5 — resolved, user decision)`

---

## Alternatives Weighed

### Round 1 decisions (unchanged)

| Decision point | Options considered | Direction favored | Why |
|---|---|---|---|
| Categorization engine | (a) rule/keyword table with per-vendor correction override, (b) trained ML text classifier, (c) LLM-based classification per transaction | (a), with (c) as a fallback only for unmatched/low-confidence vendors | 100 tx/month is far too little signal to usefully train (b); (a) is transparent, debuggable, and improves on every correction. |
| Statement import scope | (a) generic any-bank PDF/CSV parser, (b) per-bank "import profile" library scoped to the user's actual 1–3 banks, CSV-first | (b) | Bank PDF/CSV layouts vary too much for a robust generic parser to be worth building for a single user's fixed set of sources. |
| Bill/subscription detection | (a) auto-inferred from recurring vendor+amount+interval patterns, (b) user-maintained manual registry | Sequenced: (b) first, (a) layered on once enough transaction history exists | Auto-detection needs several billing cycles of clean data; NayaPay backfill provides this sooner for that account only. |
| Notification architecture | (a) two separate codepaths, (b) one shared Notification Engine with pluggable trigger types | (b) | Both features are the same "rule + trigger + notify" shape; building separately doubles preference/delivery/dedup state for no benefit. |
| Notification delivery channel | in-app only, email, browser push, SMS | Email as primary/reliable; in-app secondary; push a stretch goal | Web app (not native) makes push unreliable across browsers; email works regardless of whether the tab is open. |
| OCR extraction approach | (a) custom Tesseract + regex, (b) dedicated receipt-parsing API, (c) vision-LLM extraction | Dropped in Round 3 — feature removed from scope, not a live technical-approach question. | See Round 3 Analysis #6/#7; OCR no longer exists as a v1 capability. |

### Round 2/3 Gmail-channel decisions (unchanged from Round 3)

| Decision point | Options considered | Direction favored | Why |
|---|---|---|---|
| Gmail capture mechanism | (a) push via Pub/Sub `users.watch()` + public webhook, (b) scheduled polling via `history.list`/`messages.list` | (b) for v1; (a) deferred as a stretch goal | Polling reuses scheduler infrastructure the Notification Engine already needs; at ~100 tx/month latency difference is irrelevant. |
| Gmail OAuth scope | (a) `gmail.readonly`, (b) `gmail.metadata`, (c) `gmail.modify` | (a) | Body content is required to parse amount/vendor/items. Sender/subject restriction is app-enforced, not OAuth-scope-enforced — documented as an accepted, not eliminated, risk. |
| Gmail query scoping mechanism | (a) label + Gmail Filter [superseded], (b) direct sender/subject query [adopted] | (b) | Unifies backfill and ongoing capture under one mechanism, no user-side setup step, at the cost of relocating (not resolving) the "app-side filter, not Google-enforced" honesty obligation and introducing a query-drift failure mode (Analysis #9). |

### Round 4 decisions (new)

| Decision point | Options considered | Direction favored | Why |
|---|---|---|---|
| **Manual entry's fate** | (a) keep as a full channel with a locked idempotency token mechanism [Round 3], (b) remove entirely [Round 4, adopted], (c) remove as a *channel* but retain a narrow, dedup-exempt "log a transaction we missed" affordance | **(b)**, with **(c)** flagged as a live alternative pending Analysis #12's decision | (a) carries an ongoing, routine manual↔email collision burden for the highest-value account. (b) cleanly removes that burden but creates the capture-fallback gap (Analysis #12) — a real, structural product consequence, not a free win. (c) would resolve the gap at the cost of reopening a narrower version of the idempotency question. This row is not fully closed — see Analysis #12's required decision. |
| **Mechanism-health alert signal** | (a) raw "no matching email in 24h" [Round 3, superseded], (b) poll-job heartbeat + Gmail API call success/failure as sole trigger, explicitly excluding zero-match as a trigger [Round 4, adopted] | **(b)** | Directly resolves Round 3's false-positive and root-cause-conflation findings (Analysis #11). Residual: concrete thresholds, retry/backoff, and a watchdog component for "job didn't run" detection remain to be pinned — see Analysis #11's punch list. |
| **Statement-import health-check parity** | (a) build an equivalent scheduled-job health check for statement import, (b) explicitly exempt statement import as structurally inapplicable (no scheduled background job exists on that channel) | **(b)** | Statement import is user-initiated/pull-based; there is no "job" to miss a schedule on. Parity would manufacture a check for a failure mode that doesn't exist on that channel — but this exemption must be stated explicitly, not left as a silent gap (Analysis #11). |

---

## Key Decisions & Staging for Next Steps

**Explicit accepted risk (not reopened):** the user has committed to all six consumer-facing capabilities plus the mechanism-health alert and declined to narrow that scope. This brief does not revisit that decision.

**New, not-yet-accepted risk (must be closed before /egm-draft):** the capture-fallback gap created by removing manual entry (Analysis #12) has not yet been explicitly accepted or mitigated — it was discovered by this round's review, not decided by the user. This is the one item in this round that is a genuine open decision rather than a parameter to pin, and it should be put to the user directly: accept the gap as a stated Non-Goal, or approve a narrow correction/add affordance (Analysis #12, option (b)).

### Decisions this brief locks in for the next planning step
1. One canonical Transaction schema (amount in integer minor units, date, vendor raw+normalized, category, source, soft-delete, confidence/review-status) with source-typed provenance metadata across **two** source types — email (message ID, thread ID, raw body, parser version, sync watermark) and statement import (file ref, row index). `(Round 4 — updated: dropped the manual-entry provenance shape entirely)`
2. Categorization is rule/keyword-based with per-vendor correction override as the precedence layer; no ML classifier in v1. (Unchanged.)
3. Budget alerts, bill reminders, and the mechanism-health alert share one outbound delivery layer; the health alert's trigger/evaluation logic lives in or adjacent to the Capture Scheduler, not inside the Notification Engine's rule-evaluation loop. The Notification Engine's trigger-type model must remain open for extension. (Unchanged from Round 3 Analysis #4.)
4. De-duplication now has exactly **one** cross-channel pairwise relationship (email↔statement), governed by fuzzy matching on date/amount/vendor with a stated source-precedence/merge model and a batch-resolution UX for backfill-scale collisions. Per-source ingestion idempotency uses the Gmail message ID (email) or file ref + row index (statement). `(Round 4 — updated: manual-entry idempotency requirement removed as moot, not merely simplified)`
5. Gmail capture mechanism for v1 is direct sender/subject query for both backfill and ongoing polling, with per-poll-cycle telemetry (query version, emails scanned, emails matched). (Unchanged from Round 3.)
6. CSV import remains the primary statement-import path; PDF import is scoped to the user's specific bank formats only. (Unchanged.)
7. Bill/subscription reminders start as a manual registry for non-NayaPay accounts; recurrence auto-detection may run sooner for NayaPay given backfilled history. (Unchanged.)
8. Every statement-import and email-import result passes through a review step before being committed as fully trusted: low-confidence parses and any email that fails to parse cleanly are quarantined for user review, never silently dropped or committed. **The quarantine-review step requires an edit surface to correct a quarantined record's vendor/amount/date before commit — this is manual correction, explicitly retained, and is architecturally distinct from the removed manual-entry channel.** `(Round 4 — updated: clarifies that quarantine-review's edit surface survives the manual-entry removal, per Analysis #13)`
9. The mechanism-health alert's primary trigger is Gmail-polling-job mechanism health (job-didn't-run, or job-ran-but-API-call-failed), never zero-match-found. **Parameters pinned (Round 5, user decision):**
   - (a) **Missed-schedule threshold:** job is expected to run hourly; alert escalates if it misses **2 consecutive scheduled runs** (i.e., no successful run recorded in over 2 hours).
   - (b) **Retry/backoff policy:** on an API-call failure, retry **3 times with exponential backoff (1 min / 5 min / 15 min)** before escalating to a user-facing alert; a single transient failure is logged internally only, not surfaced to the user.
   - (c) **Job-didn't-run vs. API-call-failed distinction: firm yes — hard v1 requirement.** Every alert must state the specific, concrete failure reason (e.g., "auth token expired," "rate limited," "network timeout," "job did not execute") rather than a generic "something went wrong" message.
   - (d) State fields: last-attempted-run timestamp, last-successful-run timestamp, run-status enum (`success | job-did-not-run | api-call-failed`), error-type field (auth-failure | rate-limit | network-timeout | unknown).
   - (e) "Job didn't run" detection requires a watchdog/dead-man's-switch component external to the polling job itself (unchanged requirement).
   - (f) Statement import has no equivalent check — stated explicitly as a deliberate structural fact, not an oversight, since it has no scheduled job to monitor.
   - **Naming:** renamed from "24-hour silence alert" to **"Gmail capture health alert,"** since the time-window-based name no longer matches the mechanism-health design.
   `(Round 5 — resolved; all Analysis #11 punch-list items pinned)`
10. **The capture-fallback gap (Analysis #12) is resolved: option (b) adopted.** A narrow, dedup-exempt "log a transaction we missed" affordance ships in v1 for transactions outside NayaPay-email/statement coverage (cash, uncovered banks, parser misses). It is architecturally distinct from the removed full manual-entry channel: no idempotency token, no routine collision handling, since it has nothing automated to collide with. `(Round 5 — resolved, user decision)`

### Still-open specification gaps to resolve before implementation starts (not blocking /egm-draft's start, but must close before build)

*Removed as moot (Round 3 — OCR dropped; still moot):*
- OCR provider selection; receipt-photo retention policy; line-item receipt parsing scope.

*Removed as moot (Round 4 — manual entry dropped):*
- Manual-entry self-duplication mechanism (client-side idempotency token vs. fuzzy-match reliance) — no longer applicable, no channel exists to need it.
- Manual-entry provenance metadata shape in the canonical schema — no longer applicable.

*Resolved in Round 5 (user decisions locked in):*
- **Capture-fallback gap stance** (Analysis #12): resolved — option (b), narrow dedup-exempt "log a missed transaction" affordance.
- **Manual-entry vs. manual-correction disambiguation** (Analysis #13): confirmed — quarantine-review edit surface is retained.
- **Missed-schedule threshold**: resolved — 2 consecutive missed hourly runs.
- **Retry/backoff policy**: resolved — 3 retries, exponential backoff (1/5/15 min), alert only after retries exhausted.
- **Job-didn't-run vs. API-call-failed distinction**: resolved — hard v1 requirement, every alert states the specific failure reason.
- **New Capture Scheduler state fields**: resolved — last-attempted-run, last-successful-run, run-status enum, error-type field.
- **External watchdog/dead-man's-switch component**: confirmed required, unchanged.
- **Feature naming**: resolved — renamed to "Gmail capture health alert."
- **Explicit statement-import exemption statement**: confirmed — stated as deliberate structural fact in Non-Goals.

*Still genuinely open — not yet decided, not blocking for /egm-draft to begin:*
- Category taxonomy (actual list of categories/subcategories).
- Exact bank statement formats in scope (which 1–3 banks, CSV column layouts, text-based vs. scanned PDFs).
- Budget period definition (calendar month vs. rolling window) and alert threshold model.
- Notification delivery channel implementation (email service choice).
- NayaPay email parsing approach (body) and template-drift handling, quarantine-not-silent-drop policy, regression fixture set.
- OAuth token storage and lifecycle: encrypted-at-rest storage, redeploy-durable persistence, revocation/expiry handling with a user-visible reconnect flow.
- Rollout/rollback plan for NayaPay's transition to email-primary capture.
- De-duplication matching rule specifics: date tolerance, amount match, vendor fuzzy-match threshold; whether NayaPay's email body contains a usable unique transaction reference.
- Data retention policy covering raw email content and OAuth tokens.
- Rationale for NayaPay-only scoping, currently unstated in the spec.
- UX/entry point for the new "log a missed transaction" affordance (Analysis #12, option (b)) — not yet designed, just decided to exist.

### Recommended internal build order (six capabilities plus the mechanism-health alert; sequencing only)
1. Canonical transaction schema (two source types: email, statement) + rule-based categorization with correction-updates-the-rule loop. **No manual-entry step** — removed from the build order entirely, not left as a skipped item. `(Round 4 — updated)`
2. **Gmail/NayaPay email import — backfill only, no polling yet.** Batch import adapter using the sender/subject query, committed directly into the canonical store (no manual-history dedup pass required at this step, since no manual channel exists to collide with — the dedup engine is instead first proven at step 3, against statement data). `(Round 4 — updated rationale: Round 3's "prove dedup against manual history" framing no longer applies)`
3. CSV statement import for the user's other bank(s), including de-duplication against email-imported rows for the NayaPay account — this is now where the dedup engine's one remaining pairwise relationship (email↔statement) is first proven.
4. PDF statement import, scoped narrowly to formats CSV doesn't cover.
5. **Gmail ongoing polling**, reusing the Capture Scheduler, plus per-poll-cycle query telemetry and the mechanism-health state fields (last-attempted-run, last-successful-run, run-status enum, error-type field) required by step 6. These fields are built here, not deferred to step 6.
6. **Mechanism-health alert**, built on the heartbeat/API-success-flag state established in step 5, with the missed-schedule threshold and retry/backoff policy pinned (Key Decision #9) before this step starts. Delivery routed through the shared Notification Engine's delivery layer; trigger logic stays outside its rule-evaluation loop.
7. Trends/breakdowns, built once steps 1–5 have produced at least one real period of trustworthy categorized data per source, with explicit sparse-data/structural-gap empty states (Analysis #3/#12) and per-source coverage labeling.
8. Shared Notification Engine + budget alerts, built on top of the trusted aggregation layer from step 7.
9. Bill/subscription reminders (manual registry first for all accounts; auto-detection layered in once sufficient recurring-transaction history exists), reusing the Notification Engine from step 8.

`(Round 4 — renumbered: manual-entry step removed entirely from step 1 rather than left as a stale reference; step 2's rationale rewritten since there is no manual history to prove dedup against; step 5 now explicitly carries the mechanism-health state-field work that step 6 depends on.)`

### Overall convergence verdict

This concept has been through five rounds. The two items the Round 4 review flagged as blocking have both been resolved directly by the user, in chat, without requiring a further six-lens review pass (consistent with the Round 4 recommendation that neither item needed another full brainstorm round):

- **Capture-fallback gap (Analysis #12): resolved — option (b).** A narrow, dedup-exempt "log a transaction we missed" affordance ships in v1, distinct from the removed full manual-entry channel.
- **Mechanism-health alert parameters (Analysis #11): resolved.** Missed-schedule threshold (2 consecutive missed hourly runs), retry/backoff policy (3 retries, exponential backoff, alert only after exhausted), the job-didn't-run/API-call-failed distinction (hard requirement, specific reason always shown), state fields, and the rename to "Gmail capture health alert" are all pinned.

**This concept brief is now ready for `/egm-draft`.** Remaining items are genuine open specification gaps (category taxonomy, exact bank formats, budget period definition, etc. — listed above) appropriate to resolve during drafting, not blockers to starting it.
