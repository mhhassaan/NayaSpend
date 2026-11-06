import { render } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import * as illustrations from "./illustrations";

const NAMES = [
  "HeroIllustration",
  "MonthEmptyIllustration",
  "HistoryEmptyIllustration",
  "TransactionsEmptyIllustration",
  "BudgetsEmptyIllustration",
  "BillsEmptyIllustration",
  "DedupEmptyIllustration",
  "CaptureHealthEmptyIllustration",
  "NotFoundIllustration",
] as const;

describe("illustrations", () => {
  test.each(NAMES)("%s renders a single root svg and accepts SVG props", (name) => {
    const Component = illustrations[name];
    const { container } = render(<Component className="test-class" width={180} height={140} />);
    expect(container.children).toHaveLength(1);
    expect(container.querySelectorAll("svg")).toHaveLength(1);
    const svg = container.firstElementChild;
    expect(svg?.tagName).toBe("svg");
    expect(svg).toHaveClass("test-class");
    expect(svg).toHaveAttribute("width", "180");
    expect(svg).toHaveAttribute("height", "140");
  });

  test("every scene uses its assigned fill and never mixes accent colors", () => {
    const accents = ["#ff5018", "#c71e06", "#9048c4", "#c4b8ff", "#ece8fd", "#ffc6d4"];
    const neutrals = ["#381d2a", "#8c8085", "#fcf9fb", "#f0eaed", "none", "#1e8a4c"];
    const assignedFills = [
      "#ff5018", "#ece8fd", "#ffc6d4", "#ece8fd", "#c4b8ff",
      "#ffc6d4", "#1e8a4c", "#9048c4", "#d9d2d5",
    ];

    expect(Object.keys(illustrations).sort()).toEqual([...NAMES].sort());
    for (const [index, name] of NAMES.entries()) {
      const Component = illustrations[name];
      const { container, unmount } = render(<Component />);
      const fills = Array.from(container.querySelectorAll("[fill]"), (element) => element.getAttribute("fill")!);
      // The spec explicitly permits mid-grey for the neutral NotFound scene only.
      const allowed = name === "NotFoundIllustration" ? ["#8c8085", "#d9d2d5", "none"] : [...accents, ...neutrals];
      expect(fills.filter((fill) => !allowed.includes(fill)), name).toEqual([]);
      const accentFills = new Set(fills.filter((fill) => accents.includes(fill)));
      expect(accentFills.size, name).toBeLessThanOrEqual(1);
      expect(fills, name).toContain(assignedFills[index]);
      if (name === "DedupEmptyIllustration" || name === "NotFoundIllustration") {
        expect(accentFills.size, name).toBe(0);
      } else {
        expect([...accentFills], name).toEqual([assignedFills[index]]);
        expect(fills, name).not.toContain("#1e8a4c");
      }
      unmount();
    }
  });
});
