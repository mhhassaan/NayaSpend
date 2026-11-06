import { render, screen } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import { Logo } from "./Logo";

describe("Logo", () => {
  test("renders just the scalable mark for the mark variant", () => {
    const { container } = render(<Logo variant="mark" className="h-8 w-8" />);
    const svg = container.querySelector("svg");
    expect(svg).toHaveAttribute("viewBox", "0 0 64 64");
    expect(svg).not.toHaveAttribute("width");
    expect(svg).not.toHaveAttribute("height");
    expect(container.firstElementChild).toHaveClass("h-8", "w-8");
    expect(screen.queryByText("NayaSpend")).not.toBeInTheDocument();
  });

  test.each(["lockup", undefined] as const)("renders the mark and HTML wordmark for variant %s", (variant) => {
    const { container } = render(<Logo variant={variant} />);
    expect(container.querySelector("svg")).toHaveAttribute("viewBox", "0 0 64 64");
    expect(screen.getByText("NayaSpend").tagName).toBe("SPAN");
  });
});
