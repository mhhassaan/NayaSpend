import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import { EmptyState } from "./EmptyState";

describe("EmptyState", () => {
  test("renders a passed-in icon node", () => {
    render(<EmptyState icon={<svg data-testid="my-icon" />} message="x" />);
    expect(screen.getByTestId("my-icon")).toBeInTheDocument();
  });

  test("renders its message and an optional action button", () => {
    const onAction = vi.fn();
    render(<EmptyState message="No budgets yet" actionLabel="Create one" onAction={onAction} />);
    expect(screen.getByText("No budgets yet")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Create one" }));
    expect(onAction).toHaveBeenCalledOnce();
  });

  test("renders without an action when none is given", () => {
    render(<EmptyState message="Nothing here" />);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});
