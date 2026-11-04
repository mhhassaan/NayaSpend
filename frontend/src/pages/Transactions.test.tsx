import { screen, waitFor } from "@testing-library/react";
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
  });

  test("correcting a category calls the category-patch endpoint and toasts success", async () => {
    mockFetch([
      { test: urlContains("/api/transactions"), respond: () => jsonResponse([buildTransaction({ id: 1, category: "Uncategorized" })]) },
      { test: urlContains("/category", "PATCH"), respond: () => jsonResponse({ id: 1, category: "Coffee" }) },
    ]);
    renderWithProviders(<Transactions />);
    await userEvent.click(await screen.findByText("Uncategorized"));
    const input = screen.getByRole("textbox", { name: /category/i });
    await userEvent.clear(input);
    await userEvent.type(input, "Coffee");
    await userEvent.click(screen.getByRole("button", { name: /save/i }));
    await waitFor(() => expect(showSuccess).toHaveBeenCalledOnce());
  });

  test("[Review Focus] committing a quarantined row that matches toasts the dedup match, not just a generic success", async () => {
    mockFetch([
      { test: urlContains("/api/transactions"), respond: () => jsonResponse([buildTransaction({ id: 2, reviewStatus: "pending_review" })]) },
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
    expect(showSuccess).not.toHaveBeenCalledWith(expect.stringMatching(/possible duplicate/i));
  });

  test("a failed mutation toasts an error", async () => {
    mockFetch([
      { test: urlContains("/api/transactions"), respond: () => jsonResponse([buildTransaction({ id: 4, category: "Uncategorized" })]) },
      { test: urlContains("/category", "PATCH"), respond: () => jsonResponse("fail", 500) },
    ]);
    renderWithProviders(<Transactions />);
    await userEvent.click(await screen.findByText("Uncategorized"));
    const input = screen.getByRole("textbox", { name: /category/i });
    await userEvent.clear(input);
    await userEvent.type(input, "x");
    await userEvent.click(screen.getByRole("button", { name: /save/i }));
    await waitFor(() => expect(showError).toHaveBeenCalledOnce());
  });
});
