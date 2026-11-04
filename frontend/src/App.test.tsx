import { render, screen } from "@testing-library/react";
import { createMemoryRouter, RouterProvider, type RouteObject } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, test } from "vitest";
import { routes } from "./App";

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
