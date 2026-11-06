import { render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import { Login } from "./Login";
import userEvent from "@testing-library/user-event";

// jsdom has no 2D canvas; the liquid background simply stays blank under test.
HTMLCanvasElement.prototype.getContext = vi.fn(() => null) as unknown as typeof HTMLCanvasElement.prototype.getContext;

vi.mock("motion/react", async (importOriginal) => ({
  ...await importOriginal<typeof import("motion/react")>(),
  useReducedMotion: () => true,
}));

test("shows the sign-in card and read-only reassurance with reduced motion", () => {
  render(<Login />);
  expect(screen.getByRole("heading", { name: "A little clarity starts here." })).toBeVisible();
  expect(screen.getByText(/Gmail connection uses separate, read-only consent/)).toBeVisible();
  expect(screen.getByRole("link", { name: /sign in with google/i })).toBeVisible();
});

test("pairs sign-in with a quiet four-step brand panel on wider screens", () => {
  render(<Login />);
  const panel = screen.getByRole("complementary", { name: "NayaSpend brand panel" });
  expect(panel).toHaveClass("hidden", "md:flex");
  for (const step of ["01 Connect", "02 Sort", "03 Plan", "04 Understand"]) {
    expect(screen.getByText(step)).toBeInTheDocument();
  }
});

describe("Login", () => {
  test("renders the logo mark alongside the wordmark", () => {
    const { container } = render(<Login />);
    expect(container.querySelector('svg[viewBox="0 0 64 64"]')).toBeInTheDocument();
    expect(screen.getByText("NayaSpend")).toBeInTheDocument();
  });

  test("renders a sign-in link pointing at the backend's Google login route", () => {
    render(<Login />);
    const link = screen.getByRole("link", { name: /sign in with google/i });
    expect(link).toHaveAttribute("href", "/api/auth/google/login");
  });
});

test("offers a modest link to learn about NayaSpend", () => {
  render(<Login />);
  expect(screen.getByRole("link", { name: "Learn more about NayaSpend" })).toHaveAttribute("href", "/welcome");
});

test("links to both public legal pages from the bottom sign-in area", () => {
  render(<Login />);
  expect(screen.getByRole("link", { name: "Terms of Service" })).toHaveAttribute("href", "/terms");
  expect(screen.getByRole("link", { name: "Privacy Policy" })).toHaveAttribute("href", "/privacy");
});

test("keeps the ink scenes out of accessible content and pointer interaction", () => {
  render(<Login />);
  const decorations = screen.getAllByTestId(/^login-decoration-/);
  expect(decorations).toHaveLength(3);
  expect(decorations.map((decoration) => decoration.getAttribute("data-testid")).sort()).toEqual([
    "login-decoration-scene", "login-decoration-trend", "login-decoration-trust",
  ]);
  expect(document.querySelectorAll("filter#login-ink-roughen")).toHaveLength(1);
  for (const decoration of decorations) {
    expect(decoration).toHaveAttribute("aria-hidden", "true");
    expect(decoration).toHaveClass("pointer-events-none");
    expect(decoration.querySelector("a, button, [tabindex]")).toBeNull();
  }
  expect(screen.queryByRole("img")).not.toBeInTheDocument();
});

test("keeps the primary OAuth CTA reachable by keyboard with decorations present", async () => {
  const user = userEvent.setup();
  render(<Login />);
  expect(screen.getAllByTestId(/^login-decoration-/).length).toBeGreaterThan(0);
  await user.tab();
  const cta = screen.getByRole("link", { name: "Sign in with Google" });
  expect(cta).toBeVisible();
  expect(cta).toHaveFocus();
  expect(cta).toHaveAttribute("href", "/api/auth/google/login");
});

test("paints the fluted-glass liquid behind the page as a decorative, non-interactive canvas", () => {
  render(<Login />);
  const liquid = screen.getByTestId("login-liquid");
  expect(liquid.tagName).toBe("CANVAS");
  expect(liquid).toHaveAttribute("aria-hidden", "true");
  expect(liquid).toHaveClass("login-liquid");
});
