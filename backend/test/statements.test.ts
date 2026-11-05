import { seedUserAndSession } from "./helpers/authedRequest";
import { env } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { beforeEach, describe, expect, test } from "vitest";
import { statementsRoutes } from "../src/routes/statements";
import { transactions } from "../src/db/schema";

let userId: number;
let cookie: string;
beforeEach(async () => {
  ({ userId, cookie } = await seedUserAndSession(drizzle(env.DB)));
});

describe("statements routes", () => {
  test("POST / with a CSV file imports its rows", async () => {
    const csv = "Date,Description,Amount\n2026-10-27,Starbucks,12.50\n";
    const form = new FormData();
    form.set("file", new File([csv], "statement.csv", { type: "text/csv" }));

    const res = await statementsRoutes.request("/", { headers: { Cookie: cookie }, method: "POST", body: form }, env);

    expect(res.status).toBe(201);
    const db = drizzle(env.DB);
    expect(await db.select().from(transactions)).toHaveLength(1);
  });

  test("POST / with no file returns 400", async () => {
    const res = await statementsRoutes.request("/", { headers: { Cookie: cookie }, method: "POST", body: new FormData() }, env);
    expect(res.status).toBe(400);
  });

  test("POST / with an unparseable CSV (no recognizable columns) still returns 201, with every row quarantined", async () => {
    const csv = "TxnDate,Memo,Balance\n2026-10-27,something,100\n";
    const form = new FormData();
    form.set("file", new File([csv], "weird.csv", { type: "text/csv" }));

    const res = await statementsRoutes.request("/", { headers: { Cookie: cookie }, method: "POST", body: form }, env);

    expect(res.status).toBe(201);
    const db = drizzle(env.DB);
    const [row] = await db.select().from(transactions);
    expect(row.reviewStatus).toBe("pending_review");
  });

  // [Final review C1] fileRef used to be name+Date.now(), so re-uploading
  // the exact same file (e.g. a retry after a dropped response) got a
  // fresh key every time and silently double-imported every row --
  // contradicting importStatementCsv's own idempotency promise.
  test("[C1] re-uploading the exact same file content imports it only once", async () => {
    const csv = "Date,Description,Amount\n2026-10-27,Starbucks,12.50\n";
    const makeForm = () => {
      const form = new FormData();
      form.set("file", new File([csv], "statement.csv", { type: "text/csv" }));
      return form;
    };

    const first = await statementsRoutes.request("/", { headers: { Cookie: cookie }, method: "POST", body: makeForm() }, env);
    expect(first.status).toBe(201);
    const second = await statementsRoutes.request("/", { headers: { Cookie: cookie }, method: "POST", body: makeForm() }, env);
    expect(second.status).toBe(201);

    const db = drizzle(env.DB);
    expect(await db.select().from(transactions)).toHaveLength(1);
  });

  // [Final review I4] a non-CSV file (wrong extension and content type)
  // must be rejected, not run through the CSV parser and quarantined.
  test("[I4] rejects a file that is neither named .csv nor sent as CSV content", async () => {
    const form = new FormData();
    form.set("file", new File(["%PDF-1.4 binary garbage"], "statement.pdf", { type: "application/pdf" }));

    const res = await statementsRoutes.request("/", { headers: { Cookie: cookie }, method: "POST", body: form }, env);

    expect(res.status).toBe(400);
    const db = drizzle(env.DB);
    expect(await db.select().from(transactions)).toHaveLength(0);
  });

  // [Final review I4] an empty file (or header-only CSV) has nothing to
  // import -- reporting 201 with imported: 0 reads as a silent success,
  // which the Review Focus item explicitly rules out.
  test("[I4] a CSV with a header row but no data rows returns 422, not a misleadingly successful 201", async () => {
    const form = new FormData();
    form.set("file", new File(["Date,Description,Amount\n"], "empty.csv", { type: "text/csv" }));

    const res = await statementsRoutes.request("/", { headers: { Cookie: cookie }, method: "POST", body: form }, env);

    expect(res.status).toBe(422);
    const db = drizzle(env.DB);
    expect(await db.select().from(transactions)).toHaveLength(0);
  });
});

test("[Review Focus] a statement imported by one user sets that user as the owner of every inserted row, both committed and quarantined", async () => {
  const form = new FormData();
  form.set("file", new File(["Date,Description,Amount\n2026-10-27,Starbucks,12.50\n2026-10-27,Broken,garbage\n"], "mixed.csv"));
  const res = await statementsRoutes.request("/", { method: "POST", headers: { Cookie: cookie }, body: form }, env);
  expect(res.status).toBe(201);
  const rows = await drizzle(env.DB).select().from(transactions);
  expect(rows.map(r => r.reviewStatus).sort()).toEqual(["committed", "pending_review"]);
  expect(rows.map(r => r.userId)).toEqual([userId, userId]);
});
