import { render, screen } from "@testing-library/react";
import { expect, test } from "vitest";
import { SidePanelLayout } from "./SidePanelLayout";

test("renders both the main slot and the panel slot", () => {
  render(
    <SidePanelLayout
      main={<div data-testid="main-slot" />}
      panel={<div data-testid="panel-slot" />}
    />,
  );
  expect(screen.getByTestId("main-slot")).toBeInTheDocument();
  expect(screen.getByTestId("panel-slot")).toBeInTheDocument();
});
