import { eq } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import { captureRuns, transactions } from "../db/schema";
import { categorize, normalize } from "../services/categorizationEngine";
import type { GmailClient } from "./gmailClient";
import { NAYAPAY_QUERY } from "./gmailClient";
import { parseNayaPayEmail } from "./parseNayaPayEmail";

const DEFAULT_MAX_MESSAGES_PER_CHUNK = 50;

async function getOrCreateCaptureRun(db: DrizzleD1Database) {
  const [existing] = await db.select().from(captureRuns);
  if (existing) return existing;

  await db.insert(captureRuns).values({ runStatus: "job_did_not_run" });
  const [created] = await db.select().from(captureRuns);
  return created;
}

export async function runBackfill(
  db: DrizzleD1Database,
  client: GmailClient,
  options?: { maxMessagesPerChunk?: number }
): Promise<{ processed: number; nextPageToken: string | null }> {
  const maxMessagesPerChunk = options?.maxMessagesPerChunk ?? DEFAULT_MAX_MESSAGES_PER_CHUNK;

  const run = await getOrCreateCaptureRun(db);
  const currentToken = run.backfillPageToken ?? undefined;

  const { messages, nextPageToken } = await client.listMessages(NAYAPAY_QUERY, currentToken);
  const chunk = messages.slice(0, maxMessagesPerChunk);

  let processed = 0;
  for (const { id } of chunk) {
    const message = await client.getMessage(id);
    const parsed = parseNayaPayEmail(message);

    if (parsed.confidence === "high") {
      const category = await categorize(db, parsed.vendorRaw);
      await db.insert(transactions).values({
        amount: parsed.amountCents,
        date: parsed.date,
        vendorRaw: parsed.vendorRaw,
        vendorNormalized: normalize(parsed.vendorRaw),
        category,
        source: "gmail_email",
        reviewStatus: "committed",
        provenance: JSON.stringify({
          gmailMessageId: message.id,
          threadId: message.threadId,
          parserVersion: 1,
        }),
      });
    } else {
      await db.insert(transactions).values({
        amount: 0,
        date: new Date(Number(message.internalDate)).toISOString().slice(0, 10),
        vendorRaw: message.from,
        vendorNormalized: normalize(message.from),
        category: "Uncategorized",
        source: "gmail_email",
        reviewStatus: "pending_review",
        provenance: JSON.stringify({
          gmailMessageId: message.id,
          threadId: message.threadId,
          parserVersion: 1,
          quarantineReason: parsed.reason,
        }),
      });
    }
    processed++;
  }

  const resolvedNextPageToken = nextPageToken ?? null;
  await db
    .update(captureRuns)
    .set({ backfillPageToken: resolvedNextPageToken })
    .where(eq(captureRuns.id, run.id));

  return { processed, nextPageToken: resolvedNextPageToken };
}
