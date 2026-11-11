import { render, screen, cleanup, fireEvent, act } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { useReducedMotion } from "motion/react";
import { Landing } from "./Landing";
const motionHarness = vi.hoisted(() => ({
  scrolls: [] as { target: Element; update: (p: number) => void; stop: ReturnType<typeof vi.fn> }[],
  views: [] as { target: Element; enter: () => void; leave: () => void; stop: ReturnType<typeof vi.fn> }[],
}));
vi.mock("motion/react", () => ({ useReducedMotion: vi.fn(() => false) }));
vi.mock("motion", () => ({
  animate: vi.fn(() => ({ stop: vi.fn() })), spring: vi.fn(),
  scroll: vi.fn((update, { target }) => { const stop = vi.fn(); motionHarness.scrolls.push({ target, update, stop }); return stop; }),
  inView: vi.fn((target, callback) => {
    let leave = () => {};
    const stop = vi.fn(() => leave());
    motionHarness.views.push({ target, enter: () => { leave = callback() ?? (() => {}); }, leave: () => leave(), stop });
    return stop;
  }),
}));
vi.mock("lenis", () => ({ default: class { raf() {} destroy() {} scrollTo() {} } }));
vi.mock("@number-flow/react", () => ({ default: ({ value }: { value: number }) => <span>{value.toLocaleString("en-US")}</span> }));
vi.mock("torph/react", () => ({ TextMorph: ({ children }: { children: React.ReactNode }) => <span>{children}</span> }));
beforeEach(() => {
  motionHarness.scrolls.length = 0;
  motionHarness.views.length = 0;
  vi.useFakeTimers();
  vi.mocked(useReducedMotion).mockReturnValue(false);
  vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
  vi.stubGlobal("IntersectionObserver", class { observe() {} unobserve() {} disconnect() {} });
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.clearAllMocks(); });
test("renders variant A with accessible headings, navigation and required copy", () => {
  const { container } = render(<Landing />);
  expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
  expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Know where your NayaPay money went.");
  for (const [name, href] of [["Sign in", "/login"], ["Get started", "/login"], ["Take a look", "#story"], ["Terms of Service", "/terms"], ["Privacy Policy", "/privacy"], ["Sign in with Google", "/login"]]) {
    expect(screen.getByRole("link", { name })).toHaveAttribute("href", href);
  }
  expect(screen.getByText("Is this NayaPay?")).toBeInTheDocument();
  expect(screen.getByText(/Independent spending companion. Not affiliated with NayaPay/)).toBeInTheDocument();
  expect(container.querySelector(".eyebrow, .switch, [data-show]")).toBeNull();
  expect(container.textContent).not.toContain("PKR");
  expect(container.querySelectorAll(".beat")).toHaveLength(6);
  expect(container.querySelectorAll(".tour .steps li")).toHaveLength(4);
});
test("card flips on click and its loop cleans up", () => {
  const { unmount } = render(<Landing />);
  const card = screen.getByRole("button", { name: "Flip NayaPay card" });
  expect(card).toHaveAttribute("aria-pressed", "false");
  fireEvent.click(card);
  expect(card).toHaveAttribute("aria-pressed", "true");
  fireEvent.click(card);
  expect(card).toHaveAttribute("aria-pressed", "false");
  act(() => vi.advanceTimersByTime(4200));
  expect(card).toHaveAttribute("aria-pressed", "true");
  unmount();
  expect(vi.getTimerCount()).toBe(0);
});
test("reduced motion renders static final states without travel or loops", () => {
  vi.mocked(useReducedMotion).mockReturnValue(true);
  const { container } = render(<Landing />);
  expect(container.querySelector(".landing")).toHaveAttribute("data-reduced-motion", "true");
  expect(container.querySelector(".finale")).toHaveStyle("--p: 1");
  expect(container.querySelector(".trav")).toBeNull();
  expect(container.querySelector(".tour .scr.on")).toHaveAttribute("data-screen", "csv");
  expect(container.querySelector(".pct")).toHaveTextContent("62%");
  expect(vi.getTimerCount()).toBe(0);
  expect(motionHarness.scrolls).toHaveLength(0);
  expect(motionHarness.views).toHaveLength(0);
});

test("scrolling advances the tour and traveller, then disconnects every subscription", () => {
  const { container, unmount } = render(<Landing />);
  const tour = motionHarness.scrolls.find(item => item.target.classList.contains("tour"))!;
  act(() => tour.update(.55));
  expect(container.querySelector(".tour .scr.on")).toHaveAttribute("data-screen", "trends");
  expect(container.querySelector(".tour .rail b")).toHaveStyle("transform: scaleY(0.55)");
  act(() => tour.update(1));
  expect(container.querySelector(".tour .scr.on")).toHaveAttribute("data-screen", "csv");
  const beats = motionHarness.views.filter(item => item.target.classList.contains("beat"));
  act(() => beats[4].enter());
  expect(container.querySelector(".trav")).toHaveAttribute("data-s", "3");
  expect(container.querySelector(".pct")).toHaveTextContent("62%");
  act(() => beats[5].enter());
  expect(container.querySelector(".trav")).toHaveAttribute("data-s", "4");
  expect(container.querySelector(".tot")).toHaveTextContent("42,180");
  unmount();
  motionHarness.scrolls.forEach(item => expect(item.stop).toHaveBeenCalled());
  motionHarness.views.forEach(item => expect(item.stop).toHaveBeenCalled());
});

test("finale expands with scroll and shakes only while visible", () => {
  const animation = { cancel: vi.fn() };
  const animate = vi.fn(() => animation);
  const { container } = render(<Landing />);
  const button = screen.getByRole("link", { name: "Sign in with Google" });
  Object.defineProperty(button, "animate", { value: animate });
  const progress = motionHarness.scrolls.find(item => item.target.classList.contains("finale"))!;
  act(() => progress.update(.8));
  expect(container.querySelector(".finale")).toHaveStyle("--p: 0.8");
  const visible = motionHarness.views.find(item => item.target.classList.contains("close"))!;
  act(() => { visible.enter(); vi.advanceTimersByTime(600); });
  expect(animate).toHaveBeenCalledTimes(1);
  act(() => vi.advanceTimersByTime(3000));
  expect(animate).toHaveBeenCalledTimes(2);
  act(() => { visible.leave(); vi.advanceTimersByTime(7200); });
  expect(animate).toHaveBeenCalledTimes(2);
  expect(animation.cancel).toHaveBeenCalled();
});
test("remains readable without observers", () => {
  vi.stubGlobal("IntersectionObserver", undefined);
  vi.stubGlobal("ResizeObserver", undefined);
  render(<Landing />);
  expect(screen.getByRole("heading", { level: 1 })).toBeVisible();
});

test("switching to reduced motion settles an interrupted reveal and cancels loops", () => {
  const { container, rerender } = render(<Landing />);
  const headline = screen.getByRole("heading", { level: 1 });
  headline.style.opacity = "0.2";
  headline.style.transform = "translateY(20px)";
  vi.mocked(useReducedMotion).mockReturnValue(true);
  rerender(<Landing />);
  expect(headline).toHaveStyle("opacity: 1; transform: none");
  expect(container.querySelector(".trav")).toBeNull();
  expect(vi.getTimerCount()).toBe(0);
});
