import { render, screen } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import { Tile } from "./Tile";

describe("Tile", () => {
  test("renders an icon slot and a caption label", () => {
    render(<Tile icon={<svg data-testid="icon" />} label="Budgets" />);
    expect(screen.getByTestId("icon")).toBeInTheDocument();
    expect(screen.getByText("Budgets")).toBeInTheDocument();
  });

  test("calls onClick when pressed", () => {
    let clicked = false;
    render(<Tile icon={<svg />} label="Bills" onClick={() => { clicked = true; }} />);
    screen.getByText("Bills").closest("button")!.click();
    expect(clicked).toBe(true);
  });
});
