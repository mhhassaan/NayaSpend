import { render, screen } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import { ListReveal } from "./ListReveal";

describe("ListReveal", () => {
  test("renders every item passed in, in order", () => {
    render(<ListReveal items={[<div key="a" data-testid="a" />, <div key="b" data-testid="b" />]} />);
    const a = screen.getByTestId("a");
    const b = screen.getByTestId("b");
    expect(a).toBeInTheDocument();
    expect(b).toBeInTheDocument();
    expect(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  test("[Review Focus] re-rendering with the same items does not replay the reveal animation on re-render", () => {
    const { rerender } = render(<ListReveal items={[<div key="a" data-testid="a">x</div>]} />);
    const wrapper = screen.getByTestId("a").parentElement!;
    const firstStyle = wrapper.getAttribute("style");
    rerender(<ListReveal items={[<div key="a" data-testid="a">x</div>]} />);
    expect(screen.getByTestId("a").parentElement).toBe(wrapper);
    expect(wrapper.getAttribute("style")).toBe(firstStyle);
  });
});
