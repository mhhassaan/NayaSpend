import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, test, vi } from "vitest";
import { DedupReview } from "./DedupReview";
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
    source: "gmail_email",
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

describe("DedupReview", () => {
  test("groups candidate pairs by dedup_group_id and shows both sides", async () => {
    mockFetch([
      {
        test: urlContains("/api/transactions"),
        respond: () =>
          jsonResponse([
            buildTransaction({ id: 1, dedupGroupId: "g1", dedupResolution: "pending", vendorRaw: "Daraz", source: "gmail_email" }),
            buildTransaction({ id: 2, dedupGroupId: "g1", dedupResolution: "pending", vendorRaw: "Daraz", source: "statement_import" }),
          ]),
      },
    ]);
    renderWithProviders(<DedupReview />);
    expect(await screen.findAllByText("Daraz")).toHaveLength(2);
  });

  test("shows an empty state when there are no pending candidates", async () => {
    mockFetch([{ test: urlContains("/api/transactions"), respond: () => jsonResponse([]) }]);
    renderWithProviders(<DedupReview />);
    expect(await screen.findByText(/no duplicates to review/i)).toBeInTheDocument();
  });

  test("keeping one side resolves the pair and toasts success", async () => {
    mockFetch([
      {
        test: urlContains("/api/transactions"),
        respond: () =>
          jsonResponse([
            buildTransaction({ id: 1, dedupGroupId: "g1", dedupResolution: "pending" }),
            buildTransaction({ id: 2, dedupGroupId: "g1", dedupResolution: "pending" }),
          ]),
      },
      { test: urlContains("/resolve-dedup", "POST"), respond: () => jsonResponse({ resolved: "kept" }) },
    ]);
    renderWithProviders(<DedupReview />);
    const keepButtons = await screen.findAllByRole("button", { name: /keep this one/i });
    await userEvent.click(keepButtons[0]);
    await vi.waitFor(() => expect(showSuccess).toHaveBeenCalledOnce());
  });

  test("[Review Focus] a statement-sourced side of a pair has its account number masked", async () => {
    mockFetch([
      {
        test: urlContains("/api/transactions"),
        respond: () =>
          jsonResponse([
            buildTransaction({ id: 1, dedupGroupId: "g1", dedupResolution: "pending", vendorRaw: "Acct 1234567890", source: "statement_import" }),
            buildTransaction({ id: 2, dedupGroupId: "g1", dedupResolution: "pending", vendorRaw: "Daraz", source: "gmail_email" }),
          ]),
      },
    ]);
    renderWithProviders(<DedupReview />);
    expect(await screen.findByText(/Acct .*7890/)).toBeInTheDocument();
    expect(screen.queryByText(/1234567890/)).not.toBeInTheDocument();
  });

  test("[break-ui] a pair with a very long vendor name on one side still renders both sides in full", async () => {
    const longVendor = "Christopher Alexander Montgomery III Enterprises Limited Partnership";
    mockFetch([
      {
        test: urlContains("/api/transactions"),
        respond: () =>
          jsonResponse([
            buildTransaction({ id: 1, dedupGroupId: "g1", dedupResolution: "pending", vendorRaw: longVendor }),
            buildTransaction({ id: 2, dedupGroupId: "g1", dedupResolution: "pending", vendorRaw: longVendor }),
          ]),
      },
    ]);
    renderWithProviders(<DedupReview />);
    expect(await screen.findAllByText(longVendor)).toHaveLength(2);
  });

  test("batch-resolving several pairs via checkbox multi-select enables a bulk action", async () => {
    mockFetch([
      {
        test: urlContains("/api/transactions"),
        respond: () =>
          jsonResponse(
            Array.from({ length: 4 }, (_, i) =>
              buildTransaction({ id: i + 1, dedupGroupId: `g${Math.floor(i / 2)}`, dedupResolution: "pending" })
            )
          ),
      },
    ]);
    renderWithProviders(<DedupReview />);
    const checkboxes = await screen.findAllByRole("checkbox", { name: /select this pair/i });
    await userEvent.click(checkboxes[0]);
    expect(screen.getByRole("button", { name: /confirm selected as distinct/i })).toBeEnabled();
  });

  test("[Review Focus] the bulk action confirms every selected pair as distinct (never discards a side) and shows one summary toast", async () => {
    const spy = mockFetch([
      {
        test: urlContains("/api/transactions"),
        respond: () =>
          jsonResponse(
            Array.from({ length: 4 }, (_, i) =>
              buildTransaction({ id: i + 1, dedupGroupId: `g${Math.floor(i / 2)}`, dedupResolution: "pending" })
            )
          ),
      },
      { test: urlContains("/resolve-dedup", "POST"), respond: () => jsonResponse({ resolved: "confirmed_distinct" }) },
    ]);
    renderWithProviders(<DedupReview />);
    const checkboxes = await screen.findAllByRole("checkbox", { name: /select this pair/i });
    await userEvent.click(checkboxes[0]);
    await userEvent.click(checkboxes[1]);
    await userEvent.click(screen.getByRole("button", { name: /confirm selected as distinct/i }));
    await vi.waitFor(() => expect(showSuccess).toHaveBeenCalledOnce());
    const resolveCalls = spy.mock.calls.filter(([url]) => String(url).includes("resolve-dedup"));
    expect(resolveCalls).toHaveLength(2);
    for (const [, init] of resolveCalls) {
      const body = JSON.parse(init!.body as string);
      expect(body.action).toBe("confirmed_distinct");
    }
  });

  test("[Review Focus] a failed page load shows the error block and toasts once", async () => {
    mockFetch([{ test: urlContains("/api/transactions"), respond: () => new Response("fail", { status: 500 }) }]);
    renderWithProviders(<DedupReview />);
    expect(await screen.findByRole("button", { name: /retry/i })).toBeInTheDocument();
    await vi.waitFor(() => expect(showError).toHaveBeenCalledOnce());
  });
});
