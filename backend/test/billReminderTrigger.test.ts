import { env } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { describe, expect, test, vi } from "vitest";
import { evaluateBills } from "../src/services/billReminderTrigger";
import { bills } from "../src/db/schema";

const testEnv = { RESEND_API_KEY: "test-resend-key", NOTIFICATION_EMAIL: "user@example.com" };

function daysFromNow(n: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

describe("evaluateBills", () => {
  test("reminds once for a bill due within the 3-day lookahead window", async () => {
    const db = drizzle(env.DB);
    await db.insert(bills).values({ vendor: "Netflix", expectedAmount: 1500, expectedInterval: "monthly", nextDueDate: daysFromNow(2) });
    const fetchSpy = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchSpy);

    const result = await evaluateBills(db, testEnv);

    expect(result.reminded).toEqual(["Netflix"]);
    expect(fetchSpy).toHaveBeenCalledOnce();
  });

  test("does not re-remind on a second run for the same due date", async () => {
    const db = drizzle(env.DB);
    await db.insert(bills).values({ vendor: "Netflix", expectedAmount: 1500, expectedInterval: "monthly", nextDueDate: daysFromNow(2) });
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 200 })));
    await evaluateBills(db, testEnv);

    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const result = await evaluateBills(db, testEnv);

    expect(result.reminded).toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  test("does not remind for a bill due more than 3 days out", async () => {
    const db = drizzle(env.DB);
    await db.insert(bills).values({ vendor: "Netflix", expectedAmount: 1500, expectedInterval: "monthly", nextDueDate: daysFromNow(10) });
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    const result = await evaluateBills(db, testEnv);

    expect(result.reminded).toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  test("reminds again once next_due_date has moved to a new cycle", async () => {
    const db = drizzle(env.DB);
    const [bill] = await db
      .insert(bills)
      .values({ vendor: "Netflix", expectedAmount: 1500, expectedInterval: "monthly", nextDueDate: daysFromNow(2) })
      .returning();
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 200 })));
    await evaluateBills(db, testEnv);

    const { eq } = await import("drizzle-orm");
    await db.update(bills).set({ nextDueDate: daysFromNow(32) }).where(eq(bills.id, bill.id));
    await db.update(bills).set({ nextDueDate: daysFromNow(1) }).where(eq(bills.id, bill.id));

    const fetchSpy = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchSpy);
    const result = await evaluateBills(db, testEnv);

    expect(result.reminded).toEqual(["Netflix"]);
  });
});
