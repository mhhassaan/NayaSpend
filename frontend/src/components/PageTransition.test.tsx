import { render, screen } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import { PageTransition } from "./PageTransition";

describe("PageTransition", () => {
  test("renders its children", () => {
    render(<PageTransition><div>page content</div></PageTransition>);
    expect(screen.getByText("page content")).toBeInTheDocument();
  });
});
