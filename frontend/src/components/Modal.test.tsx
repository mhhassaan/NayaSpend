import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import { Modal } from "./Modal";

describe("Modal", () => {
  test("[Review Focus] closing the modal eventually removes it from the DOM (exit animation does not leave a stuck overlay)", async () => {
    const { rerender } = render(<Modal open={true} onClose={() => {}}><p>content</p></Modal>);
    expect(screen.getByTestId("modal-overlay")).toBeInTheDocument();
    rerender(<Modal open={false} onClose={() => {}}><p>content</p></Modal>);
    await waitFor(() => expect(screen.queryByTestId("modal-overlay")).not.toBeInTheDocument());
  });

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
