import { env } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";
import { describe, expect, test } from "vitest";
import { seedUserAndSession } from "./helpers/authedRequest";
import { captureRuns, transactions, categoryRules } from "../src/db/schema";
import { runBackfill, runOngoingPoll } from "../src/adapters/gmailAdapter";
import { runDedupCheck } from "../src/services/dedupEngine";
import { emailKindFixtures, cleanTransactionEmail } from "./fixtures/nayapayEmails";
import type { GmailClient, GmailMessage } from "../src/adapters/gmailClient";

function clientFor(emails: GmailMessage[]): GmailClient {
  return {
    async listMessages() { return { messages: emails.map(({ id }) => ({ id })) }; },
    async getMessage(id) { return emails.find(email => email.id === id)!; },
    async getCurrentHistoryId() { return "100"; },
    async listHistory() { return { addedMessageIds: emails.map(email => email.id), newHistoryId: "200" }; },
  };
}

describe("expanded NayaPay capture", () => {
  test("backfill stores each kind with signed amounts and product/transfer defaults", async () => {
    const db = drizzle(env.DB);
    const { userId } = await seedUserAndSession(db);
    const client = clientFor(emailKindFixtures.map(f => f.email));
    await runBackfill(db, client, userId);
    const rows = await db.select().from(transactions);
    expect(rows).toHaveLength(emailKindFixtures.length);
    for (const fixture of emailKindFixtures) {
      const row = rows.find(row => row.gmailMessageId === fixture.email.id)!;
      expect(row).toMatchObject({ amount: fixture.direction === "in" ? fixture.amountCents : -fixture.amountCents,
        vendorRaw: fixture.vendorRaw, date: fixture.date, reviewStatus: "committed" });
      expect(row.category).toBe(fixture.kind === "spent" ? "Groceries" : fixture.kind === "mtag" ? "Transport"
        : fixture.kind === "bundle" || fixture.kind === "topup" ? "Utilities" : "Transfers");
    }
    await db.update(captureRuns).set({ backfillCompletedAt: null, backfillPageToken: null });
    await runBackfill(db, client, userId);
    expect(await db.select().from(transactions)).toHaveLength(emailKindFixtures.length);
  });

  test("a restarted backfill adds an old ignored receipt without duplicating a spend", async () => {
    const db = drizzle(env.DB);
    const { userId } = await seedUserAndSession(db);
    await runBackfill(db, clientFor([cleanTransactionEmail]), userId);
    await db.update(captureRuns).set({ backfillCompletedAt: null, backfillPageToken: null });
    await runBackfill(db, clientFor([cleanTransactionEmail, emailKindFixtures[7].email]), userId);
    expect((await db.select().from(transactions)).map(row => row.amount).sort((a, b) => a - b)).toEqual([-125000, 196999]);
  });

  test("poll keeps failed send and reversal independently at net zero and quarantines unknown layouts", async () => {
    const db = drizzle(env.DB);
    const { userId } = await seedUserAndSession(db);
    await db.insert(captureRuns).values({ userId, runStatus: "success", pollingHistoryId: "100" });
    const reversal = emailKindFixtures[9].email;
    const sent = { ...emailKindFixtures[1].email, id: "failed-send", subject: "You sent Rs. 1,100 to MCB Islamic-0001",
      bodyText: "11 Nov 2026, 08:43 PM AMOUNT DETAILS Amount Sent Rs. 1,100" };
    const broken = { ...emailKindFixtures[7].email, id: "broken-incoming", bodyText: "A changed receipt template" };
    await runOngoingPoll(db, clientFor([sent, reversal, broken]), userId);
    const rows = await db.select().from(transactions);
    expect(rows).toHaveLength(3);
    expect(rows.filter(row => row.reviewStatus === "committed").map(row => row.amount).sort((a, b) => a - b)).toEqual([-110000, 110000]);
    expect(rows.reduce((sum, row) => sum + row.amount, 0)).toBe(0);
    expect(rows.every(row => row.dedupGroupId === null)).toBe(true);
    const quarantined = rows.find(row => row.gmailMessageId === broken.id)!;
    expect(quarantined).toMatchObject({ amount: 0, reviewStatus: "pending_review" });
    expect(JSON.parse(quarantined.provenance).quarantineReason).toBeDefined();
  });

  test("saved vendor rule wins over transfer default", async () => {
    const db = drizzle(env.DB);
    const { userId } = await seedUserAndSession(db);
    await db.insert(categoryRules).values({ userId, vendorNormalized: "raza auto parts and oil store", category: "Transport" });
    await runBackfill(db, clientFor([emailKindFixtures[2].email]), userId);
    expect((await db.select().from(transactions))[0].category).toBe("Transport");
  });

  test.each([125000, -125000])("dedup matches only the same signed amount (%s)", async amount => {
    const db = drizzle(env.DB);
    const { userId } = await seedUserAndSession(db);
    const common = { userId, date: "2026-11-11", vendorRaw: "Test Sender", vendorNormalized: "test sender",
      category: "Transfers", provenance: "{}", reviewStatus: "committed" };
    const [email] = await db.insert(transactions).values({ ...common, amount, source: "gmail_email" }).returning();
    const [opposite] = await db.insert(transactions).values({ ...common, amount: -amount, source: "statement_import" }).returning();
    expect((await runDedupCheck(db, opposite.id)).matched).toBe(false);
    const [matching] = await db.insert(transactions).values({ ...common, amount, source: "statement_import" }).returning();
    expect((await runDedupCheck(db, matching.id)).matched).toBe(true);
    expect((await db.select().from(transactions).where(eq(transactions.id, email.id)))[0].dedupGroupId).not.toBeNull();
    expect((await db.select().from(transactions).where(eq(transactions.id, opposite.id)))[0].dedupGroupId).toBeNull();
  });
});
