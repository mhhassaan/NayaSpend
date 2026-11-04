import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, test, vi } from "vitest";
import { LogMissedTransaction } from "./LogMissedTransaction";
import { renderWithProviders, mockFetch, jsonResponse, urlContains } from "../../test/helpers";
import { showSuccess } from "../components";

vi.mock("../components", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../components")>();
  return { ...actual, showError: vi.fn(), showSuccess: vi.fn() };
});

describe("LogMissedTransaction", () => {
  test("submitting a valid entry posts to missed-transactions and shows a success message", async () => {
    mockFetch([
      { test: urlContains("/api/missed-transactions", "POST"), respond: () => jsonResponse({ id: 1, category: "Coffee" }, 201) },
    ]);
    renderWithProviders(<LogMissedTransaction />);
    await userEvent.type(screen.getByLabelText(/vendor/i), "Corner store");
    await userEvent.type(screen.getByLabelText(/amount/i), "10.00");
    await userEvent.type(screen.getByLabelText(/date/i), "2026-11-01");
    await userEvent.click(screen.getByRole("button", { name: /log transaction/i }));
    expect(await screen.findByText(/logged as coffee/i)).toBeInTheDocument();
    await vi.waitFor(() => expect(showSuccess).toHaveBeenCalledOnce());
  });

  test("a validation failure from the backend shows the error inline", async () => {
    mockFetch([
      {
        test: urlContains("/api/missed-transactions", "POST"),
        respond: () => new Response("amountCents must be a positive integer", { status: 400 }),
      },
    ]);
    renderWithProviders(<LogMissedTransaction />);
    await userEvent.type(screen.getByLabelText(/vendor/i), "x");
    await userEvent.type(screen.getByLabelText(/amount/i), "0");
    await userEvent.type(screen.getByLabelText(/date/i), "2026-11-01");
    await userEvent.click(screen.getByRole("button", { name: /log transaction/i }));
    expect(await screen.findByText(/amountCents must be a positive integer/i)).toBeInTheDocument();
  });

  test("[break-ui] a non-Latin vendor name and a fractional amount round-trip without NaN", async () => {
    const spy = mockFetch([
      { test: urlContains("/api/missed-transactions", "POST"), respond: () => jsonResponse({ id: 1, category: "Uncategorized" }, 201) },
    ]);
    renderWithProviders(<LogMissedTransaction />);
    await userEvent.type(screen.getByLabelText(/vendor/i), "نور الهدى عبد الرحمن");
    await userEvent.type(screen.getByLabelText(/amount/i), "12345678.9");
    await userEvent.type(screen.getByLabelText(/date/i), "2026-11-01");
    await userEvent.click(screen.getByRole("button", { name: /log transaction/i }));
    await screen.findByText(/logged as uncategorized/i);
    const [, init] = spy.mock.calls[0];
    const body = JSON.parse(init!.body as string);
    expect(body.amountCents).toBe(1234567890);
    expect(body.vendorRaw).toBe("نور الهدى عبد الرحمن");
  });

  test("the form resets after a successful submission", async () => {
    mockFetch([
      { test: urlContains("/api/missed-transactions", "POST"), respond: () => jsonResponse({ id: 1, category: "Coffee" }, 201) },
    ]);
    renderWithProviders(<LogMissedTransaction />);
    await userEvent.type(screen.getByLabelText(/vendor/i), "Corner store");
    await userEvent.type(screen.getByLabelText(/amount/i), "10.00");
    await userEvent.type(screen.getByLabelText(/date/i), "2026-11-01");
    await userEvent.click(screen.getByRole("button", { name: /log transaction/i }));
    await screen.findByText(/logged as coffee/i);
    expect(screen.getByLabelText(/vendor/i)).toHaveValue("");
  });
});
