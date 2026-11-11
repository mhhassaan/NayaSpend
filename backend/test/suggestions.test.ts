import { buildSuggestionsForUser, generateSuggestion } from "../src/services/llmSuggestionService";
import { categorize } from "../src/services/categorizationEngine";
import { importStatementCsv } from "../src/adapters/statementAdapter";
import { runBackfill, runOngoingPoll } from "../src/adapters/gmailAdapter";
import type { GmailClient } from "../src/adapters/gmailClient";
import { cleanTransactionEmail } from "./fixtures/nayapayEmails";
import { env } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";
import { afterEach, expect, test, vi } from "vitest";
import { transactionsRoutes } from "../src/routes/transactions";
import { transactions } from "../src/db/schema";
import { logMissedTransaction } from "../src/adapters/manualAdapter";
import { seedUserAndSession } from "./helpers/authedRequest";

afterEach(() => vi.unstubAllGlobals());
test("suggestion endpoint requires authentication and scopes generation, reads and dismissal", async () => {
  const db = drizzle(env.DB);
  const a = await seedUserAndSession(db);
  const b = await seedUserAndSession(db);
  const row = await logMissedTransaction(db, { vendorRaw: "Mystery", amountCents: 100, date: "2026-11-01" }, b.userId);
  const fetcher = vi.fn().mockImplementation(() => Promise.resolve(new Response(JSON.stringify({ choices: [{ message: { content: '{"category":"Health"}' } }] }))));
  vi.stubGlobal("fetch", fetcher);
  const bindings = { ...env, DEEPSEEK_API_KEY: "test-key" };
  expect((await transactionsRoutes.request(`/${row.id}/suggestion`, { method: "POST" }, bindings)).status).toBe(401);
  for (const [path, method] of [[`/${row.id}/suggestion`, "POST"], [`/${row.id}`, "GET"], [`/${row.id}/suggestion`, "DELETE"]]) {
    expect((await transactionsRoutes.request(path, { method, headers: { Cookie: a.cookie } }, bindings)).status).toBe(404);
  }
  expect(fetcher).not.toHaveBeenCalled();
  const res = await transactionsRoutes.request(`/${row.id}/suggestion`, { method: "POST", headers: { Cookie: b.cookie } }, bindings);
  expect(res.status).toBe(200);
  expect(await res.json()).toMatchObject({ suggestion: { category: "Health", model: "deepseek-flash" } });
  await transactionsRoutes.request(`/${row.id}/suggestion`, { method: "DELETE", headers: { Cookie: b.cookie } }, bindings);
  const [dismissed] = await db.select().from(transactions).where(eq(transactions.id, row.id));
  expect(dismissed.suggestion).toBeNull();
  expect(dismissed.suggestionStatus).toBe("dismissed");
});
test("capture still commits when DeepSeek fails", async () => {
  const db = drizzle(env.DB);
  const { userId } = await seedUserAndSession(db);
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network failure")));
  const row = await logMissedTransaction(db, { vendorRaw: "Mystery", amountCents: 100, date: "2026-11-01" }, userId, { env: { DEEPSEEK_API_KEY: "test-key" } });
  const [saved] = await db.select().from(transactions).where(eq(transactions.id, row.id));
  expect(saved.reviewStatus).toBe("committed");
  expect(saved.suggestion).toBeNull();
});

const config = { DEEPSEEK_API_KEY: "test-key" };
function response(value: unknown) {
  return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(value) } }] }));
}
test("batch is bounded to 25 and skips dismissed rows", async () => {
  const db = drizzle(env.DB);
  const { userId } = await seedUserAndSession(db);
  const rows = [];
  for (let i = 0; i < 30; i++) {
    const [row] = await db.insert(transactions).values({ userId, amount: -100, date: "2026-11-01", vendorRaw: `shop${i}`, vendorNormalized: `shop${i}`, source: "manual_missed", provenance: "{}", reviewStatus: "committed", suggestionStatus: i === 0 ? "dismissed" : null }).returning();
    rows.push(row);
  }
  const fetcher = vi.fn().mockImplementation(() => Promise.resolve(response({ category: "Health" })));
  vi.stubGlobal("fetch", fetcher);
  await buildSuggestionsForUser(db, config, userId, rows.map(row => row.id));
  expect(fetcher).toHaveBeenCalledTimes(25);
  const saved = await db.select().from(transactions);
  expect(saved.filter(row => row.suggestionStatus === "pending")).toHaveLength(25);
});
test("category acceptance clears the suggestion and teaches future captures", async () => {
  const db = drizzle(env.DB);
  const { userId, cookie } = await seedUserAndSession(db);
  const fetcher = vi.fn().mockImplementation(() => Promise.resolve(response({ category: "Health" })));
  vi.stubGlobal("fetch", fetcher);
  const row = await logMissedTransaction(db, { vendorRaw: "Mystery", amountCents: 100, date: "2026-11-01" }, userId, { env: config });
  const res = await transactionsRoutes.request(`/${row.id}/category`, { method: "PATCH", headers: { Cookie: cookie, "Content-Type": "application/json" }, body: JSON.stringify({ category: "Health" }) }, { ...env, ...config });
  expect(res.status).toBe(200);
  expect(await categorize(db, "Mystery", userId)).toBe("Health");
  const [saved] = await db.select().from(transactions).where(eq(transactions.id, row.id));
  expect(saved.suggestion).toBeNull();
  expect(saved.suggestionStatus).toBe("dismissed");
  await logMissedTransaction(db, { vendorRaw: "Mystery", amountCents: 200, date: "2026-11-02" }, userId, { env: config });
  expect(fetcher).toHaveBeenCalledOnce();
});
test("CSV quarantine preserves a raw excerpt and suggestions never change ledger fields", async () => {
  const db = drizzle(env.DB);
  const { userId, cookie } = await seedUserAndSession(db);
  vi.stubGlobal("fetch", vi.fn().mockImplementation(() => Promise.resolve(response({ vendor: "Store", amount: 125.5, direction: "out" }))));
  await importStatementCsv(db, "Date,Description,Amount\n2026-11-01,Store,PKR 125.50 DR", "file", userId, { env: config });
  const [row] = await db.select().from(transactions);
  expect(row.amount).toBe(0);
  expect(row.reviewStatus).toBe("pending_review");
  expect(JSON.parse(row.provenance).bodyExcerpt).toContain("125.50 DR");
  expect(row.suggestion).toMatchObject({ vendor: "Store", amount: 12550, direction: "out" });
  const patch = await transactionsRoutes.request(`/${row.id}`, { method: "PATCH", headers: { Cookie: cookie, "Content-Type": "application/json" }, body: JSON.stringify({ vendorRaw: "Store", amount: -12550 }) }, env);
  expect(patch.status).toBe(200);
  const commit = await transactionsRoutes.request(`/${row.id}/resolve-review`, { method: "POST", headers: { Cookie: cookie, "Content-Type": "application/json" }, body: JSON.stringify({ action: "commit" }) }, env);
  expect(commit.status).toBe(200);
  const [saved] = await db.select().from(transactions).where(eq(transactions.id, row.id));
  expect(saved.amount).toBe(-12550);
  expect(saved.reviewStatus).toBe("committed");
  expect(saved.suggestion).toBeNull();
  expect(saved.suggestionStatus).not.toBe("pending");
});
test("late generation cannot overwrite a dismissal", async () => {
  const db = drizzle(env.DB);
  const { userId, cookie } = await seedUserAndSession(db);
  const row = await logMissedTransaction(db, { vendorRaw: "Mystery", amountCents: 100, date: "2026-11-01" }, userId);
  let resolve!: (value: Response) => void;
  let started!: () => void;
  const fetching = new Promise<void>(done => { started = done; });
  vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>(done => { resolve = done; started(); })));
  const result = generateSuggestion(db, config, userId, row.id);
  await fetching;
  await transactionsRoutes.request(`/${row.id}/suggestion`, { method: "DELETE", headers: { Cookie: cookie } }, env);
  resolve(response({ category: "Health" }));
  expect(await result).toBeNull();
  const [saved] = await db.select().from(transactions).where(eq(transactions.id, row.id));
  expect(saved.suggestion).toBeNull();
  expect(saved.suggestionStatus).toBe("dismissed");
});
test("list and detail expose suggestions only while configured; explicit retry overrides dismissal", async () => {
  const db = drizzle(env.DB);
  const { userId, cookie } = await seedUserAndSession(db);
  const fetcher = vi.fn().mockImplementation(() => Promise.resolve(response({ category: "Health" })));
  vi.stubGlobal("fetch", fetcher);
  const row = await logMissedTransaction(db, { vendorRaw: "Mystery", amountCents: 100, date: "2026-11-01" }, userId, { env: config });
  for (const path of ["/", `/${row.id}`]) {
    const enabled = await (await transactionsRoutes.request(path, { headers: { Cookie: cookie } }, { ...env, ...config })).json() as typeof transactions.$inferSelect | (typeof transactions.$inferSelect)[];
    expect((Array.isArray(enabled) ? enabled[0] : enabled).suggestion?.category).toBe("Health");
    const disabled = await (await transactionsRoutes.request(path, { headers: { Cookie: cookie } }, { ...env, DEEPSEEK_API_KEY: "" })).json() as typeof transactions.$inferSelect | (typeof transactions.$inferSelect)[];
    expect((Array.isArray(disabled) ? disabled[0] : disabled).suggestion).toBeNull();
  }
  await transactionsRoutes.request(`/${row.id}/suggestion`, { method: "DELETE", headers: { Cookie: cookie } }, env);
  await buildSuggestionsForUser(db, config, userId, [row.id]);
  expect(fetcher).toHaveBeenCalledOnce();
  const retried = await transactionsRoutes.request(`/${row.id}/suggestion`, { method: "POST", headers: { Cookie: cookie } }, { ...env, ...config });
  expect(await retried.json()).toMatchObject({ suggestion: { category: "Health" } });
  expect(fetcher).toHaveBeenCalledTimes(2);
});
test("Gmail backfill and poll remain successful when the model fails", async () => {
  const db = drizzle(env.DB);
  const { userId } = await seedUserAndSession(db);
  let messageId = "backfill";
  const client: GmailClient = {
    getCurrentHistoryId: async () => "1",
    listMessages: async () => ({ messages: [{ id: messageId }] }),
    listHistory: async () => ({ addedMessageIds: [messageId], newHistoryId: "2" }),
    getMessage: async () => ({ ...cleanTransactionEmail, id: messageId }),
  };
  const fetcher = vi.fn().mockResolvedValue(new Response("fail", { status: 500 }));
  vi.stubGlobal("fetch", fetcher);
  expect((await runBackfill(db, client, userId, { env: config })).committed).toBe(1);
  messageId = "poll";
  expect((await runOngoingPoll(db, client, userId, { env: config })).processed).toBe(1);
  const saved = await db.select().from(transactions);
  expect(saved).toHaveLength(2);
  expect(saved.every(row => row.reviewStatus === "committed" && row.suggestion === null)).toBe(true);
  expect(fetcher).toHaveBeenCalledTimes(2);
});
test("capture schedules suggestions without waiting for the model response", async () => {
  const db = drizzle(env.DB);
  const { userId } = await seedUserAndSession(db);
  let resolve!: (value: Response) => void;
  let started!: () => void;
  const fetching = new Promise<void>(done => { started = done; });
  vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>(done => { resolve = done; started(); })));
  const tasks: Promise<void>[] = [];
  const row = await logMissedTransaction(db, { vendorRaw: "Mystery", amountCents: 100, date: "2026-11-01" }, userId, { env: config, waitUntil: task => tasks.push(task) });
  expect(row.id).toBeGreaterThan(0);
  expect(tasks).toHaveLength(1);
  await fetching;
  resolve(response({ category: "Health" }));
  await tasks[0];
  const [saved] = await db.select().from(transactions).where(eq(transactions.id, row.id));
  expect(saved.suggestion?.category).toBe("Health");
});
