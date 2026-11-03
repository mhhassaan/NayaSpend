import { env } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { describe, expect, test } from "vitest";
import { trendsRoutes } from "../src/routes/trends";
import { transactions } from "../src/db/schema";

describe("trends routes", () => {
  test("GET /?month=2026-10 returns that month's aggregation", async () => {
    const db = drizzle(env.DB);
    await db.insert(transactions).values({
      amount: 5000, date: "2026-10-15", vendorRaw: "x", vendorNormalized: "x", category: "Coffee",
      source: "manual_missed", provenance: "{}", reviewStatus: "committed",
    });

    const res = await trendsRoutes.request("/?month=2026-10", {}, env);

    expect(res.status).toBe(200);
    const body = (await res.json()) as { totalCents: number; hasData: boolean };
    expect(body.totalCents).toBe(5000);
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
});
