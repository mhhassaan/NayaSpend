import { act, render, screen } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import { ToastProvider, showError, showSuccess } from "./ToastProvider";

describe("ToastProvider", () => {
  test("showError renders a toast styled with the danger token class", async () => {
    render(<ToastProvider />);
    act(() => {
      showError("Something failed");
    });
    const toastEl = await screen.findByText("Something failed");
    expect(toastEl.closest("[data-sonner-toast]")).toHaveClass("toast-danger");
  });

  test("showSuccess renders a toast styled with the success token class", async () => {
    render(<ToastProvider />);
    act(() => {
      showSuccess("Saved");
    });
    const toastEl = await screen.findByText("Saved");
    expect(toastEl.closest("[data-sonner-toast]")).toHaveClass("toast-success");
  });
});
