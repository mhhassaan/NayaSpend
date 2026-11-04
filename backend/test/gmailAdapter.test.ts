import { env } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";
import { describe, expect, test, vi } from "vitest";
import { captureRuns, transactions } from "../src/db/schema";
import { runBackfill, runOngoingPoll } from "../src/adapters/gmailAdapter";
import { parseNayaPayEmail } from "../src/adapters/parseNayaPayEmail";
import {
  cleanTransactionEmail,
  malformedLayoutEmail,
  pkrFormatEmail,
  promoEmailNoAmount,
  realWorldSpendEmail,
} from "./fixtures/nayapayEmails";
import type { GmailClient, GmailMessage } from "../src/adapters/gmailClient";

describe("parseNayaPayEmail", () => {
  test("parses a clean 'Rs. 1,250.00' transaction email to 125000 cents", () => {
    const result = parseNayaPayEmail(cleanTransactionEmail);
    expect(result.confidence).toBe("high");
    if (result.confidence === "high") {
      expect(result.amountCents).toBe(125000);
      expect(result.vendorRaw).toContain("Starbucks");
    }
  });

  test("parses a 'PKR 500' format email to 50000 cents", () => {
    const result = parseNayaPayEmail(pkrFormatEmail);
    expect(result.confidence).toBe("high");
    if (result.confidence === "high") {
      expect(result.amountCents).toBe(50000);
    }
  });

  test("a matching email with no transaction amount is low-confidence, not thrown", () => {
    const result = parseNayaPayEmail(promoEmailNoAmount);
    expect(result.confidence).toBe("low");
  });

  test("a malformed/unexpected body layout is low-confidence, not thrown", () => {
    const result = parseNayaPayEmail(malformedLayoutEmail);
    expect(result.confidence).toBe("low");
  });

  test("[real-world] parses NayaPay's actual 'You spent' email template (Amount Paid / Merchant Details labels, no 'spent' in the body)", () => {
    const result = parseNayaPayEmail(realWorldSpendEmail);
    expect(result.confidence).toBe("high");
    if (result.confidence === "high") {
      expect(result.amountCents).toBe(247100);
      expect(result.vendorRaw).toContain("KHAYABAN PHARMACYY");
    }
  });

  test("a 'PKR 1250' amount with no decimal point still parses to 125000 cents", () => {
    const result = parseNayaPayEmail({
      ...pkrFormatEmail,
      subject: "You spent PKR 1250",
      bodyText: "You spent PKR 1250 to Some Vendor on 2026-10-27.",
    });
    expect(result.confidence).toBe("high");
    if (result.confidence === "high") {
      expect(result.amountCents).toBe(125000);
    }
  });

  test("a promotional email containing 'offers 20' is not mistaken for a Rs/PKR 20 transaction", () => {
    const result = parseNayaPayEmail({
      ...promoEmailNoAmount,
      subject: "Exclusive offers inside",
      bodyText: "Exclusive offers 20% off when you shop at Daraz. Download the app now!",
    });
    expect(result.confidence).toBe("low");
  });

  test("vendor extraction is not fooled by an early greeting like 'Welcome to NayaPay'", () => {
    const result = parseNayaPayEmail({
      ...cleanTransactionEmail,
      subject: "You spent Rs. 300",
      bodyText: "Welcome to NayaPay. You spent Rs. 300 at KFC on 2026-10-27.",
    });
    expect(result.confidence).toBe("high");
    if (result.confidence === "high") {
      expect(result.vendorRaw).toBe("KFC");
    }
  });

  test("an amount with 3+ decimal digits is quarantined rather than silently rounded", () => {
    const result = parseNayaPayEmail({
      ...cleanTransactionEmail,
      subject: "You spent Rs. 1,250.555",
      bodyText: "You spent Rs. 1,250.555 at Starbucks on 2026-10-27.",
    });
    expect(result.confidence).toBe("low");
  });

  test("an amount with exactly 1 decimal digit parses correctly (1250.5 -> 125050 cents)", () => {
    const result = parseNayaPayEmail({
      ...cleanTransactionEmail,
      subject: "You spent Rs. 1250.5",
      bodyText: "You spent Rs. 1250.5 at Starbucks on 2026-10-27.",
    });
    expect(result.confidence).toBe("high");
    if (result.confidence === "high") {
      expect(result.amountCents).toBe(125050);
    }
  });

  test("prefers an explicit date in the email body over the raw UTC receive timestamp", () => {
    // internalDate below is a UTC timestamp that would slice to a different
    // calendar date than the one explicitly stated in the body.
    const result = parseNayaPayEmail({
      ...cleanTransactionEmail,
      internalDate: "1761610200000", // 2025-10-28T00:30:00Z
      bodyText: "You spent Rs. 1,250.00 at Starbucks on 2026-10-27.",
    });
    expect(result.confidence).toBe("high");
    if (result.confidence === "high") {
      expect(result.date).toBe("2026-10-27");
    }
  });

  test("falls back to Asia/Karachi local date (UTC+5) when the body has no explicit date", () => {
    // 1761611400000 = 2025-10-28T00:50:00Z -> 2025-10-28T05:50:00+05:00,
    // still October 28 in Karachi, but let's pick a time that actually
    // crosses midnight in Karachi vs UTC: 2025-10-27T20:30:00Z is
    // 2025-10-28T01:30:00+05:00 -- UTC date is the 27th, Karachi date is the 28th.
    const result = parseNayaPayEmail({
      ...cleanTransactionEmail,
      internalDate: "1761597000000", // 2025-10-27T20:30:00Z
      bodyText: "You spent Rs. 1,250.00 at Starbucks.", // no explicit date
    });
    expect(result.confidence).toBe("high");
    if (result.confidence === "high") {
      expect(result.date).toBe("2025-10-28");
    }
  });
});

type FakePage = { messages: { id: string }[]; nextPageToken?: string };

function fakeClient(
  pages: Record<string, FakePage>,
  bodies: Record<string, GmailMessage>,
  options?: { failGetMessageIds?: string[]; failListOnce?: Error }
): GmailClient & { listMessagesCalls: { pageToken: string | undefined; maxResults: number }[] } {
  const listMessagesCalls: { pageToken: string | undefined; maxResults: number }[] = [];
  let listFailurePending = options?.failListOnce;

  return {
    listMessagesCalls,
    async listMessages(pageToken, maxResults) {
      listMessagesCalls.push({ pageToken, maxResults });
      if (listFailurePending) {
        const err = listFailurePending;
        listFailurePending = undefined;
        throw err;
      }
      return pages[pageToken ?? "first"] ?? { messages: [] };
    },
    async getMessage(id) {
      if (options?.failGetMessageIds?.includes(id)) {
        throw new Error(`simulated fetch failure for ${id}`);
      }
      return bodies[id];
    },
    async listHistory(_startHistoryId, _maxResults, _pageToken) {
      return { addedMessageIds: [], newHistoryId: "unused" };
    },
    async getCurrentHistoryId() {
      return "unused";
    },
  };
}

describe("runBackfill", () => {
  test("parses a chunk of matching messages, writes high-confidence ones as committed", async () => {
    const db = drizzle(env.DB);
    const client = fakeClient(
      { first: { messages: [{ id: "m-clean" }] } },
      { "m-clean": cleanTransactionEmail }
    );

    const result = await runBackfill(db, client);

    expect(result.processed).toBe(1);
    expect(result.nextPageToken).toBeNull();
    const rows = await db.select().from(transactions);
    expect(rows).toHaveLength(1);
    expect(rows[0].source).toBe("gmail_email");
    expect(rows[0].reviewStatus).toBe("committed");
    expect(rows[0].vendorNormalized).toBe("starbucks");
  });

  test("a low-confidence parse is written as pending_review, not dropped, and carries subject/body for review", async () => {
    const db = drizzle(env.DB);
    const client = fakeClient(
      { first: { messages: [{ id: "m-promo" }] } },
      { "m-promo": promoEmailNoAmount }
    );

    await runBackfill(db, client);

    const rows = await db.select().from(transactions);
    expect(rows).toHaveLength(1);
    expect(rows[0].reviewStatus).toBe("pending_review");
    const provenance = JSON.parse(rows[0].provenance);
    expect(provenance.quarantineReason).toBeDefined();
    expect(provenance.subject).toBe(promoEmailNoAmount.subject);
    expect(provenance.bodyExcerpt).toContain(promoEmailNoAmount.bodyText.slice(0, 20));
  });

  test("persists nextPageToken to capture_runs so an interruption can resume", async () => {
    const db = drizzle(env.DB);
    const client = fakeClient(
      { first: { messages: [{ id: "m-clean" }], nextPageToken: "page2token" } },
      { "m-clean": cleanTransactionEmail }
    );

    const result = await runBackfill(db, client);

    expect(result.nextPageToken).toBe("page2token");
    const [run] = await db.select().from(captureRuns);
    expect(run.backfillPageToken).toBe("page2token");
    expect(run.backfillCompletedAt).toBeNull();
  });

  test("resuming from a saved pageToken does not reprocess the first page", async () => {
    const db = drizzle(env.DB);
    await db.insert(captureRuns).values({ runStatus: "job_did_not_run", backfillPageToken: "page2token" });
    const client = fakeClient(
      { page2token: { messages: [{ id: "m-pkr" }] } },
      { "m-pkr": pkrFormatEmail }
    );

    const result = await runBackfill(db, client);

    expect(result.processed).toBe(1);
    const rows = await db.select().from(transactions);
    expect(rows).toHaveLength(1); // only m-pkr, never a page-1 message
  });

  test("[C1] passes maxMessagesPerChunk through as Gmail's own maxResults, never truncating a returned page after the fact", async () => {
    const db = drizzle(env.DB);
    const client = fakeClient(
      { first: { messages: [{ id: "m-clean" }] } },
      { "m-clean": cleanTransactionEmail }
    );

    await runBackfill(db, client, { maxMessagesPerChunk: 7 });

    expect(client.listMessagesCalls[0].maxResults).toBe(7);
  });

  test("[C3] once backfill is marked complete, a later call does not contact Gmail again or reprocess anything", async () => {
    const db = drizzle(env.DB);
    const completingClient = fakeClient(
      { first: { messages: [{ id: "m-clean" }] } }, // no nextPageToken -> backfill finishes
      { "m-clean": cleanTransactionEmail }
    );
    await runBackfill(db, completingClient);
    const [afterFirstRun] = await db.select().from(captureRuns);
    expect(afterFirstRun.backfillCompletedAt).not.toBeNull();

    const secondClient = fakeClient(
      { first: { messages: [{ id: "m-clean" }] } },
      { "m-clean": cleanTransactionEmail }
    );
    const result = await runBackfill(db, secondClient);

    expect(result.processed).toBe(0);
    expect(secondClient.listMessagesCalls).toHaveLength(0);
    const rows = await db.select().from(transactions);
    expect(rows).toHaveLength(1); // still just the one from the first run
  });

  test("[C2] re-running the exact same chunk (simulating a retry after an interruption) does not create duplicate transactions", async () => {
    const db = drizzle(env.DB);
    const page: FakePage = { messages: [{ id: "m-clean" }], nextPageToken: "page2token" };
    const client1 = fakeClient({ first: page }, { "m-clean": cleanTransactionEmail });
    await runBackfill(db, client1);

    // Simulate "the checkpoint never advanced" by resetting it back to
    // the same starting point and re-running against the same messages.
    await db.update(captureRuns).set({ backfillPageToken: null, backfillCompletedAt: null });
    const client2 = fakeClient({ first: page }, { "m-clean": cleanTransactionEmail });
    await runBackfill(db, client2);

    const rows = await db.select().from(transactions);
    expect(rows).toHaveLength(1); // not 2 -- onConflictDoNothing on gmailMessageId
  });

  test("[I1] a single message's fetch failure is skipped, not fatal to the rest of the chunk", async () => {
    const db = drizzle(env.DB);
    const client = fakeClient(
      { first: { messages: [{ id: "m-clean" }, { id: "m-pkr" }] } },
      { "m-clean": cleanTransactionEmail, "m-pkr": pkrFormatEmail },
      { failGetMessageIds: ["m-clean"] }
    );

    const result = await runBackfill(db, client);

    expect(result.processed).toBe(1); // only m-pkr succeeded
    const rows = await db.select().from(transactions);
    expect(rows).toHaveLength(1);
    expect(rows[0].vendorNormalized).toBe("daraz online store");
  });

  test("[I1] a whole-page Gmail API failure does not advance or clear the checkpoint, and records the error type", async () => {
    const db = drizzle(env.DB);
    await db.insert(captureRuns).values({ runStatus: "job_did_not_run", backfillPageToken: "page5token" });
    const { GmailApiError } = await import("../src/adapters/gmailClient");
    const client = fakeClient(
      {},
      {},
      { failListOnce: new GmailApiError(401, "auth_failure", "token expired") }
    );

    const result = await runBackfill(db, client);

    expect(result.processed).toBe(0);
    const [run] = await db.select().from(captureRuns);
    expect(run.backfillPageToken).toBe("page5token"); // unchanged
    expect(run.backfillCompletedAt).toBeNull();
    expect(run.runStatus).toBe("api_call_failed");
    expect(run.errorType).toBe("auth_failure");
  });

  test("a committed Gmail transaction is dedup-checked against an existing statement_import transaction", async () => {
    const db = drizzle(env.DB);
    await db.insert(transactions).values({
      amount: 125000,
      date: "2026-10-27",
      vendorRaw: "Starbucks Coffee",
      vendorNormalized: "starbucks coffee",
      category: "Coffee",
      source: "statement_import",
      provenance: "{}",
      reviewStatus: "committed",
    });

    const client = fakeClient(
      { first: { messages: [{ id: "m-clean" }] } },
      { "m-clean": { ...cleanTransactionEmail, bodyText: "You spent Rs. 1,250.00 at Starbucks on 2026-10-27." } }
    );
    await runBackfill(db, client);

    const [gmailRow] = await db.select().from(transactions).where(eq(transactions.source, "gmail_email"));
    expect(gmailRow.dedupGroupId).not.toBeNull();
  });

  test("a quarantined Gmail transaction is never dedup-checked", async () => {
    const db = drizzle(env.DB);
    await db.insert(transactions).values({
      amount: 0,
      date: "2026-10-27",
      vendorRaw: "(unavailable)",
      vendorNormalized: "(unavailable)",
      category: "Uncategorized",
      source: "statement_import",
      provenance: "{}",
      reviewStatus: "committed",
    });

    const client = fakeClient(
      { first: { messages: [{ id: "m-promo" }] } },
      { "m-promo": promoEmailNoAmount }
    );
    await runBackfill(db, client);

    const [gmailRow] = await db.select().from(transactions).where(eq(transactions.source, "gmail_email"));
    expect(gmailRow.dedupGroupId).toBeNull();
  });

  test("[I2] a dedup check that throws does not crash the whole chunk or lose the already-committed rows", async () => {
    const db = drizzle(env.DB);
    const dedupEngine = await import("../src/services/dedupEngine");
    const spy = vi.spyOn(dedupEngine, "runDedupCheck").mockRejectedValueOnce(new Error("simulated D1 blip"));

    const client = fakeClient(
      { first: { messages: [{ id: "m-clean" }] } },
      { "m-clean": cleanTransactionEmail }
    );

    const result = await runBackfill(db, client);

    expect(result.processed).toBe(1); // the row still landed
    const rows = await db.select().from(transactions);
    expect(rows).toHaveLength(1);
    expect(rows[0].reviewStatus).toBe("committed");
    const [run] = await db.select().from(captureRuns);
    expect(run.runStatus).toBe("success"); // the chunk itself still succeeded

    spy.mockRestore();
  });

  test("[C3] seeds pollingHistoryId on the very first backfill call, before completion -- even when more pages remain", async () => {
    const db = drizzle(env.DB);
    const client = fakeClient(
      { first: { messages: [{ id: "m-clean" }], nextPageToken: "page2" } },
      { "m-clean": cleanTransactionEmail }
    );
    client.getCurrentHistoryId = async () => "500";

    await runBackfill(db, client);

    const [run] = await db.select().from(captureRuns);
    expect(run.backfillCompletedAt).toBeNull(); // backfill itself is not done yet
    expect(run.pollingHistoryId).toBe("500"); // but the watermark is already seeded
  });

  test("[C3] a later backfill call (resuming from a saved pageToken) does not re-seed an already-set pollingHistoryId", async () => {
    const db = drizzle(env.DB);
    await db.insert(captureRuns).values({
      runStatus: "success",
      backfillPageToken: "page2",
      pollingHistoryId: "500",
    });
    const client = fakeClient(
      { page2: { messages: [{ id: "m-clean" }] } },
      { "m-clean": cleanTransactionEmail }
    );
    client.getCurrentHistoryId = async () => {
      throw new Error("must not be called again once pollingHistoryId is already seeded");
    };

    await runBackfill(db, client);

    const [run] = await db.select().from(captureRuns);
    expect(run.pollingHistoryId).toBe("500"); // unchanged
  });

  test("[C3/C5] if seeding the watermark fails on the very first call, the error is recorded and no page is listed", async () => {
    const db = drizzle(env.DB);
    const { GmailApiError } = await import("../src/adapters/gmailClient");
    const client = fakeClient(
      { first: { messages: [{ id: "m-clean" }] } },
      { "m-clean": cleanTransactionEmail }
    );
    client.getCurrentHistoryId = async () => {
      throw new GmailApiError(401, "auth_failure", "token expired");
    };

    const result = await runBackfill(db, client);

    expect(result.processed).toBe(0);
    expect(client.listMessagesCalls).toHaveLength(0);
    const [run] = await db.select().from(captureRuns);
    expect(run.runStatus).toBe("api_call_failed");
    expect(run.errorType).toBe("auth_failure");
    expect(run.pollingHistoryId).toBeNull();
    const rows = await db.select().from(transactions);
    expect(rows).toHaveLength(0);
  });
});

describe("runOngoingPoll", () => {
  test("processes newly-added messages found via history, same parse/categorize/dedup path as backfill", async () => {
    const db = drizzle(env.DB);
    await db.insert(captureRuns).values({ runStatus: "success", pollingHistoryId: "100" });
    const client = fakeClient({ first: { messages: [] } }, {});
    client.listHistory = async (startHistoryId, _maxResults) => {
      expect(startHistoryId).toBe("100");
      return { addedMessageIds: ["m-clean"], newHistoryId: "200" };
    };
    client.getMessage = async (id) => (id === "m-clean" ? cleanTransactionEmail : (undefined as never));

    const result = await runOngoingPoll(db, client);

    expect(result.processed).toBe(1);
    const rows = await db.select().from(transactions);
    expect(rows).toHaveLength(1);
    expect(rows[0].source).toBe("gmail_email");
    expect(rows[0].reviewStatus).toBe("committed");
    const [run] = await db.select().from(captureRuns);
    expect(run.pollingHistoryId).toBe("200");
    expect(run.backfillPageToken).toBeNull(); // untouched -- separate mechanism
  });

  test("a message already captured by backfill (same gmail_message_id) is never duplicated", async () => {
    const db = drizzle(env.DB);
    await db.insert(captureRuns).values({ runStatus: "success", pollingHistoryId: "100" });
    await db.insert(transactions).values({
      amount: 125000,
      date: "2026-10-27",
      vendorRaw: "Starbucks",
      vendorNormalized: "starbucks",
      category: "Coffee",
      source: "gmail_email",
      provenance: "{}",
      reviewStatus: "committed",
      gmailMessageId: "m-clean",
    });
    const client = fakeClient({ first: { messages: [] } }, {});
    client.listHistory = async () => ({ addedMessageIds: ["m-clean"], newHistoryId: "200" });
    client.getMessage = async () => cleanTransactionEmail;

    await runOngoingPoll(db, client);

    const rows = await db.select().from(transactions);
    expect(rows).toHaveLength(1); // not duplicated
  });

  test("a quiet poll (no new messages) is healthy, not an error", async () => {
    const db = drizzle(env.DB);
    await db.insert(captureRuns).values({ runStatus: "success", pollingHistoryId: "100" });
    const client = fakeClient({ first: { messages: [] } }, {});
    client.listHistory = async () => ({ addedMessageIds: [], newHistoryId: "100" });

    const result = await runOngoingPoll(db, client);

    expect(result.processed).toBe(0);
    const [run] = await db.select().from(captureRuns);
    expect(run.runStatus).toBe("success");
  });

  test("[C1] a message from history that isn't from NayaPay is skipped entirely -- no row, not even quarantined", async () => {
    const db = drizzle(env.DB);
    await db.insert(captureRuns).values({ runStatus: "success", pollingHistoryId: "100" });
    const client = fakeClient({ first: { messages: [] } }, {});
    client.listHistory = async () => ({ addedMessageIds: ["m-other"], newHistoryId: "200" });
    client.getMessage = async () => ({
      id: "m-other",
      threadId: "t-other",
      internalDate: "1730000000000",
      subject: "Your weekly newsletter",
      from: "Newsletter <news@example.com>",
      bodyText: "Here's what's new this week.",
    });

    const result = await runOngoingPoll(db, client);

    expect(result.processed).toBe(0);
    const rows = await db.select().from(transactions);
    expect(rows).toHaveLength(0);
    const [run] = await db.select().from(captureRuns);
    expect(run.pollingHistoryId).toBe("200"); // still advances -- nothing failed, just out of scope
  });

  test("[C2] pages through history until nextPageToken is exhausted, watermark lands on the last page's historyId", async () => {
    const db = drizzle(env.DB);
    await db.insert(captureRuns).values({ runStatus: "success", pollingHistoryId: "100" });
    const client = fakeClient({ first: { messages: [] } }, { "m-clean": cleanTransactionEmail });
    const pagesSeen: (string | undefined)[] = [];
    client.listHistory = async (_startHistoryId, _maxResults, pageToken) => {
      pagesSeen.push(pageToken);
      if (pageToken === undefined) {
        return { addedMessageIds: [], newHistoryId: "150", nextPageToken: "page2" };
      }
      return { addedMessageIds: ["m-clean"], newHistoryId: "200" };
    };

    const result = await runOngoingPoll(db, client);

    expect(pagesSeen).toEqual([undefined, "page2"]);
    expect(result.processed).toBe(1);
    const [run] = await db.select().from(captureRuns);
    expect(run.pollingHistoryId).toBe("200");
  });

  test("[I1] a history_expired failure reseeds the watermark from getCurrentHistoryId instead of getting stuck", async () => {
    const db = drizzle(env.DB);
    await db.insert(captureRuns).values({ runStatus: "success", pollingHistoryId: "100" });
    const { GmailApiError } = await import("../src/adapters/gmailClient");
    const client = fakeClient({ first: { messages: [] } }, {});
    client.listHistory = async () => {
      throw new GmailApiError(404, "history_expired", "watermark too old");
    };
    client.getCurrentHistoryId = async () => "999";

    const result = await runOngoingPoll(db, client);

    expect(result.processed).toBe(0);
    const [run] = await db.select().from(captureRuns);
    expect(run.pollingHistoryId).toBe("999");
    expect(run.runStatus).toBe("api_call_failed");
    expect(run.errorType).toBe("history_expired");
  });

  test("[I2] self-heals a missing pollingHistoryId (e.g. pre-existing data) by seeding it instead of polling forever as a no-op", async () => {
    const db = drizzle(env.DB);
    await db.insert(captureRuns).values({
      runStatus: "success",
      backfillCompletedAt: new Date().toISOString(),
      pollingHistoryId: null,
    });
    const client = fakeClient({ first: { messages: [] } }, {});
    client.getCurrentHistoryId = async () => "777";
    client.listHistory = async () => {
      throw new Error("must not be called in the same run the watermark is first seeded");
    };

    const result = await runOngoingPoll(db, client);

    expect(result.processed).toBe(0);
    const [run] = await db.select().from(captureRuns);
    expect(run.pollingHistoryId).toBe("777");
    expect(run.runStatus).toBe("success");
    expect(run.lastAttemptedRun).not.toBeNull(); // Watchdog's staleness check needs this kept fresh
  });

  test("[I3] if any message in the batch fails to fetch, the watermark does not advance past it", async () => {
    const db = drizzle(env.DB);
    await db.insert(captureRuns).values({ runStatus: "success", pollingHistoryId: "100" });
    const client = fakeClient(
      { first: { messages: [] } },
      { "m-clean": cleanTransactionEmail },
      { failGetMessageIds: ["m-pkr"] }
    );
    client.listHistory = async () => ({ addedMessageIds: ["m-clean", "m-pkr"], newHistoryId: "200" });

    const result = await runOngoingPoll(db, client);

    expect(result.processed).toBe(1); // m-clean still committed
    const rows = await db.select().from(transactions);
    expect(rows).toHaveLength(1);
    const [run] = await db.select().from(captureRuns);
    expect(run.pollingHistoryId).toBe("100"); // unchanged -- m-pkr must be retried next run
    expect(run.runStatus).toBe("success");
  });
});
