import { env } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, test } from "vitest";
import { billsRoutes } from "../src/routes/bills";
import { bills } from "../src/db/schema";

import { seedUserAndSession } from "./helpers/authedRequest";

describe("bills routes", () => {
  let userId: number;
  let cookie: string;
  beforeEach(async () => {
    ({ userId, cookie } = await seedUserAndSession(drizzle(env.DB)));
  });
  test("POST / creates a bill", async () => {
    const res = await billsRoutes.request(
      "/",
      { method: "POST", headers: { Cookie: cookie, "Content-Type": "application/json" }, body: JSON.stringify({ vendor: "Netflix", expectedAmount: 1500, expectedInterval: "monthly", nextDueDate: "2026-11-15" }) },
      env
    );
    expect(res.status).toBe(201);
    const db = drizzle(env.DB);
    expect(await db.select().from(bills)).toHaveLength(1);
  });

  test("POST / rejects a zero or negative expectedAmount", async () => {
    const res = await billsRoutes.request(
      "/",
      { method: "POST", headers: { Cookie: cookie, "Content-Type": "application/json" }, body: JSON.stringify({ vendor: "Netflix", expectedAmount: -1, expectedInterval: "monthly", nextDueDate: "2026-11-15" }) },
      env
    );
    expect(res.status).toBe(400);
  });

  test("POST / rejects a malformed nextDueDate", async () => {
    const res = await billsRoutes.request(
      "/",
      { method: "POST", headers: { Cookie: cookie, "Content-Type": "application/json" }, body: JSON.stringify({ vendor: "Netflix", expectedAmount: 1500, expectedInterval: "monthly", nextDueDate: "not-a-date" }) },
      env
    );
    expect(res.status).toBe(400);
  });

  test("GET / lists bills", async () => {
    const db = drizzle(env.DB);
    await db.insert(bills).values({ userId, vendor: "Netflix", expectedAmount: 1500, expectedInterval: "monthly", nextDueDate: "2026-11-15" });
    const res = await billsRoutes.request("/", { headers: { Cookie: cookie } }, env);
    expect(await res.json()).toHaveLength(1);
  });

  test("PATCH /:id updates nextDueDate", async () => {
    const db = drizzle(env.DB);
    const [row] = await db.insert(bills).values({ userId, vendor: "Netflix", expectedAmount: 1500, expectedInterval: "monthly", nextDueDate: "2026-11-15" }).returning();
    const res = await billsRoutes.request(
      `/${row.id}`,
      { method: "PATCH", headers: { Cookie: cookie, "Content-Type": "application/json" }, body: JSON.stringify({ nextDueDate: "2026-12-15" }) },
      env
    );
    expect(res.status).toBe(200);
    const [updated] = await db.select().from(bills).where(eq(bills.id, row.id));
    expect(updated.nextDueDate).toBe("2026-12-15");
  });

  test("DELETE /:id removes a bill", async () => {
    const db = drizzle(env.DB);
    const [row] = await db.insert(bills).values({ userId, vendor: "Netflix", expectedAmount: 1500, expectedInterval: "monthly", nextDueDate: "2026-11-15" }).returning();
    const res = await billsRoutes.request(`/${row.id}`, { method: "DELETE", headers: { Cookie: cookie } }, env);
    expect(res.status).toBe(204);
    expect(await db.select().from(bills)).toHaveLength(0);
  });

  test("[Review Focus] PATCH /:id 404s for a bill owned by a different user", async () => {
    const db = drizzle(env.DB);
    const userB = await seedUserAndSession(db);
    const [row] = await db.insert(bills).values({ userId: userB.userId, vendor: "Netflix", expectedAmount: 1500, expectedInterval: "monthly", nextDueDate: "2026-11-15" }).returning();
    const res = await billsRoutes.request(`/${row.id}`, {
      method: "PATCH", headers: { Cookie: cookie, "Content-Type": "application/json" },
      body: JSON.stringify({ vendor: "Changed", expectedAmount: 2000, expectedInterval: "yearly", nextDueDate: "2026-12-15" }),
    }, env);
    expect(res.status).toBe(404);
    expect(await db.select().from(bills).where(eq(bills.id, row.id))).toEqual([row]);
  });

  test("[Review Focus] DELETE /:id 404s for a bill owned by a different user", async () => {
    const db = drizzle(env.DB);
    const userB = await seedUserAndSession(db);
    const [row] = await db.insert(bills).values({ userId: userB.userId, vendor: "Netflix", expectedAmount: 1500, expectedInterval: "monthly", nextDueDate: "2026-11-15" }).returning();
    const res = await billsRoutes.request(`/${row.id}`, { method: "DELETE", headers: { Cookie: cookie } }, env);
    expect(res.status).toBe(404);
    expect(await db.select().from(bills).where(eq(bills.id, row.id))).toEqual([row]);
  });

  test("GET / only returns the authenticated user's own bills", async () => {
    const db = drizzle(env.DB);
    const userB = await seedUserAndSession(db);
    const [own] = await db.insert(bills).values({ userId, vendor: "Netflix", expectedAmount: 1500, expectedInterval: "monthly", nextDueDate: "2026-11-15" }).returning();
    await db.insert(bills).values({ userId: userB.userId, vendor: "Other", expectedAmount: 2000, expectedInterval: "monthly", nextDueDate: "2026-11-15" });
    const res = await billsRoutes.request("/", { headers: { Cookie: cookie } }, env);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([own]);
  });

  test("POST / sets the authenticated user as the owner", async () => {
    const db = drizzle(env.DB);
    const res = await billsRoutes.request("/", {
      method: "POST", headers: { Cookie: cookie, "Content-Type": "application/json" },
      body: JSON.stringify({ vendor: "Netflix", expectedAmount: 1500, expectedInterval: "monthly", nextDueDate: "2026-11-15" }),
    }, env);
    expect(res.status).toBe(201);
    const row = await res.json() as typeof bills.$inferSelect;
    expect(row.userId).toBe(userId);
    expect(await db.select().from(bills).where(eq(bills.id, row.id))).toEqual([row]);
  });
});
