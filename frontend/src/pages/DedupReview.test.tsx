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
  test.each([
    ["left", 1, "kept", 200],
    ["right", 2, "kept", 200],
    ["distinct", 1, "confirmed_distinct", 200],
    ["left", 1, "kept", 500],
  ] as const)("preserves %s action for entry %i (%s, HTTP %i)", async (side, id, action, status) => {
    const spy = mockFetch([
      { test: urlContains("/api/transactions"), respond: () => jsonResponse([
        buildTransaction({ id: 1, dedupGroupId: "g1", dedupResolution: "pending" }),
        buildTransaction({ id: 2, dedupGroupId: "g1", dedupResolution: "pending" }),
      ]) },
      { test: urlContains("/resolve-dedup", "POST"), respond: () => jsonResponse({}, status) },
    ]);
    renderWithProviders(<DedupReview />);
    const buttons = await screen.findAllByRole("button", { name: "Keep this one" });
    await userEvent.click(side === "distinct" ? screen.getByRole("button", { name: "Confirm distinct" }) : buttons[side === "left" ? 0 : 1]);
    await vi.waitFor(() => expect(status === 200 ? showSuccess : showError).toHaveBeenCalledWith(status === 200 ? "Resolved" : "Couldn't resolve this pair."));
    const calls = spy.mock.calls.filter(([url]) => String(url).includes("resolve-dedup"));
    expect(calls).toHaveLength(1);
    expect(String(calls[0][0])).toContain(`/api/transactions/${id}/resolve-dedup`);
    expect(JSON.parse(calls[0][1]!.body as string)).toEqual({ action });
    if (status === 200) {
      await vi.waitFor(() => expect(spy.mock.calls.filter(([url, init]) => String(url).endsWith("/api/transactions") && (!init?.method || init.method === "GET"))).toHaveLength(2));
    }
  });

  test("bulk partial failure clears selection, refreshes transactions and reports both outcomes", async () => {
    const spy = mockFetch([
      { test: urlContains("/api/transactions"), respond: () => jsonResponse(
        Array.from({ length: 4 }, (_, i) => buildTransaction({ id: i + 1, dedupGroupId: `g${Math.floor(i / 2)}`, dedupResolution: "pending" }))
      ) },
      { test: urlContains("/1/resolve-dedup", "POST"), respond: () => jsonResponse({}) },
      { test: urlContains("/3/resolve-dedup", "POST"), respond: () => jsonResponse({}, 500) },
    ]);
    renderWithProviders(<DedupReview />);
    for (const checkbox of await screen.findAllByRole("checkbox")) await userEvent.click(checkbox);
    await userEvent.click(screen.getByRole("button", { name: "Confirm selected as distinct" }));
    await vi.waitFor(() => expect(showError).toHaveBeenCalledWith("Confirmed 1 pair, 1 failed"));
    expect(screen.getByRole("button", { name: "Confirm selected as distinct" })).toBeDisabled();
    for (const checkbox of screen.getAllByRole("checkbox")) expect(checkbox).not.toBeChecked();
    const calls = spy.mock.calls.filter(([url]) => String(url).includes("resolve-dedup"));
    expect(calls).toHaveLength(2);
    for (const [, init] of calls) expect(JSON.parse(init!.body as string)).toEqual({ action: "confirmed_distinct" });
    await vi.waitFor(() => expect(spy.mock.calls.filter(([url]) => String(url).endsWith("/api/transactions"))).toHaveLength(2));
  });
  test.each([
    [{}, ["Same amount", "Same date", "Same source", "Same vendor string"]],
    [{ amount: 2000, date: "2026-11-02", source: "statement_import", vendorRaw: "X" }, ["Different amount", "Different date", "Different source", "Different vendor string"]],
    [{ date: "2026-11-03", source: "manual_missed" }, ["Same amount", "Different date", "Different source", "Same vendor string"]],
  ] as [Partial<Transaction>, string[]][])("compares actual transaction fields: %j", async (overrides, labels) => {
    mockFetch([{ test: urlContains("/api/transactions"), respond: () => jsonResponse([
      buildTransaction({ id: 1, dedupGroupId: "g1", dedupResolution: "pending" }),
      buildTransaction({ id: 2, dedupGroupId: "g1", dedupResolution: "pending", ...overrides }),
    ]) }]);
    renderWithProviders(<DedupReview />);
    for (const label of labels) expect(await screen.findByText(label)).toBeVisible();
  });

  test("explains the consequence of each pair action", async () => {
    mockFetch([{ test: urlContains("/api/transactions"), respond: () => jsonResponse([
      buildTransaction({ id: 1, dedupGroupId: "g1", dedupResolution: "pending" }),
      buildTransaction({ id: 2, dedupGroupId: "g1", dedupResolution: "pending" }),
    ]) }]);
    renderWithProviders(<DedupReview />);
    expect(await screen.findByText("Keeps entry A and discards entry B.")).toBeVisible();
    expect(screen.getByText("Keeps entry B and discards entry A.")).toBeVisible();
    expect(screen.getByRole("button", { name: "Confirm distinct" })).toHaveAccessibleDescription("Keeps both entries and clears this duplicate flag.");
    expect(screen.getByRole("button", { name: "Keep this one", description: "Keeps entry A and discards entry B." })).toBeVisible();
  });

  test("shows waiting and selected counts and clears the selected count on deselection", async () => {
    mockFetch([{ test: urlContains("/api/transactions"), respond: () => jsonResponse(
      Array.from({ length: 4 }, (_, i) => buildTransaction({ id: i + 1, dedupGroupId: `g${Math.floor(i / 2)}`, dedupResolution: "pending" }))
    ) }]);
    renderWithProviders(<DedupReview />);
    expect(await screen.findByText("2 pairs waiting")).toBeVisible();
    const checkboxes = screen.getAllByRole("checkbox");
    await userEvent.click(checkboxes[0]);
    expect(screen.getByText("1 pair selected")).toBeVisible();
    await userEvent.click(checkboxes[1]);
    expect(screen.getByText("2 pairs selected")).toBeVisible();
    expect(screen.getByText("Confirming distinct keeps both entries in every selected pair.")).toBeVisible();
    await userEvent.click(checkboxes[0]);
    await userEvent.click(checkboxes[1]);
    expect(screen.queryByText(/pairs? selected$/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Confirm selected as distinct" })).toBeDisabled();
  });
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
    expect((await screen.findByText("No duplicates to review.")).closest(".min-h-\\[55vh\\]")).toHaveClass("items-center", "justify-center");
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
