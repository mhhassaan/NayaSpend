# Goldfish Review Report — Stage 8 (Intermediate Zoom Out Review)

**Target:** `D:\projects\alfaaz\docs\designs\personal-spending-tracker.md` (full file, 946 lines as of this read)

**Standard applied:** `resources/document_standards/zoom-out-standard.md`

**Prior stages referenced for context (not re-reviewed):**
- Stage 5 (Initial Zoom Out) — `D:\projects\alfaaz\zoom_out_report.md`
- Stage 6 (Comprehension Test) — `D:\projects\alfaaz\comprehension_report.md`
- Stage 7 (Critic Review) — `D:\projects\alfaaz\critic_report.md`, `D:\projects\alfaaz\goldfish_review_report.md` (19 fixes applied)

## Reviewer Status

| Reviewer | Status |
| --- | --- |
| `egm-zoom-out` | completed |

## Top-Level Verdict (fresh re-check, not a diff review)

**PASS** at the zoom-out / scope-and-simplicity level.

The design still passes the Zoom-Out Standard on a fresh, full top-to-bottom read. "The Problem" (lines 21-46) cleanly separates the two genuine root frictions (forgetting to log, categorization tedium) from four features that go beyond them (trends, budget alerts, bill reminders, dedup/health-alert machinery) and explicitly attributes the extra scope to a documented, knowing user decision (citing `concepts_brief.md`) rather than smuggling it in. That is the correct way to carry forward previously-accepted scope expansion.

Architecture-vs-problem fit: proportionate, but only because of that explicit user buy-in, not because the problem independently demands this much machinery. For a single user logging ~100 transactions/month, the Detailed Implementation Plan still describes two capture adapters, a narrow third capture path, a dedup engine, a rule-based categorization engine, a trends aggregator, budget-alert and bill-reminder triggers, a shared notification engine, and a dedicated watchdog for the capture job's own health — 46 files total. None of this is *new* scope creep (it was already present and already checkpointed at Stage 5), so it is not raised as an actionable finding here, but it is flagged for the orchestrator's continued awareness heading into any later readiness gate: the scope is paid-for, not minimal.

No Blocker or Major findings. Three new Nits surfaced, all localized to edits made during Stage 6/Stage 7.

## Prioritized Findings (Blockers -> Major -> Nits)

### Orphaned "Infrastructure/Hosting Alternatives" lead-in heading - Severity: Nit
* **Reviewer Lens:** `egm-zoom-out`
* **Affected Scope:** Lines 569-571 (`### Infrastructure/Hosting Alternatives` immediately followed by `### Alternative J (hosting): FastAPI + Postgres backend`, no body text between)
* **Discrepancy Description**: Stage 7's fix for the critic's "Alternatives J/K/L not visually grouped" finding gave the new lead-in the *same* heading level (`###`) as the `Alternative X` entries it's meant to introduce, with no content of its own. In a document where heading level otherwise strictly encodes nesting, this lead-in sits at the same rank as its own children, so a heading-level scan (or generated TOC) can't distinguish it from "Alternative J." This defeats the visual grouping the fix was meant to create.
* **Rationale & Recommendation**: Fix applied to the letter of the critic's ask but not its spirit. Either demote the `Alternative J/K/L` entries to H4 under this H3 lead-in, or give the lead-in a one-sentence body so it reads as a real section intro rather than an unlabeled list item.

### Inconsistent treatment of two structurally parallel subsection patterns - Severity: Nit
* **Reviewer Lens:** `egm-zoom-out`
* **Affected Scope:** Lines 249-299 ("Capture paths," three H4 sub-headings at 251/284/291) vs. lines 359-384 ("Trends, budget alerts, and bill reminders," three bold-lead bullets at 368/372/381)
* **Discrepancy Description**: Stage 7 promoted the three capture-path items from bold run-in text to true H4 headings per the critic's request. One H3-section later, "Trends, budget alerts, and bill reminders" has the identical shape — an H3 containing 2-3 named, independently substantial sub-components — but those remain bold-lead bullets, not headings. The same structural pattern now gets two different treatments in the same document.
* **Rationale & Recommendation**: This is a partial fix: it resolved the specific instance the critic flagged without sweeping the rest of the document for the same shape. Promote the Trends/Budget-alerts/Notification-Engine sub-items to H4 as well for consistency, or explicitly note why capture paths warrant headings while these don't.

### Stale overlap between an Open Question and the new Risks & Mitigations entry - Severity: Nit
* **Reviewer Lens:** `egm-zoom-out`
* **Affected Scope:** Lines 128-130 (Open Questions, "OAuth token storage and lifecycle") vs. lines 651-656 (Risks & Mitigations, "OAuth token lifecycle")
* **Discrepancy Description**: Open Questions still frames "what happens when the token expires, and how the user reconnects" as fully undefined. The new Risks & Mitigations bullet now states that the Gmail capture health alert "detects authentication failures within two missed hourly runs and names the specific problem to the user, including when to reconnect" — a partial answer to the exact question Open Questions still lists as fully open. The detection/notification half is now answered; only token-storage mechanics and the reconnect-UX flow remain genuinely open.
* **Rationale & Recommendation**: Neither bullet is individually wrong, but they weren't reconciled when the Risks section was added, leaving a reader who checks Open Questions after Risks & Mitigations with a stale impression of how much is unresolved. Narrow the Open Question to explicitly scope it to "token storage mechanics and reconnect UX flow; detection/notification behavior is covered under Risks & Mitigations." This is the same category of cross-section drift the document already caught once before (the Stage 5→Critic fix removing a stale "NayaPay-only rationale" Open Question); it is recurring at smaller scale with the newest addition.

## Items Explicitly Checked and Cleared (not findings)

* **Risks & Mitigations vs. rest of document**: Not duplication. Four of five bullets (lines 636-666) restate content already in the Technical Plan/Goals/NFRs but each carries an explicit "Mitigation: ... (see X above/below)" cross-reference back to the real mechanism — functioning as a deliberate risk register consolidating a previously scattered picture, which is exactly what the critic's structural finding asked for. The fifth bullet (D1 query feasibility, lines 638-643) adds genuinely new content and closes a previously Major, unmitigated critic finding cleanly, with a consistent forward/backward reference loop to Alternative L and the "D1 query ceiling" Open Question.
* **Goals bold-lead bullets**: Internally consistent. All nine new bold-lead bullets (lines 50-76) use the same short noun-phrase-label shape and match the Non-Goals bullets' bold-period convention. The only inconsistency found is that Open Questions uses bold-lead-then-colon while Goals/Non-Goals use bold-lead-with-period — a pure style nit, better owned by a style/structural reviewer, not a scope or altitude issue.
* **Two prior Stage-5 Nits re-checked for regression**: Both remain fixed. The Detailed Implementation Plan opening (lines 684-697) correctly says "Four specific instances" and enumerates all four; the Reliability section's watchdog justification (lines 344-349) states its "can't report its own absence" reasoning exactly once, with no duplication.

## Overall Coherence Assessment

After two rounds of edits (~20 changes across Stage 6 and Stage 7), the document still reads as a coherent, unified whole rather than a bolted-on patchwork. The new Risks & Mitigations section in particular integrates well as a cross-reference register rather than redundant filler. The seams that do exist are small, localized to the newest edits, and share a common root cause: each Stage 7 fix was verified against the specific finding it answered but not re-swept against the rest of the document for the same pattern recurring elsewhere (heading-level treatment, Open-Questions/Risks overlap). None of these seams rise above Nit severity, and none reopen or contradict a previously-resolved finding.
