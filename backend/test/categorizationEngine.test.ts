import { env } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { describe, expect, test } from "vitest";
import { categoryRules } from "../src/db/schema";
import { categorize, correctCategory } from "../src/services/categorizationEngine";

describe("categorizationEngine", () => {
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
