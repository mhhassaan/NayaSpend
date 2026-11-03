import { sql } from "drizzle-orm";
import {
  check,
  integer,
  sqliteTable,
  text,
} from "drizzle-orm/sqlite-core";

// Canonical transaction model (design doc: Technical Plan -> Canonical
// Transaction model). `amount` is an integer in minor units (cents) --
// the CHECK constraint rejects a non-integer value at the DB level, since
// SQLite's dynamic typing won't do it for us.
export const transactions = sqliteTable("transactions", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  amount: integer("amount").notNull(),
  date: text("date").notNull(),
  vendorRaw: text("vendor_raw").notNull(),
  vendorNormalized: text("vendor_normalized").notNull(),
  category: text("category").notNull().default("Uncategorized"),
  // One of: gmail_email | statement_import | manual_missed
  source: text("source").notNull(),
  // JSON-as-text; shape varies by `source`.
  provenance: text("provenance").notNull(),
  // One of: pending_review | committed
  reviewStatus: text("review_status").notNull(),
  dedupGroupId: text("dedup_group_id"),
  // One of: pending | kept | discarded | confirmed_distinct
  dedupResolution: text("dedup_resolution"),
  deletedAt: text("deleted_at"),
  // Idempotency key for gmail_email rows only (SQLite permits multiple
  // NULLs under UNIQUE, so this is safe for other sources). Re-inserting
  // the same Gmail message (e.g. a retried/resumed backfill chunk) is a
  // no-op via onConflictDoNothing rather than a duplicate transaction.
  gmailMessageId: text("gmail_message_id").unique(),
  // Idempotency key for statement_import rows only: "<fileRef>:<rowIndex>".
  // Re-importing the same file (a retried/resumed import, or the user
  // re-uploading the same statement) is a no-op per row via
  // onConflictDoNothing, not a duplicate transaction.
  statementRowKey: text("statement_row_key").unique(),
}, (table) => ({
  amountIsInteger: check(
    "amount_is_integer",
    sql`${table.amount} = CAST(${table.amount} AS INTEGER)`
  ),
}));

export const captureRuns = sqliteTable("capture_runs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  lastAttemptedRun: text("last_attempted_run"),
  lastSuccessfulRun: text("last_successful_run"),
  // One of: success | job_did_not_run | api_call_failed
  runStatus: text("run_status").notNull(),
  // One of: auth_failure | rate_limit | network_timeout | history_expired | unknown
  errorType: text("error_type"),
  backfillPageToken: text("backfill_page_token"),
  // Set once Gmail reports no further backfill pages. Distinguishes
  // "backfill finished" from "backfill never started" -- both would
  // otherwise leave backfillPageToken null, causing a finished backfill
  // to silently restart from page one on the next call.
  backfillCompletedAt: text("backfill_completed_at"),
  pollingHistoryId: text("polling_history_id"),
});

export const gmailCredentials = sqliteTable("gmail_credentials", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  encryptedAccessToken: text("encrypted_access_token").notNull(),
  encryptedRefreshToken: text("encrypted_refresh_token").notNull(),
  expiresAt: text("expires_at").notNull(),
});

export const categoryRules = sqliteTable("category_rules", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  vendorNormalized: text("vendor_normalized").notNull().unique(),
  category: text("category").notNull(),
});

export const budgets = sqliteTable("budgets", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  category: text("category").notNull(),
  limitAmount: integer("limit_amount").notNull(),
  periodType: text("period_type").notNull(),
  lastAlertedThreshold: text("last_alerted_threshold"),
  lastAlertedPeriodStart: text("last_alerted_period_start"),
}, (table) => ({
  limitAmountIsPositiveInteger: check(
    "limit_amount_is_positive_integer",
    sql`${table.limitAmount} = CAST(${table.limitAmount} AS INTEGER) AND ${table.limitAmount} > 0`
  ),
}));

export const bills = sqliteTable("bills", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  vendor: text("vendor").notNull(),
  expectedAmount: integer("expected_amount").notNull(),
  expectedInterval: text("expected_interval").notNull(),
  nextDueDate: text("next_due_date").notNull(),
  lastReminderSentForDueDate: text("last_reminder_sent_for_due_date"),
}, (table) => ({
  expectedAmountIsPositiveInteger: check(
    "expected_amount_is_positive_integer",
    sql`${table.expectedAmount} = CAST(${table.expectedAmount} AS INTEGER) AND ${table.expectedAmount} > 0`
  ),
}));
