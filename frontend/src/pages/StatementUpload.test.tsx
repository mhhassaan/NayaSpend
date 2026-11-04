import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, test, vi } from "vitest";
import { StatementUpload } from "./StatementUpload";
import { renderWithProviders, mockFetch, jsonResponse, urlContains } from "../../test/helpers";
import { showSuccess } from "../components";

vi.mock("../components", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../components")>();
  return { ...actual, showError: vi.fn(), showSuccess: vi.fn() };
});

describe("StatementUpload", () => {
  test("uploading a CSV posts multipart form data and shows the imported count", async () => {
    mockFetch([{ test: urlContains("/api/statements", "POST"), respond: () => jsonResponse({ imported: 5 }, 201) }]);
    renderWithProviders(<StatementUpload />);
    const file = new File(["Date,Description,Amount\n2026-10-27,Starbucks,12.50"], "statement.csv", { type: "text/csv" });
    await userEvent.upload(screen.getByLabelText(/choose file/i), file);
    await userEvent.click(screen.getByRole("button", { name: /upload/i }));
    expect(await screen.findByText(/5/)).toBeInTheDocument();
    await vi.waitFor(() => expect(showSuccess).toHaveBeenCalledOnce());
  });

  test("a non-CSV file is rejected client-side before any request is made", async () => {
    const spy = mockFetch([]);
    renderWithProviders(<StatementUpload />);
    const file = new File(["not a csv"], "statement.pdf", { type: "application/pdf" });
    await userEvent.upload(screen.getByLabelText(/choose file/i), file);
    await userEvent.click(screen.getByRole("button", { name: /upload/i }));
    expect(await screen.findByText(/must be a csv/i)).toBeInTheDocument();
    expect(spy).not.toHaveBeenCalled();
  });

  test("[Review Focus] the uploaded file's own row content is never rendered back, even for a successful import", async () => {
    mockFetch([{ test: urlContains("/api/statements", "POST"), respond: () => jsonResponse({ imported: 1 }, 201) }]);
    renderWithProviders(<StatementUpload />);
    const file = new File(["Date,Description,Amount\n2026-10-27,Acct 1234567890,12.50"], "statement.csv", { type: "text/csv" });
    await userEvent.upload(screen.getByLabelText(/choose file/i), file);
    await userEvent.click(screen.getByRole("button", { name: /upload/i }));
    await screen.findByText(/1/);
    expect(screen.queryByText(/1234567890/)).not.toBeInTheDocument();
  });

  test("a backend rejection (422) surfaces the exact reason", async () => {
    mockFetch([
      { test: urlContains("/api/statements", "POST"), respond: () => new Response("file has no data rows to import", { status: 422 }) },
    ]);
    renderWithProviders(<StatementUpload />);
    const file = new File(["Date,Description,Amount\n"], "empty.csv", { type: "text/csv" });
    await userEvent.upload(screen.getByLabelText(/choose file/i), file);
    await userEvent.click(screen.getByRole("button", { name: /upload/i }));
    expect(await screen.findByText(/no data rows to import/i)).toBeInTheDocument();
  });
});
