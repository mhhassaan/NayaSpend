import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import { TransactionDetailPanel } from "./TransactionDetailPanel";
import { renderWithProviders, mockFetch, jsonResponse, urlContains } from "../../test/helpers";
import type { Transaction } from "../types/transaction";
import { useReducedMotion } from "motion/react";

vi.mock("motion/react", async importOriginal => {
  const actual = await importOriginal<typeof import("motion/react")>();
  return { ...actual, useReducedMotion: vi.fn(() => false) };
});

const row: Transaction = { id: 1, amount: -100, date: "2026-11-01", vendorRaw: "Store", vendorNormalized: "store", category: "Uncategorized", source: "manual_missed", provenance: "{}", reviewStatus: "committed", dedupGroupId: null, dedupResolution: null, deletedAt: null, gmailMessageId: null, statementRowKey: null };
const categorySuggestion = { category: "Health", suggestedAt: "2026-11-01", model: "deepseek-chat" };
test("accepting uses the existing category correction endpoint", async () => {
  const spy = mockFetch([{ test: urlContains("/category", "PATCH"), respond: () => jsonResponse({}) }]);
  renderWithProviders(<TransactionDetailPanel transaction={{ ...row, suggestion: categorySuggestion, suggestionStatus: "pending" }} onClose={vi.fn()} />);
  expect(screen.getByText("AI suggestion - check before accepting")).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "Accept" }));
  await waitFor(() => expect(spy).toHaveBeenCalledOnce());
  expect(JSON.parse(spy.mock.calls[0][1]!.body as string)).toEqual({ category: "Health" });
});
test("apply fills the review form without committing", async () => {
  const spy = mockFetch([]);
  renderWithProviders(<TransactionDetailPanel transaction={{ ...row, amount: 0, reviewStatus: "pending_review", source: "gmail_email", provenance: '{"quarantineReason":"parse failed"}', suggestionStatus: "pending", suggestion: { vendor: "Cafe", amount: 125050, direction: "out", suggestedAt: "2026-11-01", model: "deepseek-chat" } }} onClose={vi.fn()} />);
  expect(screen.getByText(/Rs\. 1,250\.50/)).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "Apply suggestion" }));
  expect(screen.getByLabelText("Vendor")).toHaveValue("Cafe");
  expect(screen.getByLabelText("Amount")).toHaveValue("1250.5");
  expect(spy).not.toHaveBeenCalled();
});
test("dismiss clears the suggested card", async () => {
  const spy = mockFetch([{ test: urlContains("/suggestion", "DELETE"), respond: () => jsonResponse({}) }]);
  renderWithProviders(<TransactionDetailPanel transaction={{ ...row, suggestion: categorySuggestion, suggestionStatus: "pending" }} onClose={vi.fn()} />);
  await userEvent.click(screen.getByRole("button", { name: "Dismiss" }));
  await waitFor(() => expect(screen.queryByText("Suggested category: Health")).not.toBeInTheDocument());
  expect(spy).toHaveBeenCalledOnce();
});
test("no suggestion hides card and Suggest retrieves one", async () => {
  mockFetch([{ test: urlContains("/suggestion", "POST"), respond: () => jsonResponse({ suggestion: categorySuggestion }) }]);
  renderWithProviders(<TransactionDetailPanel transaction={row} onClose={vi.fn()} />);
  expect(screen.queryByText("AI suggestion - check before accepting")).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "Suggest" }));
  expect(await screen.findByText("Suggested category: Health")).toBeInTheDocument();
});
test("Suggest is disabled during a request and reports a friendly failure", async () => {
  let resolve!: (value: Response) => void;
  mockFetch([{ test: urlContains("/suggestion", "POST"), respond: () => new Promise<Response>(done => { resolve = done; }) }]);
  renderWithProviders(<TransactionDetailPanel transaction={row} onClose={vi.fn()} />);
  await userEvent.click(screen.getByRole("button", { name: "Suggest" }));
  expect(screen.getByRole("button", { name: "Suggesting..." })).toBeDisabled();
  resolve(new Response("fail", { status: 500 }));
  expect(await screen.findByRole("status")).toHaveTextContent("Couldn't get a suggestion. Please try again.");
  expect(screen.queryByRole("region", { name: "Suggested" })).not.toBeInTheDocument();
});
test("no result explains that manual editing is still available", async () => {
  mockFetch([{ test: urlContains("/suggestion", "POST"), respond: () => jsonResponse({ suggestion: null }) }]);
  renderWithProviders(<TransactionDetailPanel transaction={row} onClose={vi.fn()} />);
  await userEvent.click(screen.getByRole("button", { name: "Suggest" }));
  expect(await screen.findByRole("status")).toHaveTextContent("No suggestion available right now.");
});
test("reduced motion renders the card without an entry transform", () => {
  vi.mocked(useReducedMotion).mockReturnValue(true);
  renderWithProviders(<TransactionDetailPanel transaction={{ ...row, suggestion: categorySuggestion, suggestionStatus: "pending" }} onClose={vi.fn()} />);
  expect(screen.getByRole("region", { name: "Suggested" })).toHaveStyle({ opacity: "1", transform: "translateY(0px)" });
});
