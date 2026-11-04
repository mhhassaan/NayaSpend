import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, test, vi } from "vitest";
import { CaptureHealth } from "./CaptureHealth";
import { renderWithProviders, mockFetch, jsonResponse, urlContains } from "../../test/helpers";
import { showSuccess } from "../components";

vi.mock("../components", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../components")>();
  return { ...actual, showError: vi.fn(), showSuccess: vi.fn() };
});

function healthResponse(overrides: Record<string, unknown>) {
  return { runStatus: "job_did_not_run", lastAttemptedRun: null, lastSuccessfulRun: null, errorType: null, ...overrides };
}

describe("CaptureHealth", () => {
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

  test("a manual backfill trigger calls the backfill endpoint and toasts its result", async () => {
    mockFetch([
      {
        test: urlContains("/api/capture/health", "GET"),
        respond: () => jsonResponse(healthResponse({ runStatus: "success", lastAttemptedRun: "2026-11-01T00:00:00Z", lastSuccessfulRun: "2026-11-01T00:00:00Z" })),
      },
      { test: urlContains("/api/capture/backfill", "POST"), respond: () => jsonResponse({ processed: 3, nextPageToken: null }) },
    ]);
    renderWithProviders(<CaptureHealth />);
    await userEvent.click(await screen.findByRole("button", { name: /run backfill now/i }));
    expect(await screen.findByText(/3/)).toBeInTheDocument();
    await vi.waitFor(() => expect(showSuccess).toHaveBeenCalledOnce());
  });
});
