import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, test, vi } from "vitest";
import { toPng } from "html-to-image";
import { ShareRecapModal } from "./ShareRecapModal";

vi.mock("html-to-image", () => ({ toPng: vi.fn() }));

const props = {
  open: true,
  onClose: vi.fn(),
  month: "2026-10",
  spentCents: 5000000,
  byCategory: [{ category: "Food & Dining", totalCents: 5000000 }],
};

describe("ShareRecapModal", () => {
  test("defaults to percentages, switches modes, and can close", async () => {
    render(<ShareRecapModal {...props} />);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Percentages only" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText("DEFAULT / PRIVATE")).toBeInTheDocument();
    expect(screen.getByLabelText("Spending recap").textContent).not.toContain("Rs");
    await userEvent.click(screen.getByRole("button", { name: "With amounts" }));
    expect(screen.getByRole("button", { name: "With amounts" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByLabelText("Spending recap")).toHaveTextContent("Rs. 50,000.00");
    await userEvent.click(screen.getByRole("button", { name: "Percentages only" }));
    expect(screen.getByLabelText("Spending recap").textContent).not.toContain("Rs");
    await userEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(props.onClose).toHaveBeenCalledOnce();
  });

  test("exports only the card to PNG and triggers the month-named download", async () => {
    vi.mocked(toPng).mockResolvedValue("data:image/png;base64,example");
    const downloads: HTMLAnchorElement[] = [];
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
      downloads.push(this);
    });
    render(<ShareRecapModal {...props} />);
    await userEvent.click(screen.getByRole("button", { name: "Download image" }));
    await waitFor(() => expect(toPng).toHaveBeenCalledOnce());
    const node = vi.mocked(toPng).mock.calls[0][0];
    expect(node).toContainElement(screen.getByLabelText("Spending recap"));
    expect(node.textContent).not.toMatch(/Rs|Download image|Percentages only|With amounts/);
    await waitFor(() => expect(click).toHaveBeenCalledOnce());
    const anchor = downloads[0];
    expect(anchor.download).toBe("nayaspend-recap-2026-10.png");
    expect(anchor.href).toBe("data:image/png;base64,example");
    expect(anchor).not.toBeInTheDocument();
  });

  test("shows an export error and allows retrying", async () => {
    vi.mocked(toPng).mockRejectedValueOnce(new Error("Image failed"));
    render(<ShareRecapModal {...props} />);
    await userEvent.click(screen.getByRole("button", { name: "Download image" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't download your recap. Please try again.");
    expect(screen.getByRole("button", { name: "Download image" })).toBeEnabled();
  });

  test("hides content while closed and restores private mode for a new opening", async () => {
    const { rerender } = render(<ShareRecapModal {...props} />);
    await userEvent.click(screen.getByRole("button", { name: "With amounts" }));
    rerender(<ShareRecapModal {...props} open={false} />);
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    rerender(<ShareRecapModal {...props} />);
    expect(screen.getByLabelText("Spending recap").textContent).not.toContain("Rs");
  });
});
