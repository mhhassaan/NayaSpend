import { render, screen } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import { Pill } from "./Pill";

describe("Pill", () => {
  test("renders its label with a pill shape", () => {
    render(<Pill>Coffee</Pill>);
    expect(screen.getByText("Coffee").className).toContain("rounded-full");
  });

  test("applies the danger tone's color token", () => {
    render(<Pill tone="danger">Discarded</Pill>);
    expect(screen.getByText("Discarded").className).toContain("danger");
  });
});
