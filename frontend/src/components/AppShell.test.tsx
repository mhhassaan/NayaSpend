import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, test } from "vitest";
import { AppShell } from "./AppShell";

describe("AppShell", () => {
  test("renders nav links for the primary pages and a Log transaction quick action", () => {
    render(
      <MemoryRouter>
        <AppShell>
          <div />
        </AppShell>
      </MemoryRouter>
    );
    // Both a desktop sidebar and a mobile bottom-tab-bar nav are always
    // rendered (CSS-hidden per breakpoint, not conditionally mounted), so
    // each label appears twice.
    for (const label of ["Dashboard", "Transactions", "Dedup Review", "Budgets", "Bills", "Capture Health"]) {
      expect(screen.getAllByRole("link", { name: label }).length).toBeGreaterThan(0);
    }
    expect(screen.getByRole("link", { name: "Log transaction" })).toBeInTheDocument();
  });

  test("renders its children inside the shell", () => {
    render(
      <MemoryRouter>
        <AppShell>
          <div>page content</div>
        </AppShell>
      </MemoryRouter>
    );
    expect(screen.getByText("page content")).toBeInTheDocument();
  });
});
