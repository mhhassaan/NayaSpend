import { act, fireEvent, screen, within } from "@testing-library/react";
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
  test("dropping a CSV uploads it and shows the imported count", async () => {
    mockFetch([{ test: urlContains("/api/statements", "POST"), respond: () => jsonResponse({ imported: 5 }, 201) }]);
    renderWithProviders(<StatementUpload />);
    const file = new File(["Date,Description,Amount\n2026-10-27,Starbucks,12.50"], "statement.csv", { type: "text/csv" });
    fireEvent.drop(screen.getByRole("region", { name: /statement file drop zone/i }), { dataTransfer: { files: [file] } });
    await userEvent.click(screen.getByRole("button", { name: /upload/i }));
    expect(await screen.findByText("Imported 5 rows")).toHaveClass("text-success");
    expect(within(screen.getByRole("status")).getByTestId("success-icon")).toBeInTheDocument();
    await vi.waitFor(() => expect(showSuccess).toHaveBeenCalledOnce());
  });

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

  test("[break-ui] a long backend rejection message renders in full, not truncated", async () => {
    const longMessage =
      "file has no data rows to import: every row after the header failed to parse because the Date column did not match any of the supported formats (YYYY-MM-DD, DD/MM/YYYY, MM-DD-YYYY)";
    mockFetch([{ test: urlContains("/api/statements", "POST"), respond: () => new Response(longMessage, { status: 422 }) }]);
    renderWithProviders(<StatementUpload />);
    const file = new File(["Date,Description,Amount\nbad,row,1"], "statement.csv", { type: "text/csv" });
    await userEvent.upload(screen.getByLabelText(/choose file/i), file);
    await userEvent.click(screen.getByRole("button", { name: /upload/i }));
    expect(await screen.findByText(longMessage)).toBeInTheDocument();
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
    const panel = screen.getByRole("alert");
    expect(within(panel).getByTestId("error-icon")).toBeInTheDocument();
    expect(within(panel).getByText("Failed")).toHaveClass("text-danger");
  });
});


test("shows disabled importing feedback and advances illustrative steps while awaiting the response", async () => {
  let resolveRequest!: (response: Response) => void;
  const response = new Promise<Response>((resolve) => { resolveRequest = resolve; });
  const spy = mockFetch([{ test: urlContains("/api/statements", "POST"), respond: () => response }]);
  renderWithProviders(<StatementUpload />);
  await userEvent.upload(screen.getByLabelText(/choose file/i), new File(["Date,Description,Amount"], "statement.csv", { type: "text/csv" }));
  await userEvent.click(screen.getByRole("button", { name: "Upload" }));
  const button = await screen.findByRole("button", { name: "Importing..." });
  expect(button).toBeDisabled();
  expect(within(button).getByTestId("pending-icon")).toHaveClass("animate-spin");
  const steps = screen.getByRole("list", { name: "Import activity" });
  expect(within(steps).getByText("Uploading").closest("li")).toHaveAttribute("aria-current", "step");
  expect(within(steps).getByText("Parsing rows")).toBeInTheDocument();
  expect(within(steps).getByText("Importing")).toBeInTheDocument();
  await vi.waitFor(() => expect(within(steps).getByText("Importing").closest("li")).toHaveAttribute("aria-current", "step"), { timeout: 3000 });
  expect(within(steps).getAllByTestId("step-complete-icon")).toHaveLength(2);
  expect(button).toBeDisabled();
  await userEvent.click(button);
  expect(spy).toHaveBeenCalledTimes(1);
  await act(async () => { resolveRequest(jsonResponse({ imported: 5 }, 201)); });
  expect(await screen.findByText("Imported 5 rows")).toHaveClass("text-success");
  expect(screen.getByRole("button", { name: "Upload" })).toBeEnabled();
  expect(screen.queryByRole("list", { name: "Import activity" })).not.toBeInTheDocument();
});
