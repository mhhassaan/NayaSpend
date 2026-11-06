import { render, screen } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import { Tile } from "./Tile";

describe("Tile", () => {
  test("renders an icon, label and trailing arrow in a horizontal action", () => {
    render(<Tile icon={<svg data-testid="icon" />} label="Budgets" />);
    expect(screen.getByTestId("icon")).toBeInTheDocument();
    expect(screen.getByText("Budgets")).toBeInTheDocument();
    const button = screen.getByRole("button", { name: "Budgets" });
    expect(button).not.toHaveClass("flex-col");
    expect(button).toHaveClass("text-left", "border", "active:scale-[0.96]");
    expect(screen.getByText("->")).toHaveAttribute("aria-hidden", "true");
    expect(button.lastElementChild).toBe(screen.getByText("->"));
  });

  test("calls onClick when pressed", () => {
    let clicked = false;
    render(<Tile icon={<svg />} label="Bills" onClick={() => { clicked = true; }} />);
    screen.getByText("Bills").closest("button")!.click();
    expect(clicked).toBe(true);
  });
});
