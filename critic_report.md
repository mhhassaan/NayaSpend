# Goldfish Review Report

**Target:** `D:\projects\alfaaz\docs\designs\personal-spending-tracker.md` (lines 1-632 — Title through end of "## Future Improvements"; excludes "## Detailed Implementation Plan," lines 633-897, reviewed separately in Stage 9)

**File re-confirmed fresh at review time:** 897 total lines; "## Detailed Implementation Plan" header is at line 633, so the SemanticTarget range is unchanged at lines 1-632.

**Document standard applied (egm-design, egm-structural):** `resources/document_standards/feature-spec-standard.md`
**egm-style:** no document standard assigned; applied built-in technical-writing criteria.

**GoldfishContext read for background only (not reviewed as targets):** `D:\projects\alfaaz\concepts_brief.md`, `D:\projects\alfaaz\design_draft.md`

## Reviewer Status

| Reviewer | Status |
| --- | --- |
| `egm-design` | completed |
| `egm-structural` | completed |
| `egm-style` | completed |

## Prioritized Findings (Blockers -> Major -> Nits)

No Blocker-severity findings were reported by any reviewer in this scope.

### Duplicate transactions can be double-counted in trends/budget aggregation before the user resolves the dedup pair - Severity: Major
* **Reviewer Lens:** `egm-design`
* **Affected Scope:** Lines 220-224, 282-299, 341-357
* **Discrepancy Description**: `dedup_group_id` is set on both sides of a matched pair, and both records stay `committed` until the user resolves which copy to keep (or confirms both are legitimate, lines 296-297). Trends, budget alerts, and bill reminders all read from "the same committed-transaction store" (line 343) with no stated exclusion for unresolved duplicate pairs, so an unresolved NayaPay-email/statement duplicate can be aggregated twice — skewing trend totals and potentially firing a false budget-exceeded alert, which is exactly the kind of false-positive the design elsewhere (Alternative I) says it is trying to avoid.
* **Rationale & Recommendation**: This is a correctness gap in the proposed architecture, not a cosmetic issue. State explicitly whether aggregation excludes/merges one side of an unresolved `dedup_group_id` pair, or otherwise prevents double-counting, until the user resolves it.

### Adopted runtime/hosting stack is never stated in the Technical Plan itself; it surfaces only as forward references - Severity: Major
* **Reviewer Lens:** `egm-design`, `egm-style` (overlapping findings, consolidated)
* **Affected Scope:** Lines 118-121, 199-410, 548-589, 606-608
* **Discrepancy Description**: The Technical Plan ("Proposed Architecture") never names the runtime/database (Cloudflare Workers + D1) — it stays at the level of "canonical store," "scheduled job." A fresh reader's first encounter with "Cloudflare Workers" is an aside in Open Questions (line 119-121, "...since the Cloudflare Workers runtime cannot use SMTP sockets directly"), roughly 80 lines before the Technical Plan even begins, and the actual justification for the choice appears later still, inside Alternatives Considered (J/K/L, lines 548-589) — a section normally used to explain rejected paths, not assert the adopted one — and again in a single NFR bullet (606-608).
* **Rationale & Recommendation**: Add one or two sentences at the start of the Technical Plan stating the adopted stack (Cloudflare Workers + D1, TypeScript/Hono, per Alternatives J/K/L), so later forward references in Open Questions and NFRs aren't the reader's first exposure to it.

### Document lacks a dedicated "Risks & Mitigations" section required by the standard; related content is scattered across three sections - Severity: Major
* **Reviewer Lens:** `egm-structural`
* **Affected Scope:** Whole-scope absence; related content at lines 595-601 (Non-Functional Requirements), 314-339 (Reliability: Gmail capture health alert), 108-143 (Open Questions)
* **Discrepancy Description**: The standard requires the spec to explicitly call out constraints, failure modes, security implications, scalability limits, and mitigations, ideally under one heading. This document has no "Risks & Mitigations" heading; security notes live in Non-Functional Requirements, the Gmail-failure mode and its mitigation live inside the Technical Plan's Reliability subsection, and several risk-adjacent items (parser breakage, OAuth lifecycle, D1 query limits) are filed as unresolved Open Questions rather than named risks with mitigations.
* **Rationale & Recommendation**: Consolidate or cross-link these into a clearly named Risks & Mitigations section (or subsection) so a reader can find the full risk picture in one place, per the standard's stated goal that a fresh reader can confirm all major risks have been addressed.

### D1 query feasibility risk for dedup/trends queries is identified but never mitigated - Severity: Major
* **Reviewer Lens:** `egm-design`
* **Affected Scope:** Lines 141-143, 584-589, 602-608
* **Discrepancy Description**: The design admits D1's SQLite dialect "may not support every SQL feature the dedup/trends queries eventually need" (line 586-588) and records this only as an Open Question ("not yet verified against real query shapes," 141-143), with no mitigation path. The NFR Performance & Latency section, the natural home for this, does not mention it at all.
* **Rationale & Recommendation**: This is a load-bearing architectural decision (D1 chosen specifically to avoid external provisioning cost) left with an open feasibility question and no fallback plan. Add a mitigation — e.g., a pre-build spike validating the actual query shapes, with an explicit fallback to Hyperdrive/Postgres (Alternative L) if D1 proves insufficient. Related to the missing Risks & Mitigations section above but distinct: this is a specific unmitigated risk, not just a missing heading.

### Open Question "Rationale for NayaPay-only scoping" contradicts rationale already stated elsewhere in the document - Severity: Major
* **Reviewer Lens:** `egm-design`
* **Affected Scope:** Lines 135-137 vs. 24-28, 79-81
* **Discrepancy Description**: Lines 135-137 claim the NayaPay-only rationale is "not yet written down anywhere user-facing," but the Problem section (24-28) and Non-Goals (79-81) already state it clearly and twice. This looks like a stale brainstorm-history carryover never reconciled against the drafted text, and will mislead an implementer into thinking something is missing that the document already answers.
* **Rationale & Recommendation**: Delete this Open Question, or reword it to name what additional rationale (if any) is actually still missing.

### Quarantine/pending_review resolution workflow is referenced repeatedly but never specified, and is absent from Open Questions - Severity: Major
* **Reviewer Lens:** `egm-design`
* **Affected Scope:** Lines 176, 273, 288-292, 387-390
* **Discrepancy Description**: "Resolving" a quarantined (`pending_review`) record is load-bearing — referenced in both capture-path descriptions, the de-duplication section, and the data-flow diagram — but no Goal, CUJ, or Technical Plan subsection defines what resolution consists of (approve as-is? edit fields then commit? reject/discard?). It is also missing from Open Questions, even though that section catalogs comparably-undefined UX surfaces (e.g., "UX for the 'log a missed transaction' action," lines 138-140).
* **Rationale & Recommendation**: Add a CUJ for resolving a quarantined/low-confidence parse, or add an explicit Open Questions entry naming this gap, consistent with how the rest of the document treats similarly undefined UX.

### Feature name is inconsistent: "log a transaction we missed" vs. "log a missed transaction" - Severity: Major
* **Reviewer Lens:** `egm-style`
* **Affected Scope:** Line 56 vs. lines 138, 174, 275, 527, 620
* **Discrepancy Description**: The Goals section (line 56) uses "log a transaction we missed," while every other reference to the same feature (Open Questions, CUJ 3, Technical Plan heading, Alternative H, Future Improvements) uses "log a missed transaction."
* **Rationale & Recommendation**: Standardize on "log a missed transaction" (the majority form used across Goals, Open Questions, CUJs, Technical Plan, and Alternatives) and fix line 56.

### Hard-to-parse run-on sentence with nested em-dash interruptions - Severity: Major
* **Reviewer Lens:** `egm-style`
* **Affected Scope:** Lines 40-44
* **Discrepancy Description**: "They are included because the user was explicitly offered the option to defer them to a later release during brainstorming — specifically to reduce the amount of new surface area to build and test before the app could be trusted for daily use — and declined, choosing to carry that risk rather than narrow scope." The double em-dash nesting makes this hard to parse in one pass.
* **Rationale & Recommendation**: Split into two sentences, e.g.: "They are included because the user was explicitly offered the option to defer them to a later release during brainstorming, to reduce the amount of new surface area to build and test before the app could be trusted for daily use. The user declined, choosing to carry that risk rather than narrow scope."

### Inconsistent use of horizontal-rule section dividers between peer H2 sections - Severity: Nit
* **Reviewer Lens:** `egm-structural`
* **Affected Scope:** Lines 7, 21, 48, 75, 108, 145 (no divider) vs. 197, 412, 591, 615, 631 (divider present)
* **Discrepancy Description**: Dividers appear before some top-level H2 sections (Technical Plan, Alternatives Considered, Non-Functional Requirements, Future Improvements, and the final close) but not before others (The Problem, Goals, Non-Goals, Open Questions, CUJs), even though these are peer-level sections.
* **Rationale & Recommendation**: Pick one convention — divide every top-level H2 section, or none — and apply it uniformly.

### Goals bullets lack the bold-lead-phrase pattern used in sibling Non-Goals/Open Questions lists - Severity: Nit
* **Reviewer Lens:** `egm-structural`
* **Affected Scope:** Lines 48-73 vs. 77-106 and 110-143
* **Discrepancy Description**: Non-Goals and Open Questions bullets open with a bold lead phrase (e.g., "**Multi-user / family support.**"); Goals bullets, structurally parallel to both, do not.
* **Rationale & Recommendation**: Align formatting across the three sibling lists — add bold leads to Goals, or drop them elsewhere.

### Capture-path subsections use bold run-in pseudo-headings instead of real Markdown headings or a list - Severity: Nit
* **Reviewer Lens:** `egm-structural`
* **Affected Scope:** Lines 239, 270, 275 ("**1. NayaPay Gmail import.**", "**2. Statement import.**", "**3. Log a missed transaction.**")
* **Discrepancy Description**: These three act as de facto sub-headings under H3 "Capture paths" but use bold run-in text rather than true H4 headings or a genuine ordered list — the only place in the document where this substitution occurs at a point that would otherwise support a real heading.
* **Rationale & Recommendation**: Convert to true H4 headings or a genuine Markdown ordered list for consistency with the rest of the document's heading-driven structure.

### Alternatives J/K/L (hosting) are not visually grouped apart from product-level Alternatives A-I - Severity: Nit
* **Reviewer Lens:** `egm-structural`
* **Affected Scope:** Lines 548-589 vs. 416-546
* **Discrepancy Description**: Alternatives A-I evaluate product/feature choices; J-L abruptly shift to hosting/infrastructure decisions under the same flat list, distinguished only by an inline "(hosting)" parenthetical in the heading text.
* **Rationale & Recommendation**: Add an H3-level or bolded lead-in (e.g., "### Infrastructure/Hosting Alternatives") rather than relying on the reader to notice the parenthetical.

### Goals bullet understates the dedup resolution options actually described in the Technical Plan - Severity: Nit
* **Reviewer Lens:** `egm-design`
* **Affected Scope:** Lines 62-64 vs. 296-297
* **Discrepancy Description**: Goals states a binary "which copy to keep" framing; the Technical Plan describes a three-way outcome (keep A, keep B, or confirm both are legitimate separate transactions).
* **Rationale & Recommendation**: Align the Goals wording with the richer behavior in the Technical Plan.

### Dangling-reference risk: citation to `concepts_brief.md` without a location/retention pointer - Severity: Nit
* **Reviewer Lens:** `egm-design`
* **Affected Scope:** Lines 44-46
* **Discrepancy Description**: The design cites `concepts_brief.md` by filename as the record of a scope decision but doesn't state where it lives or whether it's retained alongside this design.
* **Rationale & Recommendation**: Low priority; consider a brief pointer (relative path or "see project history") if this design is expected to stand alone long-term.

### "Value-add features" is an imprecise buzzword inconsistent with the document's dry, factual tone - Severity: Nit
* **Reviewer Lens:** `egm-style`
* **Affected Scope:** Line 39
* **Discrepancy Description**: "Value-add features" reads as business jargon out of step with the rest of the document.
* **Rationale & Recommendation**: Replace with a concrete description, e.g., "features beyond this core problem."

### Redundant near-synonym pairs - Severity: Nit
* **Reviewer Lens:** `egm-style`
* **Affected Scope:** Lines 70-73 ("silent failure" / "quietly"), 45 ("accepted, deliberate"), 104-105 ("known, accepted")
* **Discrepancy Description**: Several phrases stack two words expressing the same concept (e.g., "a silent failure doesn't quietly turn into..."; "an accepted, deliberate product decision"; "a known, accepted limitation").
* **Rationale & Recommendation**: Drop the redundant half of each pair (e.g., "a silent failure doesn't turn into untracked spending"; "a deliberate product decision"; "an accepted limitation").

### Filler word "simply" used without adding information - Severity: Nit
* **Reviewer Lens:** `egm-style`
* **Affected Scope:** Lines 104, 428
* **Discrepancy Description**: "...simply isn't recorded in v1" and "...vendor is simply categorized 'Uncategorized'" — "simply" is pure filler in both cases.
* **Rationale & Recommendation**: Remove "simply" in both instances.

### Undefined acronym "YAGNI" breaks the document's own convention of defining jargon on first use - Severity: Nit
* **Reviewer Lens:** `egm-style`
* **Affected Scope:** Line 429
* **Discrepancy Description**: The document parenthetically defines jargon elsewhere (`pageToken`, `historyId`, `dedup_group_id`, Pyodide) but leaves "YAGNI-compliant" unexplained.
* **Rationale & Recommendation**: Spell it out on first use ("You Aren't Gonna Need It") or rephrase without the acronym.

### Inconsistent notation for the recurring "~100 transactions/month" figure - Severity: Nit
* **Reviewer Lens:** `egm-style`
* **Affected Scope:** Line 12 ("roughly 100 transactions a month") vs. line 421 ("~100/month") vs. other occurrences ("~100 transactions/month" / "~100-transactions/month")
* **Discrepancy Description**: The same recurring figure is phrased at least three different ways across the document.
* **Rationale & Recommendation**: Standardize on one notation and apply it uniformly.

### Awkward passive construction - Severity: Nit
* **Reviewer Lens:** `egm-style`
* **Affected Scope:** Line 16
* **Discrepancy Description**: "Every transaction gets a category assigned automatically, which the user can correct" is indirect/passive.
* **Rationale & Recommendation**: "The app automatically assigns a category to every transaction, which the user can correct."

### Overused "X, not Y" contrastive construction reads as a stylistic tic - Severity: Nit
* **Reviewer Lens:** `egm-style`
* **Affected Scope:** Document-wide pattern; representative examples at lines 36, 46, 84-88, 101, 105-106, 268, 512
* **Discrepancy Description**: The "X, not Y" contrastive phrasing (e.g., "not left implicit," "not scope creep," "not deferred," "not an oversight") recurs well over a dozen times across the document.
* **Rationale & Recommendation**: Individually fine, but the repetition dilutes its own emphasis. Vary the phrasing in a subset of instances.

## Severity Breakdown

* Blocker: 0
* Major: 8 (one of which consolidates two overlapping findings from `egm-design` and `egm-style` on the same underlying stack-disclosure issue)
* Nit: 12

## Deduplication Notes

* The `egm-design` finding "stack never stated in Technical Plan" and the `egm-style` finding "Cloudflare Workers forward reference before architecture is introduced" were merged into a single Major finding, since both point to the same root cause (the adopted hosting stack is disclosed via forward references rather than in the Technical Plan itself).
* The `egm-design` "D1 query risk unmitigated" finding is related to, but kept distinct from, `egm-structural`'s "missing Risks & Mitigations section" finding: the latter is a structural/section-presence gap, the former is a specific unresolved risk that would belong in such a section.
* No other findings overlapped closely enough to merge; all three reviewers' outputs are otherwise reported in full.
