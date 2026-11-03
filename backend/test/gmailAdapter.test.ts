import { env } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { describe, expect, test } from "vitest";
import { captureRuns, transactions } from "../src/db/schema";
import { runBackfill } from "../src/adapters/gmailAdapter";
import { parseNayaPayEmail } from "../src/adapters/parseNayaPayEmail";
import {
  cleanTransactionEmail,
  malformedLayoutEmail,
  pkrFormatEmail,
  promoEmailNoAmount,
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
});

function fakeClient(
  messagesByPage: Record<string, { id: string }[]>,
  bodies: Record<string, GmailMessage>,
  nextTokens: Record<string, string | undefined>
): GmailClient {
  return {
    async listMessages(_query, pageToken = "first") {
      return { messages: messagesByPage[pageToken] ?? [], nextPageToken: nextTokens[pageToken] };
    },
    async getMessage(id) {
      return bodies[id];
    },
  };
}

describe("runBackfill", () => {
  test("parses a chunk of matching messages, writes high-confidence ones as committed", async () => {
    const db = drizzle(env.DB);
    const client = fakeClient(
      { first: [{ id: "m-clean" }] },
      { "m-clean": cleanTransactionEmail },
      { first: undefined }
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

  test("a low-confidence parse is written as pending_review, not dropped", async () => {
    const db = drizzle(env.DB);
    const client = fakeClient(
      { first: [{ id: "m-promo" }] },
      { "m-promo": promoEmailNoAmount },
      { first: undefined }
    );

    await runBackfill(db, client);

    const rows = await db.select().from(transactions);
    expect(rows).toHaveLength(1);
    expect(rows[0].reviewStatus).toBe("pending_review");
    expect(JSON.parse(rows[0].provenance).quarantineReason).toBeDefined();
  });

  test("persists nextPageToken to capture_runs so an interruption can resume", async () => {
    const db = drizzle(env.DB);
    const client = fakeClient(
      { first: [{ id: "m-clean" }] },
      { "m-clean": cleanTransactionEmail },
      { first: "page2token" }
    );

    const result = await runBackfill(db, client);

    expect(result.nextPageToken).toBe("page2token");
    const [run] = await db.select().from(captureRuns);
    expect(run.backfillPageToken).toBe("page2token");
  });

  test("resuming from a saved pageToken does not reprocess the first page", async () => {
    const db = drizzle(env.DB);
    await db.insert(captureRuns).values({ runStatus: "job_did_not_run", backfillPageToken: "page2token" });
    const client = fakeClient(
      { page2token: [{ id: "m-pkr" }] },
      { "m-pkr": pkrFormatEmail },
      { page2token: undefined }
    );

    const result = await runBackfill(db, client);

    expect(result.processed).toBe(1);
    const rows = await db.select().from(transactions);
    expect(rows).toHaveLength(1); // only m-pkr, never a page-1 message
  });
});
