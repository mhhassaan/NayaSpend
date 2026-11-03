import { env } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { describe, expect, test, vi } from "vitest";
import { captureRuns } from "../src/db/schema";
import { runCaptureScheduler } from "../src/services/captureScheduler";
import { GmailApiError } from "../src/adapters/gmailClient";
import type { GmailClient } from "../src/adapters/gmailClient";
import { cleanTransactionEmail } from "./fixtures/nayapayEmails";

function fakeQueue() {
  const sent: { message: unknown; delaySeconds: number }[] = [];
  return {
    sent,
    async send(message: unknown, options: { delaySeconds: number }) {
      sent.push({ message, delaySeconds: options.delaySeconds });
    },
  };
}

function failingClient(): GmailClient {
  return {
    listMessages: async () => {
      throw new GmailApiError(500, "unknown", "boom");
    },
    getMessage: async () => {
      throw new Error("unused");
    },
    listHistory: async () => {
      throw new Error("unused");
    },
    getCurrentHistoryId: async () => "unused",
  };
}

describe("runCaptureScheduler", () => {
  test("chooses runBackfill while backfill is not yet complete, and succeeds with no messages", async () => {
    const db = drizzle(env.DB);
    const client: GmailClient = {
      listMessages: async () => ({ messages: [] }),
      getMessage: async () => {
        throw new Error("unused");
      },
      listHistory: async () => {
        throw new Error("unused");
      },
      getCurrentHistoryId: async () => "unused",
    };
    const queue = fakeQueue();

    await runCaptureScheduler(db, client, queue);

    const [run] = await db.select().from(captureRuns);
    expect(run.runStatus).toBe("success");
    expect(queue.sent).toHaveLength(0);
  });

  test("chooses runOngoingPoll once backfill is complete", async () => {
    const db = drizzle(env.DB);
    const completedAt = new Date().toISOString();
    await db.insert(captureRuns).values({
      runStatus: "success",
      backfillCompletedAt: completedAt,
      pollingHistoryId: "100",
    });
    let listHistoryCalled = false;
    const client: GmailClient = {
      listMessages: async () => {
        throw new Error("must not call listMessages once backfill is complete");
      },
      getMessage: async () => {
        throw new Error("unused");
      },
      listHistory: async () => {
        listHistoryCalled = true;
        return { addedMessageIds: [], newHistoryId: "200" };
      },
      getCurrentHistoryId: async () => "unused",
    };
    const queue = fakeQueue();

    await runCaptureScheduler(db, client, queue);

    expect(listHistoryCalled).toBe(true);
  });

  test("on an API-call failure, enqueues a retry at 1 minute for attempt 1", async () => {
    const db = drizzle(env.DB);
    const queue = fakeQueue();

    await runCaptureScheduler(db, failingClient(), queue);

    expect(queue.sent).toHaveLength(1);
    expect(queue.sent[0].delaySeconds).toBe(60);
    expect(queue.sent[0].message).toEqual({ attempt: 2 });
  });

  test("retries at 5 minutes for attempt 2", async () => {
    const db = drizzle(env.DB);
    const queue = fakeQueue();

    await runCaptureScheduler(db, failingClient(), queue, 2);

    expect(queue.sent).toHaveLength(1);
    expect(queue.sent[0].delaySeconds).toBe(300);
    expect(queue.sent[0].message).toEqual({ attempt: 3 });
  });

  test("retries at 15 minutes for the 3rd retry (attempt 4 = original + 3 retries), and does not enqueue a 5th attempt", async () => {
    const db = drizzle(env.DB);
    const queue3 = fakeQueue();
    await runCaptureScheduler(db, failingClient(), queue3, 3);
    expect(queue3.sent).toHaveLength(1);
    expect(queue3.sent[0].delaySeconds).toBe(900);

    const queue4 = fakeQueue();
    await runCaptureScheduler(db, failingClient(), queue4, 4);
    expect(queue4.sent).toHaveLength(0); // Watchdog takes over from here

    const [run] = await db.select().from(captureRuns);
    expect(run.runStatus).toBe("api_call_failed");
  });

  test("[C5] a bug that escapes runBackfill entirely (outside its own try/catch blocks) is still recorded as a failure", async () => {
    const db = drizzle(env.DB);
    const categorizationEngine = await import("../src/services/categorizationEngine");
    const spy = vi.spyOn(categorizationEngine, "categorize").mockRejectedValueOnce(new Error("unexpected bug"));
    const client: GmailClient = {
      listMessages: async () => ({ messages: [{ id: "m-clean" }] }),
      getMessage: async () => cleanTransactionEmail,
      listHistory: async () => {
        throw new Error("unused");
      },
      getCurrentHistoryId: async () => "unused",
    };
    const queue = fakeQueue();

    await runCaptureScheduler(db, client, queue);

    const [run] = await db.select().from(captureRuns);
    expect(run.runStatus).toBe("api_call_failed");
    expect(run.errorType).toBe("unknown");
    expect(run.lastAttemptedRun).not.toBeNull();
    expect(queue.sent).toHaveLength(1); // an unknown error still gets retried

    spy.mockRestore();
  });

  test("[I6] an auth_failure is never retried via the queue -- straight to the Watchdog instead", async () => {
    const db = drizzle(env.DB);
    const client: GmailClient = {
      listMessages: async () => {
        throw new GmailApiError(401, "auth_failure", "token expired");
      },
      getMessage: async () => {
        throw new Error("unused");
      },
      listHistory: async () => {
        throw new Error("unused");
      },
      getCurrentHistoryId: async () => "unused",
    };
    const queue = fakeQueue();

    await runCaptureScheduler(db, client, queue);

    expect(queue.sent).toHaveLength(0);
    const [run] = await db.select().from(captureRuns);
    expect(run.runStatus).toBe("api_call_failed");
    expect(run.errorType).toBe("auth_failure");
  });
});
