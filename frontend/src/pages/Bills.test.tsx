import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, test, vi } from "vitest";
import { Bills } from "./Bills";
import { renderWithProviders, mockFetch, jsonResponse, urlContains } from "../../test/helpers";
import { showError, showSuccess } from "../components";
import type { Bill } from "../types/transaction";

vi.mock("../components", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../components")>();
  return { ...actual, showError: vi.fn(), showSuccess: vi.fn() };
});

function buildBill(overrides: Partial<Bill> = {}): Bill {
  return {
    id: 1,
    vendor: "Netflix",
    expectedAmount: 150000,
    expectedInterval: "monthly",
    nextDueDate: "2026-11-15",
    lastReminderSentForDueDate: null,
    ...overrides,
  };
}

describe("Bills", () => {
  test("shows a skeleton, then bills with a due-date Pill", async () => {
    mockFetch([{ test: urlContains("/api/bills", "GET"), respond: () => jsonResponse([buildBill({ vendor: "Netflix", nextDueDate: "2026-11-15" })]) }]);
    renderWithProviders(<Bills />);
    expect(screen.getByTestId("bills-skeleton")).toBeInTheDocument();
    expect(await screen.findByText("Netflix")).toBeInTheDocument();
    expect(screen.getByText("2026-11-15")).toBeInTheDocument();
  });

  test("shows an empty state when there are no bills", async () => {
    mockFetch([{ test: urlContains("/api/bills", "GET"), respond: () => jsonResponse([]) }]);
    renderWithProviders(<Bills />);
    expect(await screen.findByRole("button", { name: /add bill/i })).toBeInTheDocument();
    expect((await screen.findByText("No bills yet.")).closest(".min-h-\\[55vh\\]")).toHaveClass("items-center", "justify-center");
  });

  test("creating a bill with a malformed due date is rejected client-side", async () => {
    const spy = mockFetch([{ test: urlContains("/api/bills", "GET"), respond: () => jsonResponse([]) }]);
    renderWithProviders(<Bills />);
    await userEvent.click(await screen.findByRole("button", { name: /add bill/i }));
    await userEvent.type(screen.getByLabelText(/vendor/i), "Spotify");
    await userEvent.type(screen.getByLabelText(/expected amount/i), "500");
    await userEvent.type(screen.getByLabelText(/next due date/i), "not-a-date");
    await userEvent.click(screen.getByRole("button", { name: /save/i }));
    expect(await screen.findByText(/valid.*date/i)).toBeInTheDocument();
    expect(spy.mock.calls.every(([, init]) => (init?.method ?? "GET") !== "POST")).toBe(true);
  });

  test("creating a bill converts the typed rupee amount to cents before posting", async () => {
    const spy = mockFetch([
      { test: urlContains("/api/bills", "GET"), respond: () => jsonResponse([]) },
      { test: urlContains("/api/bills", "POST"), respond: () => jsonResponse(buildBill({ id: 2, vendor: "Spotify", expectedAmount: 50000 }), 201) },
    ]);
    renderWithProviders(<Bills />);
    await userEvent.click(await screen.findByRole("button", { name: /add bill/i }));
    await userEvent.type(screen.getByLabelText(/vendor/i), "Spotify");
    await userEvent.type(screen.getByLabelText(/expected amount/i), "500");
    await userEvent.type(screen.getByLabelText(/expected interval/i), "monthly");
    await userEvent.type(screen.getByLabelText(/next due date/i), "2026-12-01");
    await userEvent.click(screen.getByRole("button", { name: /save/i }));
    await vi.waitFor(() => {
      const postCall = spy.mock.calls.find(([, init]) => init?.method === "POST");
      expect(postCall).toBeDefined();
      const body = JSON.parse(postCall![1]!.body as string);
      expect(body.expectedAmount).toBe(50000);
    });
  });

  test("editing a bill's expected amount pre-fills the rupee value and converts back to cents on save", async () => {
    const spy = mockFetch([
      { test: urlContains("/api/bills", "GET"), respond: () => jsonResponse([buildBill({ id: 1, expectedAmount: 150000 })]) },
      { test: urlContains("/api/bills/1", "PATCH"), respond: () => jsonResponse(buildBill({ id: 1, expectedAmount: 200000 })) },
    ]);
    renderWithProviders(<Bills />);
    await userEvent.click(await screen.findByRole("button", { name: /edit/i }));
    const amountInput = screen.getByLabelText(/expected amount/i) as HTMLInputElement;
    expect(amountInput.value).toBe("1500");
    await userEvent.clear(amountInput);
    await userEvent.type(amountInput, "2000");
    await userEvent.click(screen.getByRole("button", { name: /save/i }));
    await vi.waitFor(() => {
      const patchCall = spy.mock.calls.find(([, init]) => init?.method === "PATCH");
      expect(patchCall).toBeDefined();
      const body = JSON.parse(patchCall![1]!.body as string);
      expect(body.expectedAmount).toBe(200000);
    });
  });

  test("[Review Focus] a failed page load shows the error block and toasts once", async () => {
    mockFetch([{ test: urlContains("/api/bills", "GET"), respond: () => new Response("fail", { status: 500 }) }]);
    renderWithProviders(<Bills />);
    expect(await screen.findByRole("button", { name: /retry/i })).toBeInTheDocument();
    await vi.waitFor(() => expect(showError).toHaveBeenCalledOnce());
  });

  test("[break-ui] a long vendor name and a huge expected amount render in full", async () => {
    const longVendor = "Senior Product Design Engineer Platform Infrastructure Holdings Insurance Co.";
    mockFetch([{ test: urlContains("/api/bills", "GET"), respond: () => jsonResponse([buildBill({ vendor: longVendor, expectedAmount: 99999999 })]) }]);
    renderWithProviders(<Bills />);
    expect(await screen.findByText(longVendor)).toBeInTheDocument();
    expect(screen.getByText("Rs. 999,999.99")).toBeInTheDocument();
  });

  test("editing a bill's next due date calls PATCH and toasts success", async () => {
    const spy = mockFetch([
      { test: urlContains("/api/bills", "GET"), respond: () => jsonResponse([buildBill({ id: 1, nextDueDate: "2026-11-15" })]) },
      { test: urlContains("/api/bills/1", "PATCH"), respond: () => jsonResponse(buildBill({ id: 1, nextDueDate: "2026-12-15" })) },
    ]);
    renderWithProviders(<Bills />);
    await userEvent.click(await screen.findByRole("button", { name: /edit/i }));
    await userEvent.clear(screen.getByLabelText(/next due date/i));
    await userEvent.type(screen.getByLabelText(/next due date/i), "2026-12-15");
    await userEvent.click(screen.getByRole("button", { name: /save/i }));
    await vi.waitFor(() => expect(showSuccess).toHaveBeenCalledOnce());
    expect(spy.mock.calls.some(([url, init]) => String(url).includes("/api/bills/1") && init?.method === "PATCH")).toBe(true);
  });
});
