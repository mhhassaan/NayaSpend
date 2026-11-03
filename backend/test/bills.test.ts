import { env } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";
import { describe, expect, test } from "vitest";
import { billsRoutes } from "../src/routes/bills";
import { bills } from "../src/db/schema";

describe("bills routes", () => {
  test("POST / creates a bill", async () => {
    const res = await billsRoutes.request(
      "/",
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ vendor: "Netflix", expectedAmount: 1500, expectedInterval: "monthly", nextDueDate: "2026-11-15" }) },
      env
    );
    expect(res.status).toBe(201);
    const db = drizzle(env.DB);
    expect(await db.select().from(bills)).toHaveLength(1);
  });

  test("POST / rejects a zero or negative expectedAmount", async () => {
    const res = await billsRoutes.request(
      "/",
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ vendor: "Netflix", expectedAmount: -1, expectedInterval: "monthly", nextDueDate: "2026-11-15" }) },
      env
    );
    expect(res.status).toBe(400);
  });

  test("POST / rejects a malformed nextDueDate", async () => {
    const res = await billsRoutes.request(
      "/",
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ vendor: "Netflix", expectedAmount: 1500, expectedInterval: "monthly", nextDueDate: "not-a-date" }) },
      env
    );
    expect(res.status).toBe(400);
  });

  test("GET / lists bills", async () => {
    const db = drizzle(env.DB);
    await db.insert(bills).values({ vendor: "Netflix", expectedAmount: 1500, expectedInterval: "monthly", nextDueDate: "2026-11-15" });
    const res = await billsRoutes.request("/", {}, env);
    expect(await res.json()).toHaveLength(1);
  });

  test("PATCH /:id updates nextDueDate", async () => {
    const db = drizzle(env.DB);
    const [row] = await db.insert(bills).values({ vendor: "Netflix", expectedAmount: 1500, expectedInterval: "monthly", nextDueDate: "2026-11-15" }).returning();
    const res = await billsRoutes.request(
      `/${row.id}`,
      { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ nextDueDate: "2026-12-15" }) },
      env
    );
    expect(res.status).toBe(200);
    const [updated] = await db.select().from(bills).where(eq(bills.id, row.id));
    expect(updated.nextDueDate).toBe("2026-12-15");
  });

  test("DELETE /:id removes a bill", async () => {
    const db = drizzle(env.DB);
    const [row] = await db.insert(bills).values({ vendor: "Netflix", expectedAmount: 1500, expectedInterval: "monthly", nextDueDate: "2026-11-15" }).returning();
    const res = await billsRoutes.request(`/${row.id}`, { method: "DELETE" }, env);
    expect(res.status).toBe(204);
    expect(await db.select().from(bills)).toHaveLength(0);
  });
});
