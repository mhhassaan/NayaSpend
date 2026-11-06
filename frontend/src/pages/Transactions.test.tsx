import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, test, vi } from "vitest";
import { Transactions } from "./Transactions";
import { renderWithProviders, mockFetch, jsonResponse, urlContains } from "../../test/helpers";
import { showError, showSuccess } from "../components";
import type { Transaction } from "../types/transaction";

vi.mock("../components", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../components")>();
  return { ...actual, showError: vi.fn(), showSuccess: vi.fn() };
});

function buildTransaction(overrides: Partial<Transaction> = {}): Transaction {
  return {
    id: 1,
    amount: 1250,
    date: "2026-11-01",
    vendorRaw: "x",
    vendorNormalized: "x",
    category: "Uncategorized",
    source: "manual_missed",
    provenance: "{}",
    reviewStatus: "committed",
    dedupGroupId: null,
    dedupResolution: null,
    deletedAt: null,
    gmailMessageId: null,
    statementRowKey: null,
    ...overrides,
  };
}

describe("Transactions", () => {
  test("offers statement upload when there are no transactions", async () => {
    mockFetch([{ test: urlContains("/api/transactions"), respond: () => jsonResponse([]) }]);
    renderWithProviders(<Transactions />);
    expect(await screen.findByText(/no transactions yet/i)).toBeInTheDocument();
    const link = screen.getByRole("link", { name: /upload statement/i });
    expect(link).toBeInTheDocument();
    expect(link.getAttribute("href")).toBe("/statement-upload");
  });

  test("shows a skeleton, then the transaction list", async () => {
    mockFetch([
      { test: urlContains("/api/transactions"), respond: () => jsonResponse([buildTransaction({ vendorRaw: "Starbucks", amount: 1250 })]) },
    ]);
    renderWithProviders(<Transactions />);
    expect(screen.getByTestId("transactions-skeleton")).toBeInTheDocument();
    expect(await screen.findByText("Starbucks")).toBeInTheDocument();
  });

  test("shows an empty state when there are no transactions", async () => {
    mockFetch([{ test: urlContains("/api/transactions"), respond: () => jsonResponse([]) }]);
    renderWithProviders(<Transactions />);
    expect(await screen.findByText(/no transactions yet/i)).toBeInTheDocument();
    expect((await screen.findByText("No transactions yet.")).closest(".min-h-\\[55vh\\]")).toHaveClass("items-center", "justify-center");
  });

  test("correcting a category calls the category-patch endpoint and toasts success", async () => {
    const spy = mockFetch([
      { test: urlContains("/api/transactions"), respond: () => jsonResponse([buildTransaction({ id: 1, category: "Uncategorized" })]) },
      { test: urlContains("/category", "PATCH"), respond: () => jsonResponse({ id: 1, category: "Coffee" }) },
    ]);
    renderWithProviders(<Transactions />);
    await userEvent.click(await screen.findByText("Uncategorized"));
    const panel = screen.getByRole("complementary", { name: "Transaction details" });
    const input = within(panel).getByRole("combobox", { name: /category/i });
    expect(input).toHaveValue("Uncategorized");
    await userEvent.selectOptions(input, "Health");
    await userEvent.click(screen.getByRole("button", { name: /save/i }));
    await waitFor(() => expect(showSuccess).toHaveBeenCalledOnce());
    expect(JSON.parse(spy.mock.calls.find(([, init]) => init?.method === "PATCH")![1]!.body as string)).toEqual({ category: "Health" });
    await waitFor(() => expect(screen.queryByRole("complementary")).not.toBeInTheDocument());
  });

  test("[Review Focus] committing a quarantined row that matches toasts the dedup match, not just a generic success", async () => {
    mockFetch([
      { test: urlContains("/api/transactions"), respond: () => jsonResponse([buildTransaction({ id: 2, reviewStatus: "pending_review" })]) },
      { test: urlContains("/transactions/2", "PATCH"), respond: () => jsonResponse({ id: 2 }) },
      { test: urlContains("/resolve-review", "POST"), respond: () => jsonResponse({ resolved: "commit", matched: true }) },
    ]);
    renderWithProviders(<Transactions />);
    await userEvent.click(await screen.findByRole("button", { name: /resolve/i }));
    await userEvent.click(screen.getByRole("button", { name: /^commit$/i }));
    await waitFor(() => expect(showSuccess).toHaveBeenCalledWith(expect.stringMatching(/possible duplicate/i)));
  });

  test("rejecting a quarantined row toasts a plain success, not a duplicate-match message", async () => {
    mockFetch([
      { test: urlContains("/api/transactions"), respond: () => jsonResponse([buildTransaction({ id: 3, reviewStatus: "pending_review" })]) },
      { test: urlContains("/resolve-review", "POST"), respond: () => jsonResponse({ resolved: "reject", matched: false }) },
    ]);
    renderWithProviders(<Transactions />);
    await userEvent.click(await screen.findByRole("button", { name: /resolve/i }));
    await userEvent.click(screen.getByRole("button", { name: /^reject$/i }));
    await waitFor(() => expect(showSuccess).toHaveBeenCalled());
    expect(showSuccess).toHaveBeenCalledWith("Rejected");
    await waitFor(() => expect(screen.queryByRole("complementary")).not.toBeInTheDocument());
    expect(showSuccess).not.toHaveBeenCalledWith(expect.stringMatching(/possible duplicate/i));
  });

  test("[Review Focus] a zero-amount quarantine placeholder cannot be committed until its fields are edited", async () => {
    const spy = mockFetch([
      {
        test: urlContains("/api/transactions"),
        respond: () =>
          jsonResponse([
            buildTransaction({ id: 5, reviewStatus: "pending_review", amount: 0, vendorRaw: "(unrecognized)", source: "statement_import" }),
          ]),
      },
    ]);
    renderWithProviders(<Transactions />);
    await userEvent.click(await screen.findByRole("button", { name: /resolve/i }));
    await userEvent.click(screen.getByRole("button", { name: /^commit$/i }));
    expect(await screen.findByText(/enter an amount greater than zero/i)).toBeInTheDocument();
    expect(spy.mock.calls.every(([, init]) => (init?.method ?? "GET") === "GET")).toBe(true);
  });

  test("[Review Focus] editing the quarantined fields saves them before committing, and shows the quarantine reason", async () => {
    const spy = mockFetch([
      {
        test: urlContains("/api/transactions"),
        respond: () =>
          jsonResponse([
            buildTransaction({
              id: 6,
              reviewStatus: "pending_review",
              amount: 0,
              vendorRaw: "(unrecognized)",
              source: "statement_import",
              provenance: JSON.stringify({ fileRef: "statement.csv", rowIndex: 3, quarantineReason: "ambiguous vendor" }),
            }),
          ]),
      },
      { test: urlContains("/transactions/6", "PATCH"), respond: () => jsonResponse({ id: 6 }) },
      { test: urlContains("/resolve-review", "POST"), respond: () => jsonResponse({ resolved: "commit", matched: false }) },
    ]);
    renderWithProviders(<Transactions />);
    await userEvent.click(await screen.findByRole("button", { name: /resolve/i }));
    expect(screen.getByText(/ambiguous vendor/i)).toBeInTheDocument();
    await userEvent.clear(screen.getByLabelText(/vendor/i));
    await userEvent.type(screen.getByLabelText(/vendor/i), "Daraz");
    await userEvent.clear(screen.getByLabelText(/amount/i));
    await userEvent.type(screen.getByLabelText(/amount/i), "500");
    await userEvent.selectOptions(screen.getByLabelText("Category"), "Groceries");
    await userEvent.click(screen.getByRole("button", { name: /^commit$/i }));
    await waitFor(() => expect(showSuccess).toHaveBeenCalledWith("Committed"));
    await waitFor(() => expect(screen.queryByRole("complementary")).not.toBeInTheDocument());
    const patchCall = spy.mock.calls.find(([, init]) => init?.method === "PATCH");
    expect(patchCall).toBeDefined();
    const body = JSON.parse(patchCall![1]!.body as string);
    expect(body).toEqual({ vendorRaw: "Daraz", amount: -50000, date: "2026-11-01", category: "Groceries" });
  });

  test("[Review Focus] a statement-sourced vendor name carrying an account number is masked", async () => {
    mockFetch([
      {
        test: urlContains("/api/transactions"),
        respond: () => jsonResponse([buildTransaction({ vendorRaw: "Acct 1234567890", source: "statement_import" })]),
      },
    ]);
    renderWithProviders(<Transactions />);
    expect(await screen.findByText(/Acct .*7890/)).toBeInTheDocument();
    expect(screen.queryByText(/1234567890/)).not.toBeInTheDocument();
  });

  test("[break-ui] a long vendor name renders in full without breaking the row", async () => {
    const longVendor = "Konstantin Oberhauser-Wettstein Gesellschaft für Zahlungsdienstleistungen mbH";
    mockFetch([{ test: urlContains("/api/transactions"), respond: () => jsonResponse([buildTransaction({ vendorRaw: longVendor, amount: 99999999 })]) }]);
    renderWithProviders(<Transactions />);
    expect(await screen.findByText(longVendor)).toBeInTheDocument();
    expect(screen.getByText("Rs. 999,999.99")).toBeInTheDocument();
  });

  test("[Review Focus] a failed page load shows the error block and toasts once", async () => {
    mockFetch([{ test: urlContains("/api/transactions"), respond: () => new Response("fail", { status: 500 }) }]);
    renderWithProviders(<Transactions />);
    expect(await screen.findByRole("button", { name: /retry/i })).toBeInTheDocument();
    await waitFor(() => expect(showError).toHaveBeenCalledOnce());
  });

  test("a failed mutation toasts an error", async () => {
    mockFetch([
      { test: urlContains("/api/transactions"), respond: () => jsonResponse([buildTransaction({ id: 4, category: "Uncategorized" })]) },
      { test: urlContains("/category", "PATCH"), respond: () => jsonResponse("fail", 500) },
    ]);
    renderWithProviders(<Transactions />);
    await userEvent.click(await screen.findByText("Uncategorized"));
    const input = screen.getByRole("combobox", { name: /category/i });
    await userEvent.selectOptions(input, "Health");
    await userEvent.click(screen.getByRole("button", { name: /save/i }));
    await waitFor(() => expect(showError).toHaveBeenCalledOnce());
  });
});


test("filters signed amounts locally and returns to All, including zero placeholders", async () => {
  const spy = mockFetch([{ test: urlContains("/api/transactions"), respond: () => jsonResponse([
    buildTransaction({ id: 1, vendorRaw: "Groceries", amount: -1200 }),
    buildTransaction({ id: 2, vendorRaw: "Salary", amount: 5000 }),
    buildTransaction({ id: 3, vendorRaw: "Placeholder", amount: 0 }),
  ]) }]);
  renderWithProviders(<Transactions />);
  await screen.findByText("Groceries");
  expect(screen.getByText("Salary")).toBeInTheDocument();
  expect(screen.getByText("Placeholder")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "All" })).toHaveAttribute("aria-pressed", "true");
  await userEvent.click(screen.getByRole("button", { name: "Money out" }));
  expect(screen.getByText("Groceries")).toBeInTheDocument();
  expect(screen.queryByText("Salary")).not.toBeInTheDocument();
  expect(screen.queryByText("Placeholder")).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "Money in" }));
  expect(screen.getByText("Salary")).toBeInTheDocument();
  expect(screen.queryByText("Groceries")).not.toBeInTheDocument();
  expect(screen.queryByText("Placeholder")).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "All" }));
  expect(screen.getByText("Groceries")).toBeInTheDocument();
  expect(screen.getByText("Salary")).toBeInTheDocument();
  expect(screen.getByText("Placeholder")).toBeInTheDocument();
  expect(spy).toHaveBeenCalledTimes(1);
});

test.each([
  ["Money out", 500, "No outflow transactions yet."],
  ["Money in", -500, "No inflow transactions yet."],
])("%s has a filter-aware empty state", async (filter, amount, message) => {
  mockFetch([{ test: urlContains("/api/transactions"), respond: () => jsonResponse([buildTransaction({ vendorRaw: "Only row", amount })]) }]);
  renderWithProviders(<Transactions />);
  await screen.findByText("Only row");
  await userEvent.click(screen.getByRole("button", { name: filter }));
  expect(await screen.findByText(message)).toBeInTheDocument();
  expect(screen.queryByText("Only row")).not.toBeInTheDocument();
  expect(screen.getByRole("link", { name: /upload statement/i })).toBeInTheDocument();
});

test("an entirely empty ledger keeps the generic message under either direction filter", async () => {
  mockFetch([{ test: urlContains("/api/transactions"), respond: () => jsonResponse([]) }]);
  renderWithProviders(<Transactions />);
  await screen.findByText("No transactions yet.");
  for (const name of ["Money in", "Money out"]) {
    await userEvent.click(screen.getByRole("button", { name }));
    expect(screen.getByText("No transactions yet.")).toBeInTheDocument();
  }
});

 test("switching rows keeps one panel and resets its fields, and close unmounts it", async () => {
  mockFetch([{ test: urlContains("/api/transactions"), respond: () => jsonResponse([
    buildTransaction({ id: 10, category: "Coffee" }),
    buildTransaction({ id: 11, category: "Health", reviewStatus: "pending_review", vendorRaw: "Clinic" }),
  ]) }]);
  renderWithProviders(<Transactions />);
  await userEvent.click(await screen.findByRole("button", { name: "Coffee" }));
  expect(screen.getByLabelText("Category")).toHaveValue("Coffee");
  await userEvent.click(screen.getByRole("button", { name: "Resolve" }));
  expect(screen.getAllByRole("complementary")).toHaveLength(1);
  expect(screen.getByLabelText("Category")).toHaveValue("Health");
  expect(screen.getByLabelText("Vendor")).toHaveValue("Clinic");
  expect(screen.getByLabelText("Date")).toHaveValue("2026-11-01");
  await userEvent.click(screen.getByRole("button", { name: "Close transaction details" }));
  await waitFor(() => expect(screen.queryByRole("complementary")).not.toBeInTheDocument());
 });

test.each(["patch", "commit", "reject"])("a failed %s keeps the review panel open and reports the error", async (failure) => {
  const spy = mockFetch([
    { test: urlContains("/api/transactions", "GET"), respond: () => jsonResponse([buildTransaction({ reviewStatus: "pending_review" })]) },
    { test: urlContains("/transactions/1", "PATCH"), respond: () => failure === "patch" ? new Response("Unable to save", { status: 500 }) : jsonResponse({ id: 1 }) },
    { test: urlContains("/resolve-review", "POST"), respond: () => new Response("fail", { status: 500 }) },
  ]);
  renderWithProviders(<Transactions />);
  await userEvent.click(await screen.findByRole("button", { name: "Resolve" }));
  await userEvent.click(screen.getByRole("button", { name: failure === "reject" ? "Reject" : "Commit" }));
  await waitFor(() => expect(showError).toHaveBeenCalledWith("Couldn't resolve this transaction."));
  expect(screen.getByRole("complementary")).toBeInTheDocument();
  if (failure === "patch") {
    expect(screen.getByText("Unable to save")).toBeInTheDocument();
    expect(spy.mock.calls.some(([, init]) => init?.method === "POST")).toBe(false);
  }
});


test.each([
  [0, null, "1559.13", -155913],
  [-125000, null, "1559.13", -155913],
  [125000, null, "1559.13", 155913],
  [0, "Money in", "1559.13", 155913],
  [0, "Money in", "-1559.13", 155913],
  [0, null, "-1559.13", -155913],
] as const)("review uses direction for amount: initial %s, selected %s, typed %s", async (initial, selected, typed, expected) => {
  const spy = mockFetch([
    { test: urlContains("/api/transactions", "GET"), respond: () => jsonResponse([buildTransaction({ amount: initial, reviewStatus: "pending_review" })]) },
    { test: urlContains("/transactions/1", "PATCH"), respond: () => jsonResponse({ id: 1 }) },
    { test: urlContains("/resolve-review", "POST"), respond: () => jsonResponse({ resolved: "commit", matched: false }) },
  ]);
  renderWithProviders(<Transactions />);
  await userEvent.click(await screen.findByRole("button", { name: "Resolve" }));
  const panel = within(screen.getByRole("complementary"));
  const toggle = within(panel.getByRole("group", { name: "Transaction direction" }));
  expect(toggle.getByRole("button", { name: initial > 0 ? "Money in" : "Money out" })).toHaveAttribute("aria-pressed", "true");
  expect(panel.getByLabelText("Amount")).toHaveValue(String(Math.abs(initial) / 100));
  if (selected) await userEvent.click(toggle.getByRole("button", { name: selected }));
  await userEvent.clear(panel.getByLabelText("Amount"));
  await userEvent.type(panel.getByLabelText("Amount"), typed);
  await userEvent.click(panel.getByRole("button", { name: "Commit" }));
  await waitFor(() => expect(showSuccess).toHaveBeenCalledWith("Committed"));
  const patch = spy.mock.calls.find(([, init]) => init?.method === "PATCH");
  expect(JSON.parse(patch![1]!.body as string).amount).toBe(expected);
});
