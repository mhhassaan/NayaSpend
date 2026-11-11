import { env } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { describe, expect, test } from "vitest";
import { seedUserAndSession } from "./helpers/authedRequest";
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
    ["m-tag recharge|m faryad - lexxxxx5", "Transport"],
    ["outgoing fund transfer to muhammad hassan", "Transfers"],
    ["incoming fund transfer from bank alfalah-0797", "Transfers"],
    ["money received from ariba faryad|(aribafaryad@nayapay)", "Transfers"],
    ["outgoing fund transfer to jazz cafe", "Transfers"],
  ])("categorize classifies %s as %s without a stored rule", async (vendor, category) => {
    const db = drizzle(env.DB);
    const { userId } = await seedUserAndSession(db);
    expect(classifyByKeyword(vendor)).toBe(category);
    expect(await categorize(db, vendor, userId)).toBe(category);
  });

  test("an exact manual rule wins over a keyword match, including Uncategorized", async () => {
    const db = drizzle(env.DB);
    const { userId } = await seedUserAndSession(db);
    await correctCategory(db, "kfc lahore", "Work meals", userId);
    expect(await categorize(db, "kfc lahore", userId)).toBe("Work meals");
    await correctCategory(db, "kfc lahore", "Uncategorized", userId);
    expect(await categorize(db, "kfc lahore", userId)).toBe("Uncategorized");
  });

  test("classifyByKeyword returns null for unknown vendors and embedded keywords", () => {
    for (const vendor of ["some-new-vendor", "", "smart services", "jazzcash", "gasim traders"]) {
      expect(classifyByKeyword(vendor)).toBeNull();
    }
  });

  test("categorize returns the matched rule's category", async () => {
    const db = drizzle(env.DB);
    const { userId } = await seedUserAndSession(db);
    await db.insert(categoryRules).values({ userId, vendorNormalized: "starbucks", category: "Coffee" });
    expect(await categorize(db, "starbucks", userId)).toBe("Coffee");
  });

  test("categorize falls back to Uncategorized for an unknown vendor", async () => {
    const db = drizzle(env.DB);
    const { userId } = await seedUserAndSession(db);
    expect(await categorize(db, "some-new-vendor", userId)).toBe("Uncategorized");
  });

  test("categorize is case/whitespace insensitive on the stored normalized vendor", async () => {
    const db = drizzle(env.DB);
    const { userId } = await seedUserAndSession(db);
    await db.insert(categoryRules).values({ userId, vendorNormalized: "starbucks2", category: "Coffee" });
    expect(await categorize(db, "  Starbucks2 ", userId)).toBe("Coffee");
  });

  test("correctCategory upserts the rule so the next lookup uses the correction", async () => {
    const db = drizzle(env.DB);
    const { userId } = await seedUserAndSession(db);
    await correctCategory(db, "newvendor", "Groceries", userId);
    expect(await categorize(db, "newvendor", userId)).toBe("Groceries");

    await correctCategory(db, "newvendor", "Dining", userId);
    expect(await categorize(db, "newvendor", userId)).toBe("Dining");
  });
});

test("[Review Focus] a category correction made by one user is invisible to another user's categorize call for the identical vendor string", async () => {
  const db = drizzle(env.DB);
  const a = await seedUserAndSession(db);
  const b = await seedUserAndSession(db);
  await correctCategory(db, "shared-vendor", "User A's category", a.userId);
  expect(await categorize(db, "shared-vendor", a.userId)).toBe("User A's category");
  expect(await categorize(db, "shared-vendor", b.userId)).toBe("Uncategorized");
});
