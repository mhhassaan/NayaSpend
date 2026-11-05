import { env } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { describe, expect, test } from "vitest";
import { trendsRoutes } from "../src/routes/trends";
import { transactions } from "../src/db/schema";

describe("trends routes", () => {
  test("GET /?month=2026-10 returns that month's aggregation", async () => {
    const db = drizzle(env.DB);
    await db.insert(transactions).values({
      amount: -5000, date: "2026-10-15", vendorRaw: "x", vendorNormalized: "x", category: "Coffee",
      source: "manual_missed", provenance: "{}", reviewStatus: "committed",
    });

    const res = await trendsRoutes.request("/?month=2026-10", {}, env);

    expect(res.status).toBe(200);
    const body = (await res.json()) as { spentCents: number; receivedCents: number; hasData: boolean };
    expect(body.spentCents).toBe(5000);
    expect(body.receivedCents).toBe(0);
    expect(body.hasData).toBe(true);
  });

  test("GET / with no month param defaults to the current month", async () => {
    const res = await trendsRoutes.request("/", {}, env);
    expect(res.status).toBe(200);
  });

  test("GET /?month=bad-format returns 400", async () => {
    const res = await trendsRoutes.request("/?month=bad-format", {}, env);
    expect(res.status).toBe(400);
  });

  test("GET /history?months=3 returns 3 months", async () => {
    const res = await trendsRoutes.request("/history?months=3", {}, env);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { months: unknown[] };
    expect(body.months).toHaveLength(3);
  });

  test("GET /history with no months param defaults to 6", async () => {
    const res = await trendsRoutes.request("/history", {}, env);
    const body = (await res.json()) as { months: unknown[] };
    expect(body.months).toHaveLength(6);
  });

  test("GET /history?months=99 returns 400 (exceeds the 24-month cap)", async () => {
    const res = await trendsRoutes.request("/history?months=99", {}, env);
    expect(res.status).toBe(400);
  });

  test("GET /history?months=0 returns 400", async () => {
    const res = await trendsRoutes.request("/history?months=0", {}, env);
    expect(res.status).toBe(400);
  });
});
