import { env } from "cloudflare:test";
import { beforeAll, describe, expect, test } from "vitest";

// Phase 0 feasibility spike (design doc: Risks & Mitigations -> "D1 query
// feasibility"). Validates that D1's SQLite dialect can express the query
// shapes the dedup engine and trends service will need, before committing
// to the real schema in Task 4.

describe("D1 feasibility spike", () => {
  beforeAll(async () => {
    const db = env.DB;
    await db.exec(
      "CREATE TABLE IF NOT EXISTS spike_transactions (" +
        "id INTEGER PRIMARY KEY, " +
        "date TEXT NOT NULL, " +
        "amount INTEGER NOT NULL, " +
        "category TEXT NOT NULL, " +
        "vendor_normalized TEXT NOT NULL" +
        ")"
    );
    await db.exec("DELETE FROM spike_transactions");
    const rows = [
      { date: "2026-10-01", amount: 1000, category: "Coffee", vendor: "starbucks" },
      { date: "2026-10-05", amount: 2000, category: "Coffee", vendor: "starbucks downtown" },
      { date: "2026-10-10", amount: 1500, category: "Groceries", vendor: "wholefoods" },
      { date: "2026-11-01", amount: 3000, category: "Groceries", vendor: "wholefoods market" },
      { date: "2026-11-02", amount: 500, category: "Dining", vendor: "chipotle" },
    ];
    for (const row of rows) {
      await db
        .prepare(
          "INSERT INTO spike_transactions (date, amount, category, vendor_normalized) VALUES (?, ?, ?, ?)"
        )
        .bind(row.date, row.amount, row.category, row.vendor)
        .run();
    }
  });

  test("date-range query (proxy for dedup's date-proximity check)", async () => {
    const result = await env.DB
      .prepare("SELECT * FROM spike_transactions WHERE date BETWEEN ? AND ?")
      .bind("2026-10-01", "2026-10-31")
      .all();
    expect(result.results.length).toBe(3);
  });

  test("GROUP BY category+month aggregation (proxy for trends service)", async () => {
    type MonthlyTotal = { category: string; month: string; total: number };
    const result = await env.DB
      .prepare(
        "SELECT category, substr(date, 1, 7) AS month, SUM(amount) AS total " +
          "FROM spike_transactions GROUP BY category, month ORDER BY category, month"
      )
      .all<MonthlyTotal>();
    expect(result.results.length).toBeGreaterThan(0);
    const groceriesNov = result.results.find(
      (r) => r.category === "Groceries" && r.month === "2026-11"
    );
    expect(groceriesNov).toBeDefined();
    expect(groceriesNov?.total).toBe(3000);
  });

  test("LIKE-based substring pre-filter on vendor_normalized (coarse half of fuzzy-match)", async () => {
    const result = await env.DB
      .prepare("SELECT * FROM spike_transactions WHERE vendor_normalized LIKE ?")
      .bind("%starbucks%")
      .all();
    expect(result.results.length).toBe(2);
  });
});
