import { render, screen, within } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { expect, test } from "vitest";
import { routes } from "../App";

function renderPage() {
  return render(<RouterProvider router={createMemoryRouter(routes, { initialEntries: ["/privacy"] })} />);
}

test("renders Privacy Policy and every major section", () => {
  renderPage();
  expect(screen.getByRole("heading", { level: 1, name: "Privacy Policy" })).toBeInTheDocument();
  for (const name of ["Your spending story stays yours", "What connecting Gmail allows", "The other data you bring", "Why this information is needed", "How your information is kept", "No selling. No sharing.", "Disconnect or delete, on your terms", "A note about children", "When this policy changes", "Questions are welcome"]) {
    expect(screen.getByRole("heading", { level: 2, name })).toBeInTheDocument();
  }
});

test("every table of contents link resolves to a section", () => {
  renderPage();
  const links = within(screen.getByRole("navigation", { name: "On this page" })).getAllByRole("link");
  expect(links).toHaveLength(10);
  for (const link of links) {
    const href = link.getAttribute("href")!;
    expect(href).toMatch(/^#/);
    expect(document.getElementById(href.slice(1))?.tagName).toBe("SECTION");
  }
});

test("offers a route cross-link to Terms of Service", () => {
  renderPage();
  expect(screen.getByRole("link", { name: "Read the Terms of Service" })).toHaveAttribute("href", "/terms");
});
