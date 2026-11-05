import { env } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { describe, expect, test } from "vitest";
import { categoryRules } from "../src/db/schema";
import { categorize, classifyByKeyword, correctCategory } from "../src/services/categorizationEngine";

describe("categorizationEngine", () => {
  test.each([
    ["khayaban pharmacyy lahore pk", "Health"],
    ["alkhan pharmacy", "Health"],
    ["kfc - expo center johar tlahore pk", "Food & Dining"],
    ["the potato factory i lahore pk", "Food & Dining"],
    ["bundu khan sweets & lahore pk", "Food & Dining"],
    ["paid to foodpanda karachi pakista00000000000 pk|visa xxxx6548", "Food & Dining"],
    ["alfa mart lahore pk", "Groceries"],
    ["rainbow cash and carry lahore pk", "Groceries"],
    ["taj gasoline lahore pk|visa xxxx8978", "Transport"],
    ["mobile top-up purchased |jazz 03027816995", "Utilities"],
    ["m-tag recharge|m faryad - lexxxxx5", "Utilities"],
    ["outgoing fund transfer to muhammad hassan", "Transfers"],
    ["incoming fund transfer from bank alfalah-0797", "Transfers"],
    ["money received from ariba faryad|(aribafaryad@nayapay)", "Transfers"],
    ["outgoing fund transfer to jazz cafe", "Transfers"],
  ])("categorize classifies %s as %s without a stored rule", async (vendor, category) => {
    const db = drizzle(env.DB);
    expect(classifyByKeyword(vendor)).toBe(category);
    expect(await categorize(db, vendor)).toBe(category);
  });

  test("an exact manual rule wins over a keyword match, including Uncategorized", async () => {
    const db = drizzle(env.DB);
    await correctCategory(db, "kfc lahore", "Work meals");
    expect(await categorize(db, "kfc lahore")).toBe("Work meals");
    await correctCategory(db, "kfc lahore", "Uncategorized");
    expect(await categorize(db, "kfc lahore")).toBe("Uncategorized");
  });

  test("classifyByKeyword returns null for unknown vendors and embedded keywords", () => {
    for (const vendor of ["some-new-vendor", "", "smart services", "jazzcash", "gasim traders"]) {
      expect(classifyByKeyword(vendor)).toBeNull();
    }
  });

  test("categorize returns the matched rule's category", async () => {
    const db = drizzle(env.DB);
    await db.insert(categoryRules).values({ vendorNormalized: "starbucks", category: "Coffee" });
    expect(await categorize(db, "starbucks")).toBe("Coffee");
  });

  test("categorize falls back to Uncategorized for an unknown vendor", async () => {
    const db = drizzle(env.DB);
    expect(await categorize(db, "some-new-vendor")).toBe("Uncategorized");
  });

  test("categorize is case/whitespace insensitive on the stored normalized vendor", async () => {
    const db = drizzle(env.DB);
    await db.insert(categoryRules).values({ vendorNormalized: "starbucks2", category: "Coffee" });
    expect(await categorize(db, "  Starbucks2 ")).toBe("Coffee");
  });

  test("correctCategory upserts the rule so the next lookup uses the correction", async () => {
    const db = drizzle(env.DB);
    await correctCategory(db, "newvendor", "Groceries");
    expect(await categorize(db, "newvendor")).toBe("Groceries");

    await correctCategory(db, "newvendor", "Dining");
    expect(await categorize(db, "newvendor")).toBe("Dining");
  });
});
