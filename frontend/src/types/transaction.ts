import type { TransactionSuggestion } from "../../../shared/categories";
// Mirrors backend/src/db/schema.ts's row shapes field-for-field (camelCase
// property names, string | null for nullable columns). Hand-written, not
// generated -- kept in sync manually when the backend schema changes.

export type Transaction = {
  id: number;
  amount: number;
  date: string;
  vendorRaw: string;
  vendorNormalized: string;
  category: string;
  source: "gmail_email" | "statement_import" | "manual_missed";
  provenance: string;
  reviewStatus: "pending_review" | "committed";
  dedupGroupId: string | null;
  dedupResolution: "pending" | "kept" | "discarded" | "confirmed_distinct" | null;
  deletedAt: string | null;
  gmailMessageId: string | null;
  statementRowKey: string | null;
  suggestion?: TransactionSuggestion | null;
  suggestionStatus?: "pending" | "dismissed" | null;
};

export type Budget = {
  id: number;
  category: string;
  limitAmount: number;
  periodType: string;
  lastAlertedThreshold: string | null;
  lastAlertedPeriodStart: string | null;
};

export type Bill = {
  id: number;
  vendor: string;
  expectedAmount: number;
  expectedInterval: string;
  nextDueDate: string;
  lastReminderSentForDueDate: string | null;
};

export type CaptureRun = {
  id: number;
  lastAttemptedRun: string | null;
  lastSuccessfulRun: string | null;
  runStatus: "success" | "job_did_not_run" | "api_call_failed";
  errorType: "auth_failure" | "rate_limit" | "network_timeout" | "history_expired" | "unknown" | null;
  backfillPageToken: string | null;
  backfillCompletedAt: string | null;
  pollingHistoryId: string | null;
};
