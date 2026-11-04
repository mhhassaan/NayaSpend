import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, test, vi } from "vitest";
import { Budgets } from "./Budgets";
import { renderWithProviders, mockFetch, jsonResponse, urlContains } from "../../test/helpers";
import { showSuccess } from "../components";

vi.mock("../components", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../components")>();
  return { ...actual, showError: vi.fn(), showSuccess: vi.fn() };
});

function trendsResponse() {
  return {
    month: new Date().toISOString().slice(0, 7),
    totalCents: 8000,
    byCategory: [{ category: "Coffee", totalCents: 8000 }],
    hasData: true,
  };
}

describe("Budgets", () => {
  test("shows a skeleton, then budgets with a spent-vs-limit StatDisplay", async () => {
    mockFetch([
      { test: urlContains("/api/budgets", "GET"), respond: () => jsonResponse([{ id: 1, category: "Coffee", limitAmount: 10000, periodType: "monthly", lastAlertedThreshold: null, lastAlertedPeriodStart: null }]) },
      { test: urlContains("/api/trends", "GET"), respond: () => jsonResponse(trendsResponse()) },
    ]);
    renderWithProviders(<Budgets />);
    expect(screen.getByTestId("budgets-skeleton")).toBeInTheDocument();
    expect(await screen.findByText("Coffee")).toBeInTheDocument();
    expect(screen.getByText(/80%/)).toBeInTheDocument();
  });

  test("shows an empty state with a create action when there are no budgets", async () => {
    mockFetch([
      { test: urlContains("/api/budgets", "GET"), respond: () => jsonResponse([]) },
      { test: urlContains("/api/trends", "GET"), respond: () => jsonResponse(trendsResponse()) },
    ]);
    renderWithProviders(<Budgets />);
    expect(await screen.findByRole("button", { name: /create budget/i })).toBeInTheDocument();
    expect(await screen.findByText(/no budgets yet/i)).toBeInTheDocument();
  });

  test("creating a budget with a non-positive limit is rejected client-side with the backend's own message style", async () => {
    const spy = mockFetch([
      { test: urlContains("/api/budgets", "GET"), respond: () => jsonResponse([]) },
      { test: urlContains("/api/trends", "GET"), respond: () => jsonResponse(trendsResponse()) },
    ]);
    renderWithProviders(<Budgets />);
    await userEvent.click(await screen.findByRole("button", { name: /create budget/i }));
    await userEvent.type(screen.getByLabelText(/category/i), "Rent");
    await userEvent.type(screen.getByLabelText(/limit/i), "0");
    await userEvent.click(screen.getByRole("button", { name: /save/i }));
    expect(await screen.findByText(/positive integer/i)).toBeInTheDocument();
    expect(spy.mock.calls.every(([, init]) => (init?.method ?? "GET") !== "POST")).toBe(true);
  });

  test("deleting a budget asks for confirmation before calling delete", async () => {
    const spy = mockFetch([
      { test: urlContains("/api/budgets", "GET"), respond: () => jsonResponse([{ id: 1, category: "Coffee", limitAmount: 10000, periodType: "monthly", lastAlertedThreshold: null, lastAlertedPeriodStart: null }]) },
      { test: urlContains("/api/trends", "GET"), respond: () => jsonResponse(trendsResponse()) },
      { test: urlContains("/api/budgets/1", "DELETE"), respond: () => new Response(null, { status: 204 }) },
    ]);
    renderWithProviders(<Budgets />);
    await userEvent.click(await screen.findByRole("button", { name: /delete/i }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /confirm/i }));
    await vi.waitFor(() => expect(showSuccess).toHaveBeenCalledOnce());
    expect(spy.mock.calls.some(([url, init]) => String(url).includes("/api/budgets/1") && init?.method === "DELETE")).toBe(true);
  });
});
