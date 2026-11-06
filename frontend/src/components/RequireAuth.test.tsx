import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, test, vi } from "vitest";
import { RequireAuth } from "./RequireAuth";

function renderGuarded(initialEntries: string[] = ["/"]) {
  return render(
    <MemoryRouter initialEntries={initialEntries}>
      <Routes>
        <Route path="/login" element={<div>login page</div>} />
        <Route
          path="/"
          element={
            <RequireAuth>
              <div>protected content</div>
            </RequireAuth>
          }
        />
      </Routes>
    </MemoryRouter>
  );
}

describe("RequireAuth", () => {
  test("shows a skeleton while /api/auth/google/me is pending", () => {
    vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})));
    renderGuarded();
    expect(screen.getByTestId("auth-skeleton")).toBeInTheDocument();
  });

  test("redirects to /login when /api/auth/google/me returns 401", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 401 })));
    renderGuarded();
    expect(await screen.findByText("login page")).toBeInTheDocument();
  });

  test("renders children when /api/auth/google/me returns 200", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ id: 1, email: "a@example.com", displayName: "A" }), { status: 200 }))
    );
    renderGuarded();
    expect(await screen.findByText("protected content")).toBeInTheDocument();
  });
});
