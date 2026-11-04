import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, test, vi } from "vitest";
import { Dashboard } from "./Dashboard";
import { renderWithProviders, mockFetch, jsonResponse, urlContains } from "../../test/helpers";
import { showError } from "../components";

vi.mock("../components", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../components")>();
  return { ...actual, showError: vi.fn(), showSuccess: vi.fn() };
});

describe("Dashboard", () => {
  test("shows a skeleton while the month breakdown is loading", () => {
    mockFetch([
      { test: urlContains("/api/trends?"), respond: () => new Promise(() => {}) },
      { test: urlContains("/api/trends/history"), respond: () => new Promise(() => {}) },
    ]);
    renderWithProviders(<Dashboard />);
    expect(screen.getByTestId("dashboard-skeleton")).toBeInTheDocument();
  });

  test("shows the empty state when the current month has no data", async () => {
    mockFetch([
      { test: urlContains("/api/trends?"), respond: () => jsonResponse({ month: "2026-11", totalCents: 0, byCategory: [], hasData: false }) },
      { test: urlContains("/api/trends/history"), respond: () => jsonResponse({ months: [] }) },
    ]);
    renderWithProviders(<Dashboard />);
    expect(await screen.findByText(/no spending recorded yet/i)).toBeInTheDocument();
  });

  test("renders the month breakdown and the multi-month chart on success", async () => {
    mockFetch([
      {
        test: urlContains("/api/trends?"),
        respond: () => jsonResponse({ month: "2026-11", totalCents: 5000, byCategory: [{ category: "Coffee", totalCents: 5000 }], hasData: true }),
      },
      {
        test: urlContains("/api/trends/history"),
        respond: () =>
          jsonResponse({
            months: [
              { month: "2026-10", totalCents: 3000, byCategory: [], hasData: true },
              { month: "2026-11", totalCents: 5000, byCategory: [], hasData: true },
            ],
          }),
      },
    ]);
    renderWithProviders(<Dashboard />);
    expect(await screen.findByText("Coffee")).toBeInTheDocument();
    expect(screen.getByTestId("trends-history-chart")).toBeInTheDocument();
  });

  test("clicking next month re-fetches the following month's breakdown", async () => {
    const now = new Date();
    const nextMonthDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
    const nextMonth = `${nextMonthDate.getUTCFullYear()}-${String(nextMonthDate.getUTCMonth() + 1).padStart(2, "0")}`;

    const spy = mockFetch([
      { test: urlContains("/api/trends?"), respond: () => jsonResponse({ month: "irrelevant", totalCents: 0, byCategory: [], hasData: false }) },
      { test: urlContains("/api/trends/history"), respond: () => jsonResponse({ months: [] }) },
    ]);
    renderWithProviders(<Dashboard />);
    const nextButton = await screen.findByRole("button", { name: /next month/i });
    await userEvent.click(nextButton);

    await waitFor(() => {
      const calledWithNextMonth = spy.mock.calls.some(([url]) => String(url).includes(`month=${nextMonth}`));
      expect(calledWithNextMonth).toBe(true);
    });
  });

  test("a failed fetch shows an error block with a retry button and toasts once", async () => {
    mockFetch([
      { test: urlContains("/api/trends?"), respond: () => { throw new Error("network error"); } },
      { test: urlContains("/api/trends/history"), respond: () => jsonResponse({ months: [] }) },
    ]);
    renderWithProviders(<Dashboard />);
    expect(await screen.findByRole("button", { name: /retry/i })).toBeInTheDocument();
    await waitFor(() => expect(showError).toHaveBeenCalledOnce());
  });
});
