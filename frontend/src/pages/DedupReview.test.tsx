import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, test, vi } from "vitest";
import { DedupReview } from "./DedupReview";
import { renderWithProviders, mockFetch, jsonResponse, urlContains } from "../../test/helpers";
import { showSuccess } from "../components";
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
    expect(screen.getByRole("button", { name: /resolve selected/i })).toBeEnabled();
  });
});
