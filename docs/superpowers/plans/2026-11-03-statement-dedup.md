# Statement Import (CSV) + Dedup Engine (Phase 3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Parse CSV bank statements into draft transactions, and build the dedup engine that detects when a `gmail_email` transaction and a `statement_import` transaction are the same real-world purchase — the one cross-channel relationship this app has to check. PDF statement parsing (bank-format profiles) is explicitly deferred to a future Phase 4 plan, gated on resolving the spec's open "exact bank formats" question.

**Architecture:** The dedup engine is a single function, `runDedupCheck(db, transactionId)`, called by *every* adapter immediately after it commits a transaction (never run as a batch sweep) — this matches the spec's own trigger rule ("runs whenever a `gmail_email` or `statement_import` transaction becomes committed"). It queries committed transactions from the *other* source within a date window, then scores amount-equality and vendor similarity in JS over that small candidate set (not in SQL), consistent with the Phase 0-1 D1 feasibility spike's conclusion.

**Tech Stack:** TypeScript on Cloudflare Workers, Cloudflare D1 via Drizzle ORM, `papaparse` for CSV parsing. No external fuzzy-matching library (see Plan-Level Rulings below).

**Spec:** `docs/designs/personal-spending-tracker.md` — Technical Plan → Capture paths → "2. Statement import" and De-duplication; Canonical Transaction model (`dedup_group_id`, `dedup_resolution`); CUJ 2 (ongoing capture with a duplicate from a statement import); Detailed Implementation Plan items 8 (CSV portion), 12, 27, 30 (CSV portion); Risks & Mitigations → "Cross-channel de-duplication edge cases"; Open Questions → "De-duplication matching rule specifics", "Exact bank statement formats in scope".

## Plan-Level Rulings

- **`string-similarity` is not used.** The spec names it for "Jaro-Winkler vendor fuzzy-matching," but the package actually implements the Sørensen-Dice coefficient and is deprecated/archived on npm (found during the Phase 0-1 review). Rather than depend on a deprecated, misnamed package, this plan implements a small self-contained bigram Dice-coefficient function (`backend/src/utils/stringSimilarity.ts`) — the same algorithm the spec's chosen package actually runs, with no supply-chain dependency. **Flagging to the human partner:** `docs/designs/personal-spending-tracker.md` item 2 and the Alternatives section should be corrected to describe Dice, not Jaro-Winkler, or a real Jaro-Winkler implementation substituted if that algorithm was specifically wanted.
- **Exact bank CSV column layout is an open question** (spec: "exact bank statement formats in scope" is unresolved). This plan implements parsing against a provisional generic layout (columns recognizable as a date, a description/vendor, and an amount, under common header spellings) and quarantines (`pending_review`) anything that doesn't match recognizable columns — mirroring the Gmail adapter's confidence-scored fallback pattern. Real statement samples should be used to validate/extend this before relying on it for a real statement.
- **Date-proximity tolerance and vendor-similarity threshold are open questions** (spec: "De-duplication matching rule specifics"). This plan uses ±3 days and a Dice-coefficient threshold of 0.5 as documented, provisional defaults — both are named constants, trivially tunable once real data exists to validate them against.
- **Wiring dedup into the Gmail adapter.** Phase 2's `gmailAdapter.ts` committed transactions without calling a dedup check (the engine didn't exist yet). This plan adds that call retroactively — per the spec, the trigger is "whenever a `gmail_email` *or* `statement_import` transaction becomes committed," not just the newer channel.

## Global Constraints

- The dedup engine compares **only** committed transactions against other **committed** transactions of the *other* source — a `pending_review` row is never compared until it is itself committed (no mechanism to commit a quarantined row exists yet; this plan only guarantees the engine itself honors the rule when called).
- `manual_missed` transactions are never passed to the dedup engine at all.
- A match sets a **shared** `dedup_group_id` (same value) on both rows and `dedup_resolution: "pending"` on both — never on only one side.
- Amount comparison is **exact** integer-cents equality — no tolerance, since both channels should record the identical real amount.
- CSV parsing must never store a non-integer `amount` — convert decimal currency notation to integer cents, matching the canonical schema's constraint.
- A statement CSV row that can't be confidently parsed is quarantined (`pending_review`), never silently dropped and never thrown away.
- `transactions.source` for every row the statement adapter writes is the literal string `"statement_import"`, with `provenance: { fileRef, rowIndex }`.

## Review Focus

- **A true cross-channel duplicate** (same date/amount, vendor names that are superficially different spellings of the same merchant, e.g. "STARBUCKS #4521" vs "Starbucks Coffee") must be detected and flagged with a shared `dedup_group_id`. → test in Task 2.
- **A near-miss that is NOT a duplicate** (same day, similar amount, unrelated vendor; or same vendor, different day outside the tolerance window) must NOT be flagged — a dedup engine that over-matches is as harmful as one that under-matches (users would have to un-merge legitimate separate purchases). → test in Task 2.
- **A backfill-scale statement import** (many rows) must run dedup comparisons without exceeding a single Worker invocation's bounded execution time — chunked, like the Gmail backfill. → test in Task 2.
- **A CSV with an unrecognized column layout** must quarantine every row from that file rather than guessing wrong silently (e.g. parsing a "Balance" column as "Amount"). → test in Task 1.
- **A CSV amount in parentheses or with a leading minus sign** (common for debits/refunds, e.g. "(50.00)" or "-50.00") must parse to a sensible signed integer-cents value, not crash or silently become positive. → test in Task 1.

---

### Task 1: CSV statement adapter

**Files:**
- Create: `backend/src/adapters/statementAdapter.ts` (spec item 8, CSV portion)
- Create: `backend/test/fixtures/sampleStatements.ts`
- Test: `backend/test/statementAdapter.test.ts` (spec item 30, CSV portion)

**Interfaces:**
- Consumes: `categorize` and `normalize` (`categorizationEngine.ts`, Phase 0-1), the `transactions` table (schema, Phase 0-1).
- Produces: `parseStatementCsv(csvText: string, fileRef: string): ParsedCsvRow[]`, where `ParsedCsvRow = { rowIndex: number } & ({ confidence: "high"; amountCents: number; date: string; vendorRaw: string } | { confidence: "low"; reason: string })`, and `importStatementCsv(db: DrizzleD1Database, csvText: string, fileRef: string): Promise<{ imported: number }>` which parses and writes every row (high-confidence as `committed`, low-confidence as `pending_review`) — mirroring `runBackfill`'s shape from the Phase 2 plan. Task 3 (wiring dedup) consumes `importStatementCsv` by name.

- [ ] **Step 1: Write fixtures in `backend/test/fixtures/sampleStatements.ts`**

Export CSV text constants: `cleanCsv` (headers `Date,Description,Amount`, 2-3 clean rows including one negative/parenthesized amount e.g. `"(50.00)"` for a refund), `unrecognizedColumnsCsv` (headers like `TxnDate,Memo,Balance` with no recognizable amount column), and `mixedCsv` (one clean row, one row with a non-numeric amount field, to prove per-row quarantine rather than whole-file failure).

- [ ] **Step 2: Write the failing test**

```typescript
import { env } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { describe, expect, test } from "vitest";
import { transactions } from "../src/db/schema";
import { importStatementCsv, parseStatementCsv } from "../src/adapters/statementAdapter";
import { cleanCsv, mixedCsv, unrecognizedColumnsCsv } from "./fixtures/sampleStatements";

describe("parseStatementCsv", () => {
  test("parses clean rows including a parenthesized negative amount", () => {
    const rows = parseStatementCsv(cleanCsv, "file-1");
    const refundRow = rows.find((r) => r.confidence === "high" && r.amountCents < 0);
    expect(refundRow).toBeDefined();
  });

  test("a CSV with no recognizable amount column quarantines every row", () => {
    const rows = parseStatementCsv(unrecognizedColumnsCsv, "file-2");
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.confidence === "low")).toBe(true);
  });

  test("one bad row in an otherwise-clean file quarantines only that row", () => {
    const rows = parseStatementCsv(mixedCsv, "file-3");
    expect(rows.some((r) => r.confidence === "high")).toBe(true);
    expect(rows.some((r) => r.confidence === "low")).toBe(true);
  });
});

describe("importStatementCsv", () => {
  test("writes high-confidence rows as committed statement_import transactions", async () => {
    const db = drizzle(env.DB);
    const result = await importStatementCsv(db, cleanCsv, "file-1");
    expect(result.imported).toBeGreaterThan(0);
    const rows = await db.select().from(transactions);
    expect(rows.every((r) => r.source === "statement_import")).toBe(true);
    expect(rows.some((r) => r.reviewStatus === "committed")).toBe(true);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd backend && npm run test -- statementAdapter`
Expected: FAIL with "Cannot find module '../src/adapters/statementAdapter'".

- [ ] **Step 4: Implement `backend/src/adapters/statementAdapter.ts`**

Use `papaparse`'s `parse(csvText, { header: true, skipEmptyLines: true })`. Recognize a date column by header name matching `/date/i`, a vendor/description column matching `/desc|memo|vendor|merchant/i`, and an amount column matching `/amount|debit|credit/i`; if any of the three can't be found among the headers, return every row as `confidence: "low", reason: "unrecognized columns"`. For a recognized amount cell: strip `$`/`Rs`/`PKR`/commas, treat a value wrapped in parentheses or prefixed with `-` as negative, parse as float, multiply by 100 and round to integer cents (never leave as float) — on a non-numeric cell, quarantine that row only (`reason: "unparseable amount"`), not the whole file. `importStatementCsv` calls `parseStatementCsv`, then for each row: high-confidence → `categorize` + insert `committed`; low-confidence → insert `pending_review` with the reason in `provenance`. Every row's `provenance` is `JSON.stringify({ fileRef, rowIndex, ...(reason ? { quarantineReason: reason } : {}) })`.

- [ ] **Step 5: Run test to verify it passes**

Run: `cd backend && npm run test -- statementAdapter`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/src/adapters/statementAdapter.ts backend/test/fixtures/sampleStatements.ts backend/test/statementAdapter.test.ts
git commit -m "feat: add CSV statement adapter with per-row quarantine"
```

---

### Task 2: Dedup engine

**Files:**
- Create: `backend/src/utils/stringSimilarity.ts`
- Create: `backend/src/services/dedupEngine.ts` (spec item 12)
- Test: `backend/test/dedupEngine.test.ts` (spec item 27)

**Interfaces:**
- Consumes: the `transactions` table (schema, Phase 0-1).
- Produces: `diceCoefficient(a: string, b: string): number` (0-1, bigram-based) from `stringSimilarity.ts`. Produces `runDedupCheck(db: DrizzleD1Database, transactionId: number): Promise<{ matched: boolean; dedupGroupId: string | null }>` from `dedupEngine.ts`. Task 3 consumes `runDedupCheck` by this exact name and signature.

- [ ] **Step 1: Write the failing test**

```typescript
import { env } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";
import { describe, expect, test } from "vitest";
import { transactions } from "../src/db/schema";
import { runDedupCheck } from "../src/services/dedupEngine";
import { diceCoefficient } from "../src/utils/stringSimilarity";

describe("diceCoefficient", () => {
  test("near-identical vendor spellings score highly", () => {
    expect(diceCoefficient("starbucks #4521", "starbucks coffee")).toBeGreaterThan(0.5);
  });

  test("unrelated strings score low", () => {
    expect(diceCoefficient("starbucks", "electric company")).toBeLessThan(0.3);
  });
});

describe("runDedupCheck", () => {
  test("flags a true cross-channel duplicate (same date, same amount, similar vendor)", async () => {
    const db = drizzle(env.DB);
    const [emailTx] = await db
      .insert(transactions)
      .values({ amount: 125000, date: "2026-10-27", vendorRaw: "STARBUCKS #4521", vendorNormalized: "starbucks #4521", category: "Coffee", source: "gmail_email", provenance: "{}", reviewStatus: "committed" })
      .returning();
    const [stmtTx] = await db
      .insert(transactions)
      .values({ amount: 125000, date: "2026-10-27", vendorRaw: "Starbucks Coffee", vendorNormalized: "starbucks coffee", category: "Coffee", source: "statement_import", provenance: "{}", reviewStatus: "committed" })
      .returning();

    const result = await runDedupCheck(db, stmtTx.id);

    expect(result.matched).toBe(true);
    const [refreshedEmail] = await db.select().from(transactions).where(eq(transactions.id, emailTx.id));
    const [refreshedStmt] = await db.select().from(transactions).where(eq(transactions.id, stmtTx.id));
    expect(refreshedEmail.dedupGroupId).toBe(refreshedStmt.dedupGroupId);
    expect(refreshedEmail.dedupResolution).toBe("pending");
    expect(refreshedStmt.dedupResolution).toBe("pending");
  });

  test("does NOT flag a same-day, similar-amount, unrelated vendor as a duplicate", async () => {
    const db = drizzle(env.DB);
    await db.insert(transactions).values({ amount: 125000, date: "2026-10-27", vendorRaw: "Starbucks", vendorNormalized: "starbucks", category: "Coffee", source: "gmail_email", provenance: "{}", reviewStatus: "committed" });
    const [stmtTx] = await db
      .insert(transactions)
      .values({ amount: 125000, date: "2026-10-27", vendorRaw: "Electric Company", vendorNormalized: "electric company", category: "Utilities", source: "statement_import", provenance: "{}", reviewStatus: "committed" })
      .returning();

    const result = await runDedupCheck(db, stmtTx.id);

    expect(result.matched).toBe(false);
  });

  test("does NOT flag the same vendor/amount outside the date-proximity window", async () => {
    const db = drizzle(env.DB);
    await db.insert(transactions).values({ amount: 125000, date: "2026-10-01", vendorRaw: "Starbucks", vendorNormalized: "starbucks", category: "Coffee", source: "gmail_email", provenance: "{}", reviewStatus: "committed" });
    const [stmtTx] = await db
      .insert(transactions)
      .values({ amount: 125000, date: "2026-10-27", vendorRaw: "Starbucks", vendorNormalized: "starbucks", category: "Coffee", source: "statement_import", provenance: "{}", reviewStatus: "committed" })
      .returning();

    const result = await runDedupCheck(db, stmtTx.id);

    expect(result.matched).toBe(false);
  });

  test("never compares against pending_review rows", async () => {
    const db = drizzle(env.DB);
    await db.insert(transactions).values({ amount: 125000, date: "2026-10-27", vendorRaw: "Starbucks", vendorNormalized: "starbucks", category: "Coffee", source: "gmail_email", provenance: "{}", reviewStatus: "pending_review" });
    const [stmtTx] = await db
      .insert(transactions)
      .values({ amount: 125000, date: "2026-10-27", vendorRaw: "Starbucks", vendorNormalized: "starbucks", category: "Coffee", source: "statement_import", provenance: "{}", reviewStatus: "committed" })
      .returning();

    const result = await runDedupCheck(db, stmtTx.id);

    expect(result.matched).toBe(false);
  });

  test("a manual_missed transaction is never compared against anything", async () => {
    const db = drizzle(env.DB);
    await db.insert(transactions).values({ amount: 125000, date: "2026-10-27", vendorRaw: "Starbucks", vendorNormalized: "starbucks", category: "Coffee", source: "gmail_email", provenance: "{}", reviewStatus: "committed" });
    const [manualTx] = await db
      .insert(transactions)
      .values({ amount: 125000, date: "2026-10-27", vendorRaw: "Starbucks", vendorNormalized: "starbucks", category: "Coffee", source: "manual_missed", provenance: "{}", reviewStatus: "committed" })
      .returning();

    const result = await runDedupCheck(db, manualTx.id);

    expect(result.matched).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npm run test -- dedupEngine`
Expected: FAIL with "Cannot find module '../src/services/dedupEngine'" (and `'../src/utils/stringSimilarity'`).

- [ ] **Step 3: Implement `backend/src/utils/stringSimilarity.ts`**

`diceCoefficient(a, b)`: lowercase both, build the set of adjacent character bigrams for each string, compute `2 * |intersection| / (|bigramsA| + |bigramsB|)`. Handle strings shorter than 2 characters as a special case (fall back to exact-match 1.0/0.0) to avoid a division-by-zero or empty-bigram-set edge case.

- [ ] **Step 4: Implement `runDedupCheck` in `backend/src/services/dedupEngine.ts`**

Look up the transaction by `transactionId`. If its `reviewStatus !== "committed"` or `source === "manual_missed"`, return `{ matched: false, dedupGroupId: null }` immediately. Otherwise, determine the "other source" (`gmail_email` ↔ `statement_import`), and query committed transactions of that other source within `DATE_TOLERANCE_DAYS = 3` of this transaction's `date` (string-compare ISO dates with simple day-difference arithmetic, or a D1 date-range query per the Phase 0-1 spike's proven shape) with the exact same `amount`. For each candidate, compute `diceCoefficient(vendorNormalized, candidate.vendorNormalized)`; the first candidate at or above `VENDOR_SIMILARITY_THRESHOLD = 0.5` is a match. On a match: generate a `dedupGroupId` (e.g. `crypto.randomUUID()`), `UPDATE` both rows' `dedupGroupId` and `dedupResolution: "pending"`. Chunk the candidate query (bounded `LIMIT`) to stay within Worker execution-time limits for backfill-scale data.

- [ ] **Step 5: Run test to verify it passes**

Run: `cd backend && npm run test -- dedupEngine`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/src/utils/stringSimilarity.ts backend/src/services/dedupEngine.ts backend/test/dedupEngine.test.ts
git commit -m "feat: add dedup engine with bigram vendor similarity"
```

---

### Task 3: Wire dedup check into both adapters

**Files:**
- Modify: `backend/src/adapters/gmailAdapter.ts`
- Modify: `backend/src/adapters/statementAdapter.ts`
- Modify: `backend/test/gmailAdapter.test.ts`
- Modify: `backend/test/statementAdapter.test.ts`

**Interfaces:**
- Consumes: `runDedupCheck` (Task 2).
- Produces: no new exports — both adapters' existing committed-insert paths now also call `runDedupCheck` for the just-inserted row's id.

- [ ] **Step 1: Write the failing test (add to `backend/test/gmailAdapter.test.ts`)**

```typescript
test("a committed Gmail transaction is dedup-checked against an existing statement_import transaction", async () => {
  const db = drizzle(env.DB);
  await db.insert(transactions).values({ amount: 125000, date: "2026-10-27", vendorRaw: "Starbucks Coffee", vendorNormalized: "starbucks coffee", category: "Coffee", source: "statement_import", provenance: "{}", reviewStatus: "committed" });

  const client = fakeClient(
    { first: [{ id: "m-clean" }] },
    { "m-clean": { ...cleanTransactionEmail, bodyText: "You spent Rs. 1,250.00 at Starbucks on 2026-10-27." } },
    { first: undefined }
  );
  await runBackfill(db, client);

  const rows = await db.select().from(transactions).where(eq(transactions.source, "gmail_email"));
  expect(rows[0].dedupGroupId).not.toBeNull();
});
```

- [ ] **Step 2: Add the equivalent test to `backend/test/statementAdapter.test.ts`** (a committed CSV row dedup-checked against an existing `gmail_email` row), mirroring the shape above with `importStatementCsv`.

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd backend && npm run test -- gmailAdapter statementAdapter`
Expected: FAIL — both new assertions see `dedupGroupId` as `null` (no dedup call wired in yet).

- [ ] **Step 4: Wire `runDedupCheck` into both adapters**

In `gmailAdapter.ts`'s `runBackfill`, after inserting a `committed` row, call `await runDedupCheck(db, insertedRow.id)` (Drizzle's `.insert(...).values(...).returning()` to get the new row's id). Do the same in `statementAdapter.ts`'s `importStatementCsv` for its committed inserts. Quarantined (`pending_review`) inserts in both adapters are never passed to `runDedupCheck`.

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd backend && npm run test -- gmailAdapter statementAdapter`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/src/adapters/gmailAdapter.ts backend/src/adapters/statementAdapter.ts backend/test/gmailAdapter.test.ts backend/test/statementAdapter.test.ts
git commit -m "feat: wire dedup check into Gmail and statement adapters"
```

---

## Self-Review Notes

- **Spec coverage**: item 8 CSV portion + item 30 CSV portion (Task 1), item 12 + item 27 (Task 2). Task 3 is this plan's own addition to satisfy the spec's "whenever ... becomes committed" trigger rule for both channels, including retroactively wiring Phase 2's Gmail adapter.
- **Review Focus**: true duplicate detection, near-miss non-detection, chunked batch comparison, unrecognized-CSV-column quarantine, and signed/parenthesized amount parsing each have an owning test (Tasks 1-2).
- **Type consistency**: `ParsedCsvRow`'s shape (Task 1) mirrors Phase 2's `ParsedEmailResult` pattern; `runDedupCheck`'s signature (Task 2) is consumed verbatim by Task 3's adapter wiring.
- **Proportion check**: three tasks — one per new file pair, plus one cross-cutting wiring task that both prior tasks' interfaces anticipated.
