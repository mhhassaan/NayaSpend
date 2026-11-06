import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import { CategorySelect, CANONICAL_CATEGORIES } from "./CategorySelect";

test("renders canonical categories followed by sorted, deduplicated custom categories", () => {
  render(<CategorySelect aria-label="Category" value="Coffee" onChange={() => {}} extraCategories={["Travel", "Coffee", "Health", "Coffee"]} />);
  expect(screen.getAllByRole("option").map(option => option.textContent)).toEqual([...CANONICAL_CATEGORIES, "Coffee", "Travel"]);
  expect(screen.getByRole("combobox")).toHaveValue("Coffee");
});

test("reports the selected category", async () => {
  const onChange = vi.fn();
  render(<CategorySelect id="category" aria-label="Category" value="Uncategorized" onChange={onChange} />);
  await userEvent.selectOptions(screen.getByRole("combobox"), "Health");
  expect(onChange).toHaveBeenCalledWith("Health");
});
