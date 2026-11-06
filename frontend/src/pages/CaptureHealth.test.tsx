import { act, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, test, vi } from "vitest";
import { CaptureHealth } from "./CaptureHealth";
import { renderWithProviders, mockFetch, jsonResponse, urlContains } from "../../test/helpers";
import { showError, showSuccess } from "../components";

vi.mock("../components", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../components")>();
  return { ...actual, showError: vi.fn(), showSuccess: vi.fn() };
});

function healthResponse(overrides: Record<string, unknown>) {
  return { runStatus: "job_did_not_run", lastAttemptedRun: null, lastSuccessfulRun: null, errorType: null, ...overrides };
}


function expectTotals(scanned: number, added: number, review: number, failed = 0) {
  const panel = screen.getByRole("status", { name: "Backfill progress" });
  for (const [label, value] of [["Scanned", scanned], ["Added", added], ["Needs review", review], ...(failed > 0 ? [["Failed to fetch", failed]] : [])] as [string, number][]) {
    const tile = within(panel).getByText(label).parentElement!;
    expect(within(tile).getByText(String(value))).toBeInTheDocument();
  }
  if (failed === 0) expect(within(panel).queryByText("Failed to fetch")).not.toBeInTheDocument();
}

describe("CaptureHealth", () => {
  test("reassures users that Gmail access is read-only", async () => {
    mockFetch([{ test: urlContains("/api/capture/health", "GET"), respond: () => jsonResponse(healthResponse({ runStatus: "success" })) }]);
    renderWithProviders(<CaptureHealth />);
    expect(await screen.findByText(/Gmail access is read-only/)).toBeVisible();
    expect(screen.getByText(/NayaSpend cannot send, change or delete email/)).toBeVisible();
  });

  test("explains paused capture and reassures existing data is safe before reconnecting", async () => {
    mockFetch([{ test: urlContains("/api/capture/health", "GET"), respond: () => jsonResponse(healthResponse({ runStatus: "api_call_failed", errorType: "auth_failure" })) }]);
    renderWithProviders(<CaptureHealth />);
    expect(await screen.findByRole("heading", { name: "Let's reconnect Gmail." })).toBeVisible();
    expect(screen.getByText(/authorization is no longer valid, so email capture is paused/)).toBeVisible();
    expect(screen.getByText(/Transactions already added remain in your account/)).toBeVisible();
    expect(screen.getByRole("link", { name: /reconnect/i })).toHaveAttribute("href", "/api/auth/gmail/reconnect");
  });
  test("shows a 'Connected' status Pill when runStatus is success", async () => {
    mockFetch([
      {
        test: urlContains("/api/capture/health", "GET"),
        respond: () => jsonResponse(healthResponse({ runStatus: "success", lastAttemptedRun: "2026-11-01T00:00:00Z", lastSuccessfulRun: "2026-11-01T00:00:00Z" })),
      },
    ]);
    renderWithProviders(<CaptureHealth />);
    expect(await screen.findByText(/connected/i)).toBeInTheDocument();
  });

  test("shows a 'Needs reconnect' status and a reconnect link when errorType is auth_failure", async () => {
    mockFetch([
      {
        test: urlContains("/api/capture/health", "GET"),
        respond: () =>
          jsonResponse(healthResponse({ runStatus: "api_call_failed", lastAttemptedRun: "2026-11-01T00:00:00Z", lastSuccessfulRun: null, errorType: "auth_failure" })),
      },
    ]);
    renderWithProviders(<CaptureHealth />);
    expect(await screen.findByText(/needs reconnect/i)).toBeInTheDocument();
    const link = screen.getByRole("link", { name: /reconnect/i });
    expect(link).toHaveAttribute("href", "/api/auth/gmail/reconnect");
  });

  test("shows a never-run empty state for a fresh install", async () => {
    mockFetch([{ test: urlContains("/api/capture/health", "GET"), respond: () => jsonResponse(healthResponse({})) }]);
    renderWithProviders(<CaptureHealth />);
    expect(await screen.findByText(/never run|not connected yet/i)).toBeInTheDocument();
  });

  test("[Review Focus] landing with ?connected=1 shows a one-time success banner", async () => {
    mockFetch([{ test: urlContains("/api/capture/health", "GET"), respond: () => jsonResponse(healthResponse({})) }]);
    renderWithProviders(<CaptureHealth />, { initialEntries: ["/capture-health?connected=1"] });
    expect(await screen.findByText(/gmail connected/i)).toBeInTheDocument();
  });

  test("[Review Focus] landing with ?connected=1 does not also show the stale 'not connected yet' state", async () => {
    mockFetch([{ test: urlContains("/api/capture/health", "GET"), respond: () => jsonResponse(healthResponse({})) }]);
    renderWithProviders(<CaptureHealth />, { initialEntries: ["/capture-health?connected=1"] });
    await screen.findByText(/gmail connected/i);
    expect(screen.queryByText(/not connected yet/i)).not.toBeInTheDocument();
    expect(screen.getByText(/first sync pending/i)).toBeInTheDocument();
  });

  test("[Review Focus] landing with ?error=exchange_failed shows the specific named failure, not a generic message", async () => {
    mockFetch([{ test: urlContains("/api/capture/health", "GET"), respond: () => jsonResponse(healthResponse({})) }]);
    renderWithProviders(<CaptureHealth />, { initialEntries: ["/capture-health?error=exchange_failed"] });
    expect(await screen.findByText(/token exchange failed/i)).toBeInTheDocument();
  });

  test("[break-ui] an unmapped errorType falls back to a generic message instead of rendering undefined", async () => {
    mockFetch([
      {
        test: urlContains("/api/capture/health", "GET"),
        respond: () =>
          jsonResponse(
            healthResponse({ runStatus: "api_call_failed", lastAttemptedRun: "2026-11-01T00:00:00Z", lastSuccessfulRun: null, errorType: "some_future_error_type" })
          ),
      },
    ]);
    renderWithProviders(<CaptureHealth />);
    expect(await screen.findByText(/gmail sync is failing/i)).toBeInTheDocument();
    expect(screen.queryByText(/undefined/i)).not.toBeInTheDocument();
  });

  test("[Review Focus] a failed page load shows the error block and toasts once", async () => {
    mockFetch([{ test: urlContains("/api/capture/health", "GET"), respond: () => new Response("fail", { status: 500 }) }]);
    renderWithProviders(<CaptureHealth />);
    expect(await screen.findByRole("button", { name: /retry/i })).toBeInTheDocument();
    await vi.waitFor(() => expect(showError).toHaveBeenCalledOnce());
  });

  test("a manual backfill trigger calls the backfill endpoint and toasts its result", async () => {
    mockFetch([
      {
        test: urlContains("/api/capture/health", "GET"),
        respond: () => jsonResponse(healthResponse({ runStatus: "success", lastAttemptedRun: "2026-11-01T00:00:00Z", lastSuccessfulRun: "2026-11-01T00:00:00Z" })),
      },
      { test: urlContains("/api/capture/backfill", "POST"), respond: () => jsonResponse({ processed: 3, committed: 1, quarantined: 2, fetchFailed: 0, nextPageToken: null }) },
    ]);
    renderWithProviders(<CaptureHealth />);
    await userEvent.click(await screen.findByRole("button", { name: /run backfill now/i }));
    const summary = "Backfill complete: 3 messages processed, 1 added, 2 need review";
    expect(await screen.findByRole("heading", { name: "Backfill complete" })).toBeInTheDocument();
    expect(screen.getByTestId("success-icon")).toBeInTheDocument();
    expectTotals(3, 1, 2);
    await vi.waitFor(() => expect(showSuccess).toHaveBeenCalledWith(summary));
  });

  test("[Review Focus] a multi-chunk backfill shows live running totals across chunks and a grand-total summary at the end", async () => {
    let resolveFirst!: (response: Response) => void;
    let resolveSecond!: (response: Response) => void;
    const first = new Promise<Response>((resolve) => { resolveFirst = resolve; });
    const second = new Promise<Response>((resolve) => { resolveSecond = resolve; });
    let chunks = 0;
    const spy = mockFetch([
      { test: urlContains("/api/capture/health", "GET"), respond: () => jsonResponse(healthResponse({ runStatus: "success" })) },
      { test: urlContains("/api/capture/backfill", "POST"), respond: () => ++chunks === 1 ? first : second },
    ]);
    renderWithProviders(<CaptureHealth />);
    const button = await screen.findByRole("button", { name: /run backfill now/i });
    await userEvent.click(button);
    expect(await screen.findByRole("heading", { name: "Scanning your inbox..." })).toBeInTheDocument();
    expect(screen.getByTestId("pending-icon")).toHaveClass("animate-spin");
    expectTotals(0, 0, 0);
    expect(screen.queryByRole("button", { name: /run backfill now/i })).not.toBeInTheDocument();

    await act(async () => {
      resolveFirst(jsonResponse({ processed: 5, committed: 2, quarantined: 3, fetchFailed: 1, nextPageToken: "page2" }));
    });
    await vi.waitFor(() => expectTotals(5, 2, 3, 1));
    expect(screen.getByTestId("pending-icon")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /run backfill now/i })).not.toBeInTheDocument();
    expect(showSuccess).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(spy.mock.calls.filter(([url]) => String(url).includes("/api/capture/backfill"))).toHaveLength(2));

    await act(async () => {
      resolveSecond(jsonResponse({ processed: 7, committed: 3, quarantined: 4, fetchFailed: 2, nextPageToken: null }));
    });
    const summary = "Backfill complete: 12 messages processed, 5 added, 7 need review, 3 failed to fetch";
    expect(await screen.findByRole("heading", { name: "Backfill complete" })).toBeInTheDocument();
    expectTotals(12, 5, 7, 3);
    expect(screen.queryByTestId("pending-icon")).not.toBeInTheDocument();
    await vi.waitFor(() => expect(screen.getByRole("button", { name: /run backfill now/i })).toBeEnabled());
    expect(spy.mock.calls.filter(([url]) => String(url).includes("/api/capture/backfill"))).toHaveLength(2);
    expect(showSuccess).toHaveBeenCalledOnce();
    expect(showSuccess).toHaveBeenCalledWith(summary);
  });

  test("a chunk that repeats the saved page token stops instead of retrying indefinitely", async () => {
    let chunks = 0;
    const spy = mockFetch([
      { test: urlContains("/api/capture/health", "GET"), respond: () => jsonResponse(healthResponse({ runStatus: "success" })) },
      {
        test: urlContains("/api/capture/backfill", "POST"),
        respond: () => {
          chunks++;
          if (chunks === 1) return jsonResponse({ processed: 5, committed: 2, quarantined: 3, fetchFailed: 0, nextPageToken: "page2" });
          return jsonResponse({ processed: 0, committed: 0, quarantined: 0, fetchFailed: 0, nextPageToken: chunks === 2 ? "page2" : null });
        },
      },
    ]);
    renderWithProviders(<CaptureHealth />);
    await userEvent.click(await screen.findByRole("button", { name: /run backfill now/i }));
    expect(await screen.findByRole("heading", { name: "Backfill stopped" })).toBeInTheDocument();
    expect(screen.getByTestId("error-icon")).toBeInTheDocument();
    expectTotals(5, 2, 3);
    expect(spy.mock.calls.filter(([url]) => String(url).includes("/api/capture/backfill"))).toHaveLength(2);
    expect(showError).toHaveBeenCalledWith("Couldn't run the backfill.");
    expect(showSuccess).not.toHaveBeenCalled();
  });

  test("a failed later chunk stops the backfill and keeps partial totals visible", async () => {
    let chunks = 0;
    const spy = mockFetch([
      { test: urlContains("/api/capture/health", "GET"), respond: () => jsonResponse(healthResponse({ runStatus: "success" })) },
      {
        test: urlContains("/api/capture/backfill", "POST"),
        respond: () => ++chunks === 1
          ? jsonResponse({ processed: 5, committed: 2, quarantined: 3, fetchFailed: 1, nextPageToken: "page2" })
          : new Response("fail", { status: 500 }),
      },
    ]);
    renderWithProviders(<CaptureHealth />);
    const button = await screen.findByRole("button", { name: /run backfill now/i });
    await userEvent.click(button);
    expect(await screen.findByRole("heading", { name: "Backfill stopped" })).toBeInTheDocument();
    expect(screen.getByTestId("error-icon")).toBeInTheDocument();
    expectTotals(5, 2, 3, 1);
    await vi.waitFor(() => expect(screen.getByRole("button", { name: /run backfill now/i })).toBeEnabled());
    expect(spy.mock.calls.filter(([url]) => String(url).includes("/api/capture/backfill"))).toHaveLength(2);
    expect(showError).toHaveBeenCalledOnce();
    expect(showError).toHaveBeenCalledWith("Couldn't run the backfill.");
    expect(showSuccess).not.toHaveBeenCalled();
  });
});
