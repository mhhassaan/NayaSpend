import { env } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";
import { describe, expect, test } from "vitest";
import { budgetsRoutes } from "../src/routes/budgets";
import { budgets } from "../src/db/schema";

describe("budgets routes", () => {
  test("POST / creates a monthly budget", async () => {
    const res = await budgetsRoutes.request(
      "/",
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ category: "Coffee", limitAmount: 10000, periodType: "monthly" }) },
      env
    );
    expect(res.status).toBe(201);
    const db = drizzle(env.DB);
    expect(await db.select().from(budgets)).toHaveLength(1);
  });

  test("POST / rejects a non-monthly periodType", async () => {
    const res = await budgetsRoutes.request(
      "/",
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ category: "Coffee", limitAmount: 10000, periodType: "weekly" }) },
      env
    );
    expect(res.status).toBe(400);
  });

  test("POST / rejects a zero or negative limitAmount", async () => {
    const res = await budgetsRoutes.request(
      "/",
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ category: "Coffee", limitAmount: 0, periodType: "monthly" }) },
      env
    );
    expect(res.status).toBe(400);
  });

  test("GET / lists budgets", async () => {
    const db = drizzle(env.DB);
    await db.insert(budgets).values({ category: "Coffee", limitAmount: 10000, periodType: "monthly" });
    const res = await budgetsRoutes.request("/", {}, env);
    expect(res.status).toBe(200);
    expect(await res.json()).toHaveLength(1);
  });

  test("PATCH /:id updates a budget's limit", async () => {
    const db = drizzle(env.DB);
    const [row] = await db.insert(budgets).values({ category: "Coffee", limitAmount: 10000, periodType: "monthly" }).returning();
    const res = await budgetsRoutes.request(
      `/${row.id}`,
      { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ limitAmount: 20000 }) },
      env
    );
    expect(res.status).toBe(200);
    const [updated] = await db.select().from(budgets).where(eq(budgets.id, row.id));
    expect(updated.limitAmount).toBe(20000);
  });

  test("DELETE /:id removes a budget", async () => {
    const db = drizzle(env.DB);
    const [row] = await db.insert(budgets).values({ category: "Coffee", limitAmount: 10000, periodType: "monthly" }).returning();
    const res = await budgetsRoutes.request(`/${row.id}`, { method: "DELETE" }, env);
    expect(res.status).toBe(204);
    expect(await db.select().from(budgets)).toHaveLength(0);
  });

  test("PATCH and DELETE on a nonexistent id return 404", async () => {
    const patchRes = await budgetsRoutes.request(
      "/999",
      { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ limitAmount: 5000 }) },
      env
    );
    const deleteRes = await budgetsRoutes.request("/999", { method: "DELETE" }, env);
    expect(patchRes.status).toBe(404);
    expect(deleteRes.status).toBe(404);
  });
});
