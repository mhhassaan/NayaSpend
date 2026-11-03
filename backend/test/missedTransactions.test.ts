import { env } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { describe, expect, test, vi } from "vitest";
import { missedTransactionsRoutes } from "../src/routes/missedTransactions";
import { transactions } from "../src/db/schema";

describe("missedTransactions routes", () => {
  test("POST / logs a committed transaction and returns 201 with its id and category", async () => {
    const res = await missedTransactionsRoutes.request(
      "/",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ vendorRaw: "Corner Store", amountCents: 50000, date: "2026-10-27" }),
      },
      env
    );

    expect(res.status).toBe(201);
    const body = (await res.json()) as { id: number; category: string };
    expect(body.id).toBeTypeOf("number");
    const db = drizzle(env.DB);
    const rows = await db.select().from(transactions);
    expect(rows).toHaveLength(1);
  });

  test("POST / with an invalid amount returns 400 and writes nothing", async () => {
    const res = await missedTransactionsRoutes.request(
      "/",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ vendorRaw: "x", amountCents: -5, date: "2026-10-27" }),
      },
      env
    );

    expect(res.status).toBe(400);
    const db = drizzle(env.DB);
    expect(await db.select().from(transactions)).toHaveLength(0);
  });

  test("[I5] an unexpected error (not a validation failure) is not reported as a 400", async () => {
    const manualAdapter = await import("../src/adapters/manualAdapter");
    const spy = vi.spyOn(manualAdapter, "logMissedTransaction").mockRejectedValueOnce(new Error("simulated D1 outage"));

    const res = await missedTransactionsRoutes.request(
      "/",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ vendorRaw: "x", amountCents: 100, date: "2026-10-27" }),
      },
      env
    );

    expect(res.status).toBe(500);
    spy.mockRestore();
  });

  test("POST / with a malformed JSON body returns 400, not a 500", async () => {
    const res = await missedTransactionsRoutes.request(
      "/",
      { method: "POST", headers: { "Content-Type": "application/json" }, body: "not json" },
      env
    );

    expect(res.status).toBe(400);
  });
});
