import { useEffect, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { apiClient } from "../api/client";
import { Button, Card, EmptyState, Pill, showError, showSuccess } from "../components";

type CaptureHealthData = {
  runStatus: "success" | "job_did_not_run" | "api_call_failed";
  lastAttemptedRun: string | null;
  lastSuccessfulRun: string | null;
  errorType: "auth_failure" | "rate_limit" | "network_timeout" | "history_expired" | "unknown" | null;
};

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
      <div className="flex items-center gap-3">
        <Pill tone="warning">Needs reconnect</Pill>
        <a href="/api/auth/gmail/reconnect" className="font-body text-[13px] font-semibold text-blackberry underline">
          Reconnect
        </a>
      </div>
    );
  }

  if (health.runStatus === "job_did_not_run" && !health.lastAttemptedRun && !health.lastSuccessfulRun) {
    return (
      <EmptyState
        message="Gmail not connected yet."
        actionLabel="Connect Gmail"
        onAction={() => {
          window.location.href = "/api/auth/gmail/connect";
        }}
      />
    );
  }

  return <Pill tone="warning">{namedFailureReason(health.errorType)}</Pill>;
}

export function CaptureHealth() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [backfillResult, setBackfillResult] = useState<{ processed: number } | null>(null);

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
      const res = await apiClient.capture.backfill.$post();
      if (!res.ok) throw new Error(`Backfill failed (${res.status})`);
      return (await res.json()) as { processed: number; nextPageToken: string | null };
    },
    onSuccess: (data) => {
      setBackfillResult({ processed: data.processed });
      showSuccess(`Backfill processed ${data.processed} message${data.processed === 1 ? "" : "s"}`);
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

          <div className="flex items-center gap-3">
            <Button variant="secondary" onClick={() => backfillMutation.mutate()}>
              Run backfill now
            </Button>
            {backfillResult && (
              <span className="font-body text-[13px] text-text-secondary">Processed {backfillResult.processed}</span>
            )}
          </div>
        </div>
      </Card>
    </div>
  );
}
