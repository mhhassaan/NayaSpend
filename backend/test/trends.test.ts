import { seedUserAndSession } from "./helpers/authedRequest";
import { env } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { beforeEach, describe, expect, test } from "vitest";
import { trendsRoutes } from "../src/routes/trends";
import { transactions } from "../src/db/schema";

let userId: number;
let cookie: string;
beforeEach(async () => {
  ({ userId, cookie } = await seedUserAndSession(drizzle(env.DB)));
});

describe("trends routes", () => {
  test("GET /?month=2026-10 returns that month's aggregation", async () => {
    const db = drizzle(env.DB);
    await db.insert(transactions).values({ userId,
      amount: -5000, date: "2026-10-15", vendorRaw: "x", vendorNormalized: "x", category: "Coffee",
      source: "manual_missed", provenance: "{}", reviewStatus: "committed",
    });

    const res = await trendsRoutes.request("/?month=2026-10", { headers: { Cookie: cookie } }, env);

    expect(res.status).toBe(200);
    const body = (await res.json()) as { spentCents: number; receivedCents: number; hasData: boolean };
    expect(body.spentCents).toBe(5000);
    expect(body.receivedCents).toBe(0);
    expect(body.hasData).toBe(true);
  });

  test("GET / with no month param defaults to the current month", async () => {
    const res = await trendsRoutes.request("/", { headers: { Cookie: cookie } }, env);
    expect(res.status).toBe(200);
  });

  test("GET /?month=bad-format returns 400", async () => {
    const res = await trendsRoutes.request("/?month=bad-format", { headers: { Cookie: cookie } }, env);
    expect(res.status).toBe(400);
  });

  test("GET /history?months=3 returns 3 months", async () => {
    const res = await trendsRoutes.request("/history?months=3", { headers: { Cookie: cookie } }, env);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { months: unknown[] };
    expect(body.months).toHaveLength(3);
  });

  test("GET /history with no months param defaults to 6", async () => {
    const res = await trendsRoutes.request("/history", { headers: { Cookie: cookie } }, env);
    const body = (await res.json()) as { months: unknown[] };
    expect(body.months).toHaveLength(6);
  });

  test("GET /history?months=99 returns 400 (exceeds the 24-month cap)", async () => {
    const res = await trendsRoutes.request("/history?months=99", { headers: { Cookie: cookie } }, env);
    expect(res.status).toBe(400);
  });

  test("GET /history?months=0 returns 400", async () => {
    const res = await trendsRoutes.request("/history?months=0", { headers: { Cookie: cookie } }, env);
    expect(res.status).toBe(400);
  });
});

test("[Review Focus] trends endpoints require authentication and exclude other users' spending", async () => {
  const db = drizzle(env.DB);
  const other = await seedUserAndSession(db);
  const month = new Date().toISOString().slice(0, 7);
  for (const [owner, amount] of [[userId, -1000], [other.userId, -9000]]) {
    await db.insert(transactions).values({ userId: owner, amount, date: `${month}-05`, vendorRaw: "x", vendorNormalized: "x", category: "Coffee", source: "manual_missed", provenance: "{}", reviewStatus: "committed" });
  }
  for (const path of [`/?month=${month}`, "/history?months=1"]) {
    expect((await trendsRoutes.request(path, {}, env)).status).toBe(401);
    const response = await trendsRoutes.request(path, { headers: { Cookie: cookie } }, env);
    expect(response.status).toBe(200);
    const body = await response.json() as { spentCents: number; months?: { spentCents: number }[] };
    expect(body.months ? body.months[0].spentCents : body.spentCents).toBe(1000);
  }
});
