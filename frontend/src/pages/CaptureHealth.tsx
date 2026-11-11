import { CaptureHealthEmptyIllustration } from "../components/illustrations";
import { API_BASE } from "../api/base";
import { useEffect, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { apiClient } from "../api/client";
import { Button, Card, EmptyState, Pill, StatDisplay, showError, showSuccess } from "../components";

import { CheckIcon, SpinnerIcon, WarningIcon } from "../components/icons";
import { useReducedMotion } from "motion/react";

type CaptureHealthData = {
  runStatus: "success" | "job_did_not_run" | "api_call_failed";
  lastAttemptedRun: string | null;
  lastSuccessfulRun: string | null;
  errorType: "auth_failure" | "rate_limit" | "network_timeout" | "history_expired" | "unknown" | null;
};

type BackfillTotals = { processed: number; committed: number; quarantined: number; fetchFailed: number };

function backfillSummary(totals: BackfillTotals): string {
  return `${totals.processed} message${totals.processed === 1 ? "" : "s"} processed, ${totals.committed} added, ${totals.quarantined} need review${totals.fetchFailed > 0 ? `, ${totals.fetchFailed} failed to fetch` : ""}`;
}

// Mirrors the wording the backend's own Watchdog alert uses (watchdog.ts's
// reasonFor) so the page and the alert that led someone here agree on what
// went wrong.
function namedFailureReason(errorType: CaptureHealthData["errorType"]): string {
  switch (errorType) {
    case "rate_limit":
      return "Gmail is rate-limiting requests.";
    case "network_timeout":
      return "Gmail sync is failing due to a network timeout.";
    case "history_expired":
      return "Gmail's email history watermark expired — a full resync is needed.";
    default:
      return "Gmail sync is failing for an unknown reason.";
  }
}

// Each of Task 4's six OAuth-callback reason codes (authGmail.ts), mapped
// to a plain-language sentence for the one-time redirect banner.
const ERROR_REASON_MESSAGES: Record<string, string> = {
  invalid_state: "The connection attempt looked invalid — try reconnecting.",
  missing_code: "Google didn't return an authorization code — try reconnecting.",
  exchange_failed: "Token exchange failed — try reconnecting.",
  missing_access_token: "Google didn't return an access token — try reconnecting.",
  invalid_expiry: "Google returned an invalid token expiry — try reconnecting.",
  missing_refresh_token: "Google didn't grant offline access — try reconnecting.",
};

function StatusSection({ health, justConnected }: { health: CaptureHealthData; justConnected: boolean }) {
  if (health.runStatus === "success") {
    return <Pill tone="success">Connected</Pill>;
  }

  // The OAuth callback (authGmail.ts) redirects here with ?connected=1 the
  // instant the token exchange succeeds -- before the hourly cron has had
  // a chance to run a first sync, so `health` still reads exactly like a
  // fresh, never-connected install. Trust the just-happened redirect over
  // that stale server snapshot instead of showing "not connected yet" and
  // "Gmail connected" in the same breath.
  if (justConnected && health.runStatus === "job_did_not_run") {
    return <Pill tone="success">Connected — first sync pending</Pill>;
  }

  if (health.errorType === "auth_failure") {
    return (
      <div className="flex flex-col items-start gap-4 rounded-lg border border-border bg-silver-frost p-5">
        <Pill>Needs reconnect</Pill>
        <h2 className="font-display text-lg font-semibold">Let's reconnect Gmail.</h2>
        <p className="font-body text-sm">Your Gmail authorization is no longer valid, so email capture is paused. Reconnect with Google to let NayaSpend read transaction emails again.</p>
        <a href={`${API_BASE}/auth/gmail/reconnect`} className="rounded-md bg-blackberry px-6 py-3 font-body text-[13px] font-semibold text-hyper-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-deep-violet focus-visible:outline-offset-4">
          Reconnect
        </a>
        <p className="text-sm text-text-secondary">Google will guide you through confirming access.</p>
        <p className="text-sm text-text-secondary">This affects new email capture. Transactions already added remain in your account.</p>
      </div>
    );
  }

  if (health.runStatus === "job_did_not_run" && !health.lastAttemptedRun && !health.lastSuccessfulRun) {
    return (
      <EmptyState icon={<CaptureHealthEmptyIllustration />}
        message="Gmail not connected yet."
        actionLabel="Connect Gmail"
        onAction={() => {
          window.location.href = `${API_BASE}/auth/gmail/connect`;
        }}
      />
    );
  }

  return <Pill tone="warning">{namedFailureReason(health.errorType)}</Pill>;
}

export function CaptureHealth() {
  const reduceMotion = useReducedMotion();
  const [searchParams, setSearchParams] = useSearchParams();
  const [backfillResult, setBackfillResult] = useState<BackfillTotals | null>(null);

  const connected = searchParams.get("connected") === "1";
  const errorReason = searchParams.get("error");

  const healthQuery = useQuery({
    queryKey: ["capture-health"],
    queryFn: async () => {
      const res = await apiClient.capture.health.$get();
      if (!res.ok) throw new Error(`Failed to load capture health (${res.status})`);
      return (await res.json()) as CaptureHealthData;
    },
  });

  const backfillMutation = useMutation({
    mutationFn: async () => {
      let totals: BackfillTotals = { processed: 0, committed: 0, quarantined: 0, fetchFailed: 0 };
      setBackfillResult(totals);
      let nextPageToken: string | null;
      const seenPageTokens = new Set<string>();
      do {
        // The backend persists the checkpoint; each POST resumes from it.
        const res = await apiClient.capture.backfill.$post();
        if (!res.ok) throw new Error(`Backfill failed (${res.status})`);
        const chunk = (await res.json()) as BackfillTotals & { nextPageToken: string | null };
        // Gmail list failures can return the unchanged checkpoint with HTTP 200.
        if (chunk.nextPageToken !== null) {
          if (seenPageTokens.has(chunk.nextPageToken)) throw new Error("Backfill checkpoint did not advance");
          seenPageTokens.add(chunk.nextPageToken);
        }
        totals = {
          processed: totals.processed + chunk.processed,
          committed: totals.committed + chunk.committed,
          quarantined: totals.quarantined + chunk.quarantined,
          fetchFailed: totals.fetchFailed + chunk.fetchFailed,
        };
        setBackfillResult(totals);
        nextPageToken = chunk.nextPageToken;
      } while (nextPageToken !== null);
      return totals;
    },
    onSuccess: (data) => {
      showSuccess(`Backfill complete: ${backfillSummary(data)}`);
    },
    onError: () => showError("Couldn't run the backfill."),
  });

  useEffect(() => {
    if (healthQuery.isError) showError("Couldn't load Gmail connection status.");
  }, [healthQuery.isError]);

  function dismissRedirectParams() {
    const next = new URLSearchParams(searchParams);
    next.delete("connected");
    next.delete("error");
    setSearchParams(next);
  }

  if (healthQuery.isPending) {
    return (
      <div data-testid="capture-health-skeleton" className="flex flex-col gap-3">
        <div className="h-16 animate-pulse rounded-xl bg-mid-grey" />
      </div>
    );
  }

  if (healthQuery.isError) {
    return (
      <div className="flex flex-col items-center gap-4 p-8 text-center">
        <p className="font-body text-[18px] text-text-secondary">Couldn't load Gmail connection status.</p>
        <button
          type="button"
          className="rounded-md bg-blackberry px-6 py-3 font-body text-[15px] font-semibold text-hyper-white"
          onClick={() => healthQuery.refetch()}
        >
          Retry
        </button>
      </div>
    );
  }

  const health = healthQuery.data!;

  return (
    <div className="flex flex-col gap-4">
      <h1 className="font-body text-[20px] font-semibold">Capture health</h1>

      {connected && (
        <Card>
          <div className="flex items-center justify-between">
            <p className="font-body text-[15px] font-semibold text-success">Gmail connected</p>
            <button type="button" onClick={dismissRedirectParams} className="font-body text-[13px] text-text-secondary">
              Dismiss
            </button>
          </div>
        </Card>
      )}

      {errorReason && (
        <Card>
          <div className="flex items-center justify-between">
            <p className="font-body text-[15px] font-semibold text-danger">
              {ERROR_REASON_MESSAGES[errorReason] ?? "Something went wrong connecting Gmail — try reconnecting."}
            </p>
            <button type="button" onClick={dismissRedirectParams} className="font-body text-[13px] text-text-secondary">
              Dismiss
            </button>
          </div>
        </Card>
      )}

      <Card>
        <div className="flex flex-col gap-4">
          <StatusSection health={health} justConnected={connected} />
          <p className="rounded-lg bg-light-purple p-4 font-body text-sm text-text-secondary">Gmail access is read-only, with your explicit consent, to find and parse transaction emails. NayaSpend cannot send, change or delete email.</p>

          {backfillResult && (
            <Card role="status" aria-label="Backfill progress"
              className={`border ${backfillMutation.isPending ? "border-border" : backfillMutation.isError ? "border-danger" : "border-success"}`}>
              <div className={`mb-4 flex items-center gap-2 ${backfillMutation.isPending ? "text-accent" : backfillMutation.isError ? "text-danger" : "text-success"}`}>
                {backfillMutation.isPending
                  ? <SpinnerIcon data-testid="pending-icon" aria-hidden="true" className={reduceMotion ? "" : "animate-spin"} />
                  : backfillMutation.isError
                    ? <WarningIcon data-testid="error-icon" aria-hidden="true" />
                    : <CheckIcon data-testid="success-icon" aria-hidden="true" />}
                <h2 className="font-display text-[18px] font-bold">
                  {backfillMutation.isPending ? "Scanning your inbox..." : backfillMutation.isError ? "Backfill stopped" : "Backfill complete"}
                </h2>
              </div>
              <div className={`grid grid-cols-3 gap-2 [&>div>div>span:last-child]:text-[24px] ${backfillResult.fetchFailed > 0 ? "sm:grid-cols-4" : ""}`}>
                <div className="min-w-0 rounded-md bg-silver-frost p-3"><StatDisplay label="Scanned" value={String(backfillResult.processed)} /></div>
                <div className="min-w-0 rounded-md bg-silver-frost p-3"><StatDisplay label="Added" value={String(backfillResult.committed)} /></div>
                <div className="min-w-0 rounded-md bg-silver-frost p-3"><StatDisplay label="Needs review" value={String(backfillResult.quarantined)} /></div>
                {backfillResult.fetchFailed > 0 && <div className="min-w-0 rounded-md bg-silver-frost p-3"><StatDisplay label="Failed to fetch" value={String(backfillResult.fetchFailed)} /></div>}
              </div>
            </Card>
          )}
          {!backfillMutation.isPending && (
            <div>
              <Button variant="secondary" onClick={() => backfillMutation.mutate()}>Run backfill now</Button>
            </div>
          )}
        </div>
      </Card>
    </div>
  );
}
