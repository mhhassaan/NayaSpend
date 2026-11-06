import { render, screen, within } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { expect, test } from "vitest";
import { routes } from "../App";

function renderPage() {
  return render(<RouterProvider router={createMemoryRouter(routes, { initialEntries: ["/terms"] })} />);
}

test("renders Terms of Service and every major section", () => {
  renderPage();
  expect(screen.getByRole("heading", { level: 1, name: "Terms of Service" })).toBeInTheDocument();
  for (const name of ["A companion, with clear boundaries", "Using it thoughtfully", "Your inbox, your permission", "Your data stays yours", "One person, doing their best", "A fair word about responsibility", "You can leave at any time", "If these terms change", "A real person to contact"]) {
    expect(screen.getByRole("heading", { level: 2, name })).toBeInTheDocument();
  }
});

test("every table of contents link resolves to a section", () => {
  renderPage();
  const links = within(screen.getByRole("navigation", { name: "On this page" })).getAllByRole("link");
  expect(links).toHaveLength(9);
  for (const link of links) {
    const href = link.getAttribute("href")!;
    expect(href).toMatch(/^#/);
    expect(document.getElementById(href.slice(1))?.tagName).toBe("SECTION");
  }
});

test("offers a route cross-link to Privacy Policy", () => {
  renderPage();
  expect(screen.getByRole("link", { name: "Read the Privacy Policy" })).toHaveAttribute("href", "/privacy");
});
