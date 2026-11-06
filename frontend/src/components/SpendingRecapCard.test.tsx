import { render, screen, within } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import { SpendingRecapCard } from "./SpendingRecapCard";

const props = {
  month: "2026-10",
  spentCents: 5000000,
  // Deliberately unsorted: rank by spend, without mutating the input.
  byCategory: [
    { category: "Shopping", totalCents: 450000 },
    { category: "Food & Dining", totalCents: 1900000 },
    { category: "Utilities", totalCents: 800000 },
    { category: "Transport", totalCents: 650000 },
    { category: "Groceries", totalCents: 1200000 },
  ],
};

describe("SpendingRecapCard", () => {
  test("uses the mockup's portrait blackberry card with a light brand header", () => {
    render(<SpendingRecapCard {...props} mode="percentages" />);
    const card = screen.getByLabelText("Spending recap");
    expect(card).toHaveClass("aspect-[9/16]", "!bg-blackberry", "text-hyper-white");
    expect(screen.getByText("NayaSpend").closest("header")).toHaveClass("bg-hyper-white");
  });
  test("brands an amounts recap with the month, total, ranked top three and other-category sum", () => {
    render(<SpendingRecapCard {...props} mode="amounts" />);
    expect(screen.getByText("NayaSpend")).toBeInTheDocument();
    expect(screen.getByText("October 2026 / My spending recap")).toBeInTheDocument();
    expect(screen.getByRole("heading")).toHaveTextContent("A month. A little more clarity.");
    expect(screen.getByText("Total spent")).toBeInTheDocument();
    expect(screen.getByText("Rs. 50,000.00")).toBeInTheDocument();
    const rows = screen.getAllByRole("listitem");
    expect(rows).toHaveLength(3);
    expect(rows.map((row) => row.textContent)).toEqual([
      "01 / Food & DiningRs. 19,000.00",
      "02 / GroceriesRs. 12,000.00",
      "03 / UtilitiesRs. 8,000.00",
    ]);
    expect(screen.getByText("Rs. 11,000.00 across other categories")).toBeInTheDocument();
    expect(screen.getByText(/took the lead this month/)).toHaveTextContent("Food & Dining took the lead this month.");
    expect(screen.getByText("Good food had a place in the story.")).toBeInTheDocument();
    expect(screen.getByText("My month, made clearer.")).toBeInTheDocument();
    expect(props.byCategory[0].category).toBe("Shopping");
  });

  test("shows only percentages, including the combined remainder, with no rupee figures anywhere", () => {
    const { container } = render(<SpendingRecapCard {...props} mode="percentages" />);
    expect(screen.getByText("My spending, in perspective")).toBeInTheDocument();
    expect(screen.getByText("100%")).toBeInTheDocument();
    expect(screen.getByText("The whole month. Just the pattern.")).toBeInTheDocument();
    const rows = screen.getAllByRole("listitem");
    for (const [index, share] of ["38%", "24%", "16%"].entries()) {
      expect(within(rows[index]).getByText(share)).toBeInTheDocument();
    }
    expect(screen.getByText("22% across other categories")).toBeInTheDocument();
    expect(container.textContent).not.toContain("Rs");
    expect(container.innerHTML).not.toContain("5000000");
  });

  test("a month with fewer than four categories has no other-category line", () => {
    render(<SpendingRecapCard {...props} byCategory={[{ category: "Rent", totalCents: props.spentCents }]} mode="percentages" />);
    expect(screen.getAllByRole("listitem")).toHaveLength(1);
    expect(screen.queryByText(/across other categories/)).not.toBeInTheDocument();
    expect(screen.getByText(/took the lead this month/)).toHaveTextContent("Rent took the lead this month.");
    expect(screen.queryByText("Good food had a place in the story.")).not.toBeInTheDocument();
  });

  test("an empty recap has no invented personality or NaN percentages", () => {
    const { container } = render(<SpendingRecapCard month="2026-10" spentCents={0} byCategory={[]} mode="percentages" />);
    expect(container.textContent).not.toMatch(/NaN|Infinity|Rs|took the lead/);
    expect(screen.getByText("0%")).toBeInTheDocument();
  });
});
