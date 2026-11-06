import { screen, waitFor, within } from "@testing-library/react";
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
  test("[first-ever-use] shows the full hero takeover when every month in the 6-month history has no data", async () => {
    const month = new Date().toISOString().slice(0, 7);
    mockFetch([
      { test: urlContains("/api/trends?"), respond: () => jsonResponse({ month, spentCents: 0, receivedCents: 0, byCategory: [], hasData: false }) },
      { test: urlContains("/api/trends/history"), respond: () => jsonResponse({ months: Array.from({ length: 6 }, (_, i) => ({ month: `2026-${String(i + 6).padStart(2, "0")}`, spentCents: 0, receivedCents: 0, byCategory: [], hasData: false })) }) },
    ]);
    renderWithProviders(<Dashboard />);
    expect(await screen.findByText(/welcome/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /upload statement/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /log a transaction/i })).toBeInTheDocument();
    expect(screen.queryByText(/^Spend for /)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Budgets$/ })).not.toBeInTheDocument();
    const emptyMessage = screen.getByText(/no spending recorded yet/i);
    expect(emptyMessage.parentElement!.querySelector("svg")).toBeNull();
    expect(within(emptyMessage.parentElement!).queryByRole("button")).not.toBeInTheDocument();
  });

  test("a returning user's empty month shows the richer EmptyState with an Upload-statement action, not the hero", async () => {
    const month = new Date().toISOString().slice(0, 7);
    mockFetch([
      { test: urlContains("/api/trends?"), respond: () => jsonResponse({ month, spentCents: 0, receivedCents: 0, byCategory: [], hasData: false }) },
      { test: urlContains("/api/trends/history"), respond: () => jsonResponse({ months: [{ month: "2026-10", spentCents: 5000, receivedCents: 0, byCategory: [{ category: "Coffee", totalCents: 5000 }], hasData: true }] }) },
    ]);
    renderWithProviders(<Dashboard />);
    const emptyMessage = await screen.findByText(/no spending recorded yet/i);
    expect(emptyMessage).toBeInTheDocument();
    expect(screen.queryByText(/welcome/i)).not.toBeInTheDocument();
    expect(within(emptyMessage.parentElement!).getByRole("button", { name: /upload statement/i })).toBeInTheDocument();
    expect(emptyMessage.parentElement!.querySelector("svg")).toBeInTheDocument();
  });

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
      { test: urlContains("/api/trends?"), respond: () => jsonResponse({ month: "2026-11", spentCents: 0, receivedCents: 0, byCategory: [], hasData: false }) },
      { test: urlContains("/api/trends/history"), respond: () => jsonResponse({ months: [] }) },
    ]);
    renderWithProviders(<Dashboard />);
    expect(await screen.findByText(/no spending recorded yet/i)).toBeInTheDocument();
  });

  test("renders the month breakdown and the multi-month chart on success", async () => {
    mockFetch([
      {
        test: urlContains("/api/trends?"),
        respond: () => jsonResponse({ month: "2026-11", spentCents: 5000, receivedCents: 0, byCategory: [{ category: "Coffee", totalCents: 5000 }], hasData: true }),
      },
      {
        test: urlContains("/api/trends/history"),
        respond: () =>
          jsonResponse({
            months: [
              { month: "2026-10", spentCents: 3000, byCategory: [], hasData: true },
              { month: "2026-11", spentCents: 5000, byCategory: [], hasData: true },
            ],
          }),
      },
    ]);
    renderWithProviders(<Dashboard />);
    expect(await screen.findByText("Coffee", { selector: "span" })).toBeInTheDocument();
    expect(screen.getByTestId("trends-history-chart")).toBeInTheDocument();
  });

  test("clicking next month re-fetches the following month's breakdown", async () => {
    const now = new Date();
    const nextMonthDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
    const nextMonth = `${nextMonthDate.getUTCFullYear()}-${String(nextMonthDate.getUTCMonth() + 1).padStart(2, "0")}`;

    const spy = mockFetch([
      { test: urlContains("/api/trends?"), respond: () => jsonResponse({ month: "irrelevant", spentCents: 0, receivedCents: 0, byCategory: [], hasData: false }) },
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

  test("[break-ui] a single-month history with a huge total doesn't break the chart's bar-width math", async () => {
    mockFetch([
      {
        test: urlContains("/api/trends?"),
        respond: () =>
          jsonResponse({ month: "2026-11", spentCents: 99999999, receivedCents: 0, byCategory: [{ category: "Rent", totalCents: 99999999 }], hasData: true }),
      },
      {
        test: urlContains("/api/trends/history"),
        respond: () => jsonResponse({ months: [{ month: "2026-11", spentCents: 99999999, byCategory: [], hasData: true }] }),
      },
    ]);
    renderWithProviders(<Dashboard />);
    const chart = await screen.findByTestId("trends-history-chart");
    const bar = chart.querySelector("div > div") as HTMLElement;
    expect(bar.style.height).not.toMatch(/NaN|Infinity/);
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


describe("Dashboard spending insights", () => {
  function setup({ history = [], total = 12000, received = 0, biggestPurchase = null, categories = [{ category: "Coffee", totalCents: total }], budgets }: {
    history?: { month: string; spentCents: number }[];
    total?: number;
    received?: number;
    biggestPurchase?: { vendorRaw: string; amountCents: number } | null;
    categories?: { category: string; totalCents: number }[];
    budgets?: { category: string; limitAmount: number }[];
  } = {}) {
    const month = new Date().toISOString().slice(0, 7);
    const previousDate = new Date();
    previousDate.setUTCDate(1);
    previousDate.setUTCMonth(previousDate.getUTCMonth() - 1);
    const previous = previousDate.toISOString().slice(0, 7);
    const fetch = mockFetch([
      { test: urlContains("/api/trends?"), respond: () => jsonResponse({ month, spentCents: total, receivedCents: received, biggestPurchase, byCategory: categories, hasData: total > 0 }) },
      { test: urlContains("/api/trends/history"), respond: () => jsonResponse({ months: history.map((entry) => ({ ...entry, byCategory: [], hasData: true })) }) },
      ...(budgets ? [{ test: urlContains("/api/budgets"), respond: () => jsonResponse(budgets.map((b, id) => ({ ...b, id, periodType: "monthly", lastAlertedThreshold: null, lastAlertedPeriodStart: null }))) }] : []),
    ]);
    renderWithProviders(<Dashboard />);
    return { month, previous, fetch };
  }

  test("names the largest category and its rounded share under the hero", async () => {
    setup({ total: 30000, categories: [{ category: "Coffee", totalCents: 10000 }, { category: "Rent", totalCents: 20000 }] });
    const insight = await screen.findByText(/Most of this went to/);
    expect(insight).toHaveTextContent("Most of this went to Rent (67%)");
    expect(within(insight).getByText("Rent").tagName).toBe("STRONG");
  });

  test("Share your month opens the currently viewed recap in private mode", async () => {
    setup({ total: 30000, categories: [{ category: "Coffee", totalCents: 30000 }] });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await userEvent.click(await screen.findByRole("button", { name: "Share your month" }));
    const modal = screen.getByRole("dialog");
    expect(within(modal).getByRole("button", { name: "Percentages only" })).toHaveAttribute("aria-pressed", "true");
    const label = new Date().toLocaleString("en", { month: "long", year: "numeric", timeZone: "UTC" });
    expect(within(modal).getByText(`${label} / My spending recap`)).toBeInTheDocument();
    expect(within(modal).getByLabelText("Spending recap").textContent).not.toContain("Rs");
    await userEvent.click(within(modal).getByRole("button", { name: "With amounts" }));
    expect(within(modal).getByLabelText("Spending recap")).toHaveTextContent("Rs. 300.00");
  });

  test.each([20000, 12000])("uses kept wording and purple tone for nonnegative net with income %i", async (received) => {
    setup({ received });
    const text = await screen.findByText(`You kept Rs. ${((received - 12000) / 100).toFixed(2)} this month`);
    expect(text.closest('[aria-label="Net position"]')).toHaveClass("bg-light-purple", "border-vivid-violet");
  });

  test("uses spent-more wording and danger tone for negative net", async () => {
    setup({ received: 2000 });
    const text = await screen.findByText("You spent Rs. 100.00 more than you received this month");
    expect(text.closest('[aria-label="Net position"]')).toHaveClass("text-danger", "bg-danger/10");
  });

  test("places the biggest single purchase after the history chart", async () => {
    setup({ biggestPurchase: { vendorRaw: "Imtiaz", amountCents: -425000 } });
    const text = await screen.findByText(/Biggest single purchase:/);
    expect(text).toHaveTextContent("Biggest single purchase: Rs. 4,250.00 at Imtiaz");
    expect(screen.getByText("Last 6 months").compareDocumentPosition(text) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  test("omits the outlier when biggestPurchase is null", async () => {
    setup();
    await screen.findByText("Last 6 months");
    expect(screen.queryByText(/Biggest single purchase:/)).not.toBeInTheDocument();
  });

  test.each([false, true])("omits all glance insights in an empty month (returning: %s)", async (returning) => {
    setup({ total: 0, received: 20000, categories: [], history: returning ? [{ month: "2026-01", spentCents: 100 }] : [], biggestPurchase: { vendorRaw: "Hidden", amountCents: -100 } });
    await screen.findByText(/no spending recorded yet/i);
    expect(screen.queryByText(/Most of this went to/)).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Net position")).not.toBeInTheDocument();
    expect(screen.queryByText(/Biggest single purchase:/)).not.toBeInTheDocument();
  });

  test.each([ [12000, "\u25b2 20%"], [8000, "\u25bc 20%"] ])("shows a month-over-month delta for %i cents", async (total, badge) => {
    const now = new Date();
    const month = now.toISOString().slice(0, 7);
    const previous = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
    setup({ total: Number(total), history: [{ month, spentCents: Number(total) }, { month: previous.toISOString().slice(0, 7), spentCents: 10000 }] });
    const shortMonth = previous.toLocaleString("en", { month: "short", timeZone: "UTC" });
    expect(await screen.findByText(`${badge} vs ${shortMonth}`)).toBeInTheDocument();
  });

  test.each(["missing", "zero", "equal", "missing current"])("omits delta when history is %s", async (condition) => {
    const now = new Date();
    const month = now.toISOString().slice(0, 7);
    const previous = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1)).toISOString().slice(0, 7);
    setup({ history: [ ...(condition === "missing current" ? [] : [{ month, spentCents: 12000 }]), ...(condition === "missing" ? [] : [{ month: previous, spentCents: condition === "zero" ? 0 : 12000 }]) ] });
    await screen.findByText("Coffee", { selector: "span" });
    expect(screen.queryByText(/% vs /)).not.toBeInTheDocument();
  });

  test("omits the delta badge when the current month has no recorded spending yet, even if a prior month did", async () => {
      const now = new Date();
      const month = now.toISOString().slice(0, 7);
      const previous = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1)).toISOString().slice(0, 7);
      mockFetch([
        { test: urlContains("/api/trends?"), respond: () => jsonResponse({ month, spentCents: 0, receivedCents: 0, byCategory: [], hasData: false }) },
        {
          test: urlContains("/api/trends/history"),
          respond: () =>
            jsonResponse({
              months: [
                { month: previous, spentCents: 12000, byCategory: [], hasData: true },
                { month, spentCents: 0, byCategory: [], hasData: false },
              ],
            }),
        },
      ]);
      renderWithProviders(<Dashboard />);
      await screen.findByText(/no spending recorded yet/i);
      expect(screen.queryByText(/% vs /)).not.toBeInTheDocument();
    });
  
    test("shows average per UTC day elapsed and uses calendar days for a past month", async () => {
    setup();
    const label = await screen.findByText("Avg/day");
    const expected = (120 / new Date().getUTCDate()).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    expect(within(label.parentElement!).getByText(`Rs. ${expected}`)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /previous month/i }));
    const now = new Date();
    const days = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0)).getUTCDate();
    await waitFor(() => expect(within(screen.getByText("Avg/day").parentElement!).getByText(`Rs. ${(120 / days).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`)).toBeInTheDocument());
  });

  test("omits the daily average for a month without spending", async () => {
    setup({ total: 0, categories: [] });
    await screen.findByText(/no spending recorded yet/i);
    expect(screen.queryByText("Avg/day")).not.toBeInTheDocument();
  });

  test("shows a Received stat when the month has income, and omits it otherwise", async () => {
    mockFetch([
      { test: urlContains("/api/trends?"), respond: () => jsonResponse({ month: "2026-11", spentCents: 5000, receivedCents: 15000, byCategory: [{ category: "Coffee", totalCents: 5000 }], hasData: true }) },
      { test: urlContains("/api/trends/history"), respond: () => jsonResponse({ months: [] }) },
    ]);
    renderWithProviders(<Dashboard />);
    const label = await screen.findByText("Received");
    expect(within(label.parentElement!).getByText("Rs. 150.00")).toBeInTheDocument();
  });

  test("omits the Received stat when the month has no income", async () => {
    setup();
    await screen.findByText("Coffee", { selector: "span" });
    expect(screen.queryByText("Received")).not.toBeInTheDocument();
  });

  test("sorts categories by spend with bars proportional to the monthly total", async () => {
    setup({ total: 10000, categories: [{ category: "Coffee", totalCents: 2000 }, { category: "Rent", totalCents: 8000 }] });
    const bars = await screen.findAllByRole("meter");
    expect(bars.map((bar) => bar.getAttribute("aria-label"))).toEqual(["Rent share of spending", "Coffee share of spending"]);
    await waitFor(() => {
      expect(bars[0]).toHaveStyle({ width: "80%" });
      expect(bars[1]).toHaveStyle({ width: "20%" });
    });
  });

  test("shows a rounded percentage beside each category amount", async () => {
    setup({ total: 30000, categories: [{ category: "Coffee", totalCents: 10000 }, { category: "Rent", totalCents: 20000 }] });
    const category = await screen.findByText("Coffee", { selector: "span" });
    const row = within(category.parentElement!);
    expect(row.getByText("Rs. 100.00")).toBeInTheDocument();
    expect(row.getByText("33%")).toHaveClass("text-text-secondary", "text-[12px]");
  });

  test.each([
    [4250000, "42.5k"],
    [100000, "1.0k"],
    [42500, "425"],
    [99999, "999.99"],
    [0, "0"],
  ])("labels a history bar above it using rupees for %i cents", async (spentCents, label) => {
    setup({ history: [{ month: "2026-05", spentCents }] });
    const chart = await screen.findByTestId("trends-history-chart");
    const value = within(chart).getByText(label);
    expect(value).toHaveClass("text-[11px]", "text-text-secondary");
    expect(value.nextElementSibling).toHaveClass("bg-accent");
    expect(value.parentElement!.lastElementChild).toHaveTextContent("05");
  });

  test("renders budgets with spent, limits, percentages and threshold tones", async () => {
    setup({ total: 18000, categories: [{ category: "Coffee", totalCents: 8000 }, { category: "Rent", totalCents: 10000 }], budgets: [{ category: "Coffee", limitAmount: 10000 }, { category: "Rent", limitAmount: 10000 }, { category: "Travel", limitAmount: 0 }] });
    const card = await screen.findByRole("region", { name: "Budgets at a glance" });
    expect(within(card).getByText("Rs. 80.00 / Rs. 100.00")).toBeInTheDocument();
    expect(within(card).getByText("80%")).toHaveClass("text-warning");
    expect(within(card).getByText("100%")).toHaveClass("text-danger");
    expect(within(card).getByText("Rs. 0.00 / Rs. 0.00")).toBeInTheDocument();
    expect(within(card).getByText("0%")).toBeInTheDocument();
  });

  test("silently omits budgets when the optional request has no mock", async () => {
    const { fetch } = setup();
    await screen.findByText("Coffee", { selector: "span" });
    await waitFor(() => expect(fetch.mock.calls.some(([url]) => String(url).includes("/api/budgets"))).toBe(true));
    expect(screen.queryByText("Budgets at a glance")).not.toBeInTheDocument();
    expect(showError).not.toHaveBeenCalled();
  });

  test("omits budgets when the optional request is pending", async () => {
    mockFetch([
      { test: urlContains("/api/trends?"), respond: () => jsonResponse({ month: "2026-11", spentCents: 100, receivedCents: 0, byCategory: [], hasData: true }) },
      { test: urlContains("/api/trends/history"), respond: () => jsonResponse({ months: [] }) },
      { test: urlContains("/api/budgets"), respond: () => new Promise(() => {}) },
    ]);
    renderWithProviders(<Dashboard />);
    await screen.findByText("Last 6 months");
    expect(screen.queryByText("Budgets at a glance")).not.toBeInTheDocument();
  });

  test("omits budgets when none exist", async () => {
    setup({ budgets: [] });
    await screen.findByText("Coffee", { selector: "span" });
    expect(screen.queryByText("Budgets at a glance")).not.toBeInTheDocument();
  });
});
