import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import { Modal } from "./Modal";

describe("Modal", () => {
  test("renders its children only when open", () => {
    const { rerender } = render(<Modal open={false} onClose={vi.fn()}>Content</Modal>);
    expect(screen.queryByText("Content")).not.toBeInTheDocument();

    rerender(<Modal open={true} onClose={vi.fn()}>Content</Modal>);
    expect(screen.getByText("Content")).toBeInTheDocument();
  });

  test("calls onClose when the overlay is clicked", () => {
    const onClose = vi.fn();
    render(<Modal open={true} onClose={onClose}>Content</Modal>);
    fireEvent.click(screen.getByTestId("modal-overlay"));
    expect(onClose).toHaveBeenCalledOnce();
  });
});
