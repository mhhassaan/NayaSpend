import { render, screen } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import { Button } from "./Button";

describe("Button", () => {
  test("renders the primary variant with the dark/accent button classes", () => {
    render(<Button variant="primary">Save</Button>);
    const button = screen.getByRole("button", { name: "Save" });
    expect(button.className).toContain("bg-blackberry");
  });

  test("renders the secondary variant", () => {
    render(<Button variant="secondary">Cancel</Button>);
    expect(screen.getByRole("button", { name: "Cancel" }).className).toContain("bg-hyper-white");
  });

  test("renders the danger variant", () => {
    render(<Button variant="danger">Discard</Button>);
    expect(screen.getByRole("button", { name: "Discard" }).className).toContain("bg-hot-red");
  });
});
