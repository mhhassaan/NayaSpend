import { render, screen } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import { Card } from "./Card";

describe("Card", () => {
  test("renders its children inside a surface-background, rounded container", () => {
    render(<Card>Hello</Card>);
    const card = screen.getByText("Hello");
    expect(card.className).toContain("bg-bg-surface");
    expect(card.className).toContain("rounded-xl");
  });
});
