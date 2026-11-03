import { env } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { describe, expect, test } from "vitest";
import { statementsRoutes } from "../src/routes/statements";
import { transactions } from "../src/db/schema";

describe("statements routes", () => {
  test("POST / with a CSV file imports its rows", async () => {
    const csv = "Date,Description,Amount\n2026-10-27,Starbucks,12.50\n";
    const form = new FormData();
    form.set("file", new File([csv], "statement.csv", { type: "text/csv" }));

    const res = await statementsRoutes.request("/", { method: "POST", body: form }, env);

    expect(res.status).toBe(201);
    const db = drizzle(env.DB);
    expect(await db.select().from(transactions)).toHaveLength(1);
  });

  test("POST / with no file returns 400", async () => {
    const res = await statementsRoutes.request("/", { method: "POST", body: new FormData() }, env);
    expect(res.status).toBe(400);
  });

  test("POST / with an unparseable CSV (no recognizable columns) still returns 201, with every row quarantined", async () => {
    const csv = "TxnDate,Memo,Balance\n2026-10-27,something,100\n";
    const form = new FormData();
    form.set("file", new File([csv], "weird.csv", { type: "text/csv" }));

    const res = await statementsRoutes.request("/", { method: "POST", body: form }, env);

    expect(res.status).toBe(201);
    const db = drizzle(env.DB);
    const [row] = await db.select().from(transactions);
    expect(row.reviewStatus).toBe("pending_review");
  });
});
