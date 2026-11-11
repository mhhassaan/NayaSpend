import { beforeAll, afterAll, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { createMemoryRouter, RouterProvider, type RouteObject } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, test } from "vitest";
import { routes } from "./App";

// Torph requires WAAPI getAnimations even when disabled; jsdom does not implement it.
vi.mock("torph/react", () => ({
  TextMorph: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
}));

// createMemoryRouter/createBrowserRouter each attach internal state to the
// route objects they're given -- reusing the same objects across two
// router instances makes the second one error. This shallow-clones each
// route container (new object per route/child) while still sharing the
// `element`/`errorElement` React elements themselves (immutable, fine to
// share), so every test in this file gets its own router state.
function cloneRoutes(source: RouteObject[]): RouteObject[] {
  return source.map((route) => ({
    ...route,
    children: route.children ? cloneRoutes(route.children) : undefined,
  })) as RouteObject[];
}

function renderAt(initialPath: string) {
  const router = createMemoryRouter(cloneRoutes(routes), { initialEntries: [initialPath] });
  const queryClient = new QueryClient();
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  );
}

describe("App routing", () => {
  test("an unknown route renders the 404 page", () => {
    renderAt("/this-does-not-exist");
    expect(screen.getByText(/page not found/i)).toBeInTheDocument();
  });

  test("the root route renders without throwing", () => {
    renderAt("/");
    expect(document.body).toBeInTheDocument();
  });
});

test("welcome renders the public landing page outside AppShell", () => {
  renderAt("/welcome");
  expect(screen.getByRole("heading", { level: 1, name: "Know where your NayaPay money went." })).toBeInTheDocument();
  expect(screen.queryByRole("navigation", { name: /primary/i })).not.toBeInTheDocument();
});

// jsdom has no viewport observer; keep Motion real and provide its browser API.
beforeAll(() => {
  vi.stubGlobal("IntersectionObserver", class {
    observe() {}
    unobserve() {}
    disconnect() {}
  });
  // Route tests keep Motion and NumberFlow real, exercising their static mode.
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: query.includes("prefers-reduced-motion"), media: query,
    addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {},
  }));
});
afterAll(() => vi.unstubAllGlobals());

test.each([["/terms", "Terms of Service"], ["/privacy", "Privacy Policy"]])("%s is public and outside AppShell", (path, heading) => {
  renderAt(path);
  expect(screen.getByRole("heading", { level: 1, name: heading })).toBeInTheDocument();
  expect(screen.queryByRole("navigation", { name: /primary/i })).not.toBeInTheDocument();
  expect(routes.find((route) => route.path === path)).toBeDefined();
});
