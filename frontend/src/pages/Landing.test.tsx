import { render, screen, within, cleanup, act, fireEvent } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { useReducedMotion } from "motion/react";
import { Landing } from "./Landing";

vi.mock("motion/react", async original => ({
  ...await original<typeof import("motion/react")>(), useReducedMotion: vi.fn(),
}));
const observe = vi.fn();
const unobserve = vi.fn();
const disconnect = vi.fn();
let reveal: IntersectionObserverCallback;
beforeEach(() => {
  vi.mocked(useReducedMotion).mockReturnValue(false);
  vi.stubGlobal("IntersectionObserver", class {
    constructor(callback: IntersectionObserverCallback) { reveal = callback; }
    observe = observe;
    unobserve = unobserve;
    disconnect = disconnect;
  });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.clearAllMocks(); });

function expectContent() {
  expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Spending happens.Clarity follows.");
  expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
  for (const name of ["01. Capture", "02. Categorize", "03. Budget", "04. Remind", "05. Understand"]) {
    expect(screen.getByText(name)).toBeInTheDocument();
  }
  expect(screen.getByText(/Bill reminders keep dues like PTCL and Nayatel/)).toBeInTheDocument();
  expect(screen.getAllByText("CBTL").length).toBeGreaterThan(0);
}

test("renders the locked headline, numbered chapters and local copy", () => {
  const { container } = render(<Landing />);
  expectContent();
  expect(container.textContent).not.toMatch(/sample|->|not connected|mockup|Demo only|interactive landing-page draft/i);
});

test("all sign-in controls link directly to Google OAuth", () => {
  render(<Landing />);
  for (const name of ["Sign in", "Sign in with Google", "Get started"]) {
    expect(screen.getByRole("link", { name })).toHaveAttribute("href", "/api/auth/google/login");
  }
  expect(screen.queryByRole("button")).not.toBeInTheDocument();
});

test("keeps the draft navigation and valid in-page anchors", () => {
  const { container } = render(<Landing />);
  const nav = screen.getByRole("navigation", { name: "Main navigation" });
  expect(within(nav).getByRole("link", { name: "Explore" })).toHaveAttribute("href", "#experience");
  expect(within(nav).getByRole("link", { name: "Your privacy" })).toHaveAttribute("href", "#privacy");
  expect(screen.getByRole("link", { name: "Take a look" })).toHaveAttribute("href", "#experience");
  container.querySelectorAll<HTMLAnchorElement>('a[href^="#"]').forEach(link => {
    expect(container.querySelector(link.hash)).not.toBeNull();
  });
});

test("preserves honest access and illustrative disclosures with footer legal links", () => {
  render(<Landing />);
  expect(screen.getByText("Read-only Gmail access. You stay in control of your inbox.")).toBeInTheDocument();
  expect(screen.getByText(/Read-only access cannot send or change your emails/)).toBeInTheDocument();
  expect(screen.getByText(/NayaSpend is an independent companion, not affiliated with NayaPay/)).toBeInTheDocument();
  const footer = screen.getByRole("contentinfo");
  expect(footer).toHaveTextContent("Not affiliated with NayaPay. Amounts shown in previews are illustrative.");
  expect(within(footer).getByRole("link", { name: "Terms of Service" })).toHaveAttribute("href", "/terms");
  expect(within(footer).getByRole("link", { name: "Privacy Policy" })).toHaveAttribute("href", "/privacy");
});

test("renders sixteen distinct decorative scenes, shared arrow and hidden mascot", () => {
  const { container } = render(<Landing />);
  const scenes = Array.from(container.querySelectorAll("svg[data-landing-scene]"));
  expect(scenes).toHaveLength(16);
  expect(new Set(scenes.map(svg => svg.getAttribute("data-landing-scene"))).size).toBe(16);
  expect(new Set(scenes.map(svg => svg.innerHTML)).size).toBe(16);
  container.querySelectorAll("svg").forEach(svg => expect(svg).toHaveAttribute("aria-hidden", "true"));
  expect(container.querySelector("svg[data-landing-mascot]")).toHaveAttribute("aria-hidden", "true");
  expect(container.querySelector("symbol#friendly-arrow path")).toHaveAttribute("stroke", "currentColor");
});

test("reveals observed content once and disconnects on unmount", () => {
  const { container, unmount } = render(<Landing />);
  const target = container.querySelector(".waypoint")!;
  expect(observe).toHaveBeenCalledWith(target);
  act(() => reveal([{ isIntersecting: true, target } as IntersectionObserverEntry], {} as IntersectionObserver));
  expect(target).toHaveClass("visible");
  expect(unobserve).toHaveBeenCalledWith(target);
  unmount();
  expect(disconnect).toHaveBeenCalledOnce();
});

test("reduced motion preserves visible content without an observer", () => {
  vi.mocked(useReducedMotion).mockReturnValue(true);
  const { container } = render(<Landing />);
  expectContent();
  expect(container.querySelector(".landing")).not.toHaveClass("js");
  expect(container.querySelector(".landing")).toHaveAttribute("data-reduced-motion", "true");
  expect(observe).not.toHaveBeenCalled();
});

test("content stays visible when IntersectionObserver is unavailable", () => {
  vi.stubGlobal("IntersectionObserver", undefined);
  const { container } = render(<Landing />);
  expectContent();
  expect(container.querySelector(".landing")).not.toHaveClass("js");
});

test("hero tilt is restricted to fine hover pointers and resets on leave", () => {
  const media = { matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() };
  vi.stubGlobal("matchMedia", vi.fn(() => media));
  const { container, unmount } = render(<Landing />);
  const card = container.querySelector<HTMLElement>(".floating")!;
  vi.spyOn(card, "getBoundingClientRect").mockReturnValue({ left: 0, top: 0, width: 200, height: 200 } as DOMRect);
  // jsdom lacks PointerEvent, so define the coordinates explicitly.
  const move = new Event("pointermove");
  Object.defineProperties(move, { clientX: { value: 150 }, clientY: { value: 50 }, pointerType: { value: "mouse" } });
  fireEvent(card, move);
  expect(card.style.transform).toContain("rotateX(1.25deg) rotateY(1.25deg)");
  fireEvent.pointerLeave(card);
  expect(card.style.transform).toBe("");
  media.matches = false;
  fireEvent(card, move);
  expect(card.style.transform).toBe("");
  unmount();
  expect(media.removeEventListener).toHaveBeenCalledWith("change", expect.any(Function));
});

test("reduced motion does not attach hero tilt handlers", () => {
  vi.mocked(useReducedMotion).mockReturnValue(true);
  const media = vi.fn();
  vi.stubGlobal("matchMedia", media);
  render(<Landing />);
  expect(media).not.toHaveBeenCalled();
});
