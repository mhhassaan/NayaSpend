import { render, screen } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import { Login } from "./Login";

describe("Login", () => {
  test("renders a sign-in link pointing at the backend's Google login route", () => {
    render(<Login />);
    const link = screen.getByRole("link", { name: /sign in with google/i });
    expect(link).toHaveAttribute("href", "/api/auth/google/login");
  });
});
