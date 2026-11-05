import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, test, vi } from "vitest";
import { Budgets } from "./Budgets";
import { renderWithProviders, mockFetch, jsonResponse, urlContains } from "../../test/helpers";
import { showError, showSuccess } from "../components";

vi.mock("../components", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../components")>();
  return { ...actual, showError: vi.fn(), showSuccess: vi.fn() };
});

function trendsResponse() {
  return {
    month: new Date().toISOString().slice(0, 7),
    spentCents: 8000,
    receivedCents: 0,
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

  test("creating a budget converts the typed rupee amount to cents before posting", async () => {
    const spy = mockFetch([
      { test: urlContains("/api/budgets", "GET"), respond: () => jsonResponse([]) },
      { test: urlContains("/api/trends", "GET"), respond: () => jsonResponse(trendsResponse()) },
      { test: urlContains("/api/budgets", "POST"), respond: () => jsonResponse({ id: 1, category: "Rent", limitAmount: 500000, periodType: "monthly" }, 201) },
    ]);
    renderWithProviders(<Budgets />);
    await userEvent.click(await screen.findByRole("button", { name: /create budget/i }));
    await userEvent.type(screen.getByLabelText(/category/i), "Rent");
    await userEvent.type(screen.getByLabelText(/limit/i), "5000");
    await userEvent.click(screen.getByRole("button", { name: /save/i }));
    await vi.waitFor(() => {
      const postCall = spy.mock.calls.find(([, init]) => init?.method === "POST");
      expect(postCall).toBeDefined();
      const body = JSON.parse(postCall![1]!.body as string);
      expect(body.limitAmount).toBe(500000);
    });
  });

  test("[break-ui] spending past the limit shows a percentage over 100% instead of clamping or breaking", async () => {
    mockFetch([
      { test: urlContains("/api/budgets", "GET"), respond: () => jsonResponse([{ id: 1, category: "Coffee", limitAmount: 10000, periodType: "monthly", lastAlertedThreshold: null, lastAlertedPeriodStart: null }]) },
      {
        test: urlContains("/api/trends", "GET"),
        respond: () => jsonResponse({ month: new Date().toISOString().slice(0, 7), spentCents: 14200, receivedCents: 0, byCategory: [{ category: "Coffee", totalCents: 14200 }], hasData: true }),
      },
    ]);
    renderWithProviders(<Budgets />);
    expect(await screen.findByText(/142%/)).toBeInTheDocument();
  });

  test("[Review Focus] a failed page load shows the error block and toasts once", async () => {
    mockFetch([
      { test: urlContains("/api/budgets", "GET"), respond: () => new Response("fail", { status: 500 }) },
      { test: urlContains("/api/trends", "GET"), respond: () => jsonResponse(trendsResponse()) },
    ]);
    renderWithProviders(<Budgets />);
    expect(await screen.findByRole("button", { name: /retry/i })).toBeInTheDocument();
    await vi.waitFor(() => expect(showError).toHaveBeenCalledOnce());
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
