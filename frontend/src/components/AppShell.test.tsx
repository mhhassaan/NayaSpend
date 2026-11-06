import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, test } from "vitest";
import { AppShell } from "./AppShell";

describe("AppShell", () => {
  test("renders the logo mark beside both wordmarks", () => {
    const { container } = render(<MemoryRouter><AppShell><div /></AppShell></MemoryRouter>);
    for (const region of ["aside", "header"]) {
      expect(container.querySelector(`${region} svg[viewBox="0 0 64 64"]`)).toBeInTheDocument();
    }
    expect(screen.getAllByText("NayaSpend")).toHaveLength(2);
  });

  test("keeps the desktop sidebar within the viewport with its own overflow scrolling", () => {
    const { container } = render(
      <MemoryRouter>
        <AppShell><div /></AppShell>
      </MemoryRouter>
    );
    expect(container.querySelector("aside")).toHaveClass("md:sticky", "md:top-0", "md:h-screen", "md:overflow-y-auto");
  });

  test("renders its children at a non-root route", () => {
    render(
      <MemoryRouter initialEntries={["/transactions"]}>
        <AppShell>
          <div>transactions content</div>
        </AppShell>
      </MemoryRouter>
    );
    expect(screen.getByText("transactions content")).toBeInTheDocument();
  });

  test("renders nav links for the primary pages", () => {
    render(
      <MemoryRouter>
        <AppShell>
          <div />
        </AppShell>
      </MemoryRouter>
    );
    // Both a desktop sidebar and a mobile app-name bar/bottom-tab-bar nav
    // are always rendered (CSS-hidden per breakpoint, not conditionally
    // mounted), so each label appears twice.
    for (const label of ["Dashboard", "Transactions", "Dedup Review", "Budgets", "Bills", "Capture Health"]) {
      expect(screen.getAllByRole("link", { name: label }).length).toBeGreaterThan(0);
    }
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

  test("[Phase 8 Task 12] renders a sign-out action", () => {
    render(
      <MemoryRouter>
        <AppShell>
          <div />
        </AppShell>
      </MemoryRouter>
    );
    expect(screen.getAllByRole("button", { name: /sign out/i }).length).toBeGreaterThan(0);
  });
});
