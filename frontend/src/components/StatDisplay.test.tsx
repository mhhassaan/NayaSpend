import { render, screen } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import { StatDisplay } from "./StatDisplay";

describe("StatDisplay", () => {
  test("renders a label line and a large figure below it", () => {
    render(<StatDisplay label="This month" value="Rs. 5,000" />);
    expect(screen.getByText("This month")).toBeInTheDocument();
    expect(screen.getByText("Rs. 5,000")).toBeInTheDocument();
  });

  test("renders an optional trailing icon", () => {
    render(<StatDisplay label="Spend" value="Rs. 100" trailingIcon={<svg data-testid="eye" />} />);
    expect(screen.getByTestId("eye")).toBeInTheDocument();
  });
});
