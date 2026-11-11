import { render, screen, cleanup } from "@testing-library/react";
import { afterEach, expect, test } from "vitest";
import { ScrollMascotBar } from "./ScrollMascotBar";

afterEach(cleanup);

test("renders the scroll rail with the class hidden by the mobile media query", () => {
  render(<ScrollMascotBar reduce lenis={{ current: null }} />);

  const rail = screen.getByRole("scrollbar", { name: "Page scroll position" });
  expect(rail).toHaveClass("sbar");
  expect(rail.querySelector(".trk")).toBeInTheDocument();
  expect(rail.querySelector(".thumb svg")).toBeInTheDocument();
});
