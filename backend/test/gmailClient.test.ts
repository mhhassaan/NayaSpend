import { describe, expect, test, vi } from "vitest";
import { createGmailClient, GmailApiError, NAYAPAY_QUERY } from "../src/adapters/gmailClient";

function base64url(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

describe("createGmailClient", () => {
  test("listMessages always uses the sender/subject query string internally -- there is no way to pass a different one", async () => {
    const fetchSpy = vi.fn(async (url: string) => {
      expect(new URL(url).searchParams.get("q")).toBe(NAYAPAY_QUERY);
      return new Response(JSON.stringify({ messages: [{ id: "m1" }], nextPageToken: "tok2" }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchSpy);

    const client = createGmailClient("fake-access-token");
    const result = await client.listMessages("tok1", 50);

    expect(fetchSpy).toHaveBeenCalledOnce();
    expect(result.messages).toEqual([{ id: "m1" }]);
    expect(result.nextPageToken).toBe("tok2");
  });

  test("listMessages passes maxResults through so a full page is never silently truncated", async () => {
    const fetchSpy = vi.fn(async (url: string) => {
      expect(new URL(url).searchParams.get("maxResults")).toBe("50");
      return new Response(JSON.stringify({ messages: [] }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchSpy);

    const client = createGmailClient("fake-access-token");
    await client.listMessages(undefined, 50);

    expect(fetchSpy).toHaveBeenCalledOnce();
  });

  test("listMessages throws a typed GmailApiError with errorType 'auth_failure' on a 401", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ error: "invalid_token" }), { status: 401 }))
    );
    const client = createGmailClient("expired-token");

    await expect(client.listMessages(undefined, 50)).rejects.toMatchObject({
      errorType: "auth_failure",
    });
  });

  test("listMessages throws a typed GmailApiError with errorType 'rate_limit' on a 429", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ error: "rate limited" }), { status: 429 }))
    );
    const client = createGmailClient("fake-access-token");

    await expect(client.listMessages(undefined, 50)).rejects.toMatchObject({
      errorType: "rate_limit",
    });
  });

  test("getMessage throws a typed GmailApiError (not a generic TypeError) on a non-ok response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ error: "not found" }), { status: 404 }))
    );
    const client = createGmailClient("fake-access-token");

    await expect(client.getMessage("missing-id")).rejects.toBeInstanceOf(GmailApiError);
  });

  test("getMessage parses subject, sender, and plain-text body from the Gmail API response shape", async () => {
    const fetchSpy = vi.fn(async () =>
      new Response(
        JSON.stringify({
          id: "m1",
          threadId: "t1",
          internalDate: "1730000000000",
          payload: {
            headers: [
              { name: "Subject", value: "You spent PKR 500" },
              { name: "From", value: "NayaPay <noreply@nayapay.com>" },
            ],
            body: { data: base64url("Transaction body text") },
          },
        }),
        { status: 200 }
      )
    );
    vi.stubGlobal("fetch", fetchSpy);

    const client = createGmailClient("fake-access-token");
    const message = await client.getMessage("m1");

    expect(message.subject).toBe("You spent PKR 500");
    expect(message.from).toBe("NayaPay <noreply@nayapay.com>");
    expect(message.bodyText).toBe("Transaction body text");
  });

  test("getMessage decodes a multipart message's first text/plain part", async () => {
    const fetchSpy = vi.fn(async () =>
      new Response(
        JSON.stringify({
          id: "m2",
          threadId: "t2",
          internalDate: "1730000000000",
          payload: {
            headers: [
              { name: "Subject", value: "You spent Rs. 100" },
              { name: "From", value: "NayaPay <noreply@nayapay.com>" },
            ],
            parts: [
              { mimeType: "text/html", body: { data: base64url("<p>html</p>") } },
              { mimeType: "text/plain", body: { data: base64url("Plain part body") } },
            ],
          },
        }),
        { status: 200 }
      )
    );
    vi.stubGlobal("fetch", fetchSpy);

    const client = createGmailClient("fake-access-token");
    const message = await client.getMessage("m2");

    expect(message.bodyText).toBe("Plain part body");
  });

  test("listHistory calls users.history.list with startHistoryId and returns added message ids + new watermark", async () => {
    const fetchSpy = vi.fn(async (url: string) => {
      expect(url).toContain("startHistoryId=100");
      expect(url).toContain("/users/me/history");
      return new Response(
        JSON.stringify({
          history: [
            { messagesAdded: [{ message: { id: "m1" } }] },
            { messagesAdded: [{ message: { id: "m2" } }, { message: { id: "m3" } }] },
          ],
          historyId: "150",
        }),
        { status: 200 }
      );
    });
    vi.stubGlobal("fetch", fetchSpy);

    const client = createGmailClient("fake-access-token");
    const result = await client.listHistory("100", 50);

    expect(result.addedMessageIds).toEqual(["m1", "m2", "m3"]);
    expect(result.newHistoryId).toBe("150");
  });

  test("listHistory falls back to the start watermark when Gmail reports no new history", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({}), { status: 200 })));
    const client = createGmailClient("fake-access-token");

    const result = await client.listHistory("100", 50);

    expect(result.addedMessageIds).toEqual([]);
    expect(result.newHistoryId).toBe("100");
  });

  test("listHistory throws a typed GmailApiError on failure, same as listMessages/getMessage", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 401 })));
    const client = createGmailClient("expired-token");

    await expect(client.listHistory("100", 50)).rejects.toMatchObject({ errorType: "auth_failure" });
  });

  test("[C1] listHistory scopes to the INBOX label", async () => {
    const fetchSpy = vi.fn(async (url: string) => {
      expect(new URL(url).searchParams.get("labelId")).toBe("INBOX");
      return new Response(JSON.stringify({ historyId: "100" }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchSpy);
    const client = createGmailClient("fake-access-token");

    await client.listHistory("100", 50);

    expect(fetchSpy).toHaveBeenCalledOnce();
  });

  test("[C2] listHistory passes a pageToken through and returns the response's nextPageToken", async () => {
    const fetchSpy = vi.fn(async (url: string) => {
      expect(new URL(url).searchParams.get("pageToken")).toBe("page2");
      return new Response(JSON.stringify({ historyId: "150", nextPageToken: "page3" }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchSpy);
    const client = createGmailClient("fake-access-token");

    const result = await client.listHistory("100", 50, "page2");

    expect(result.nextPageToken).toBe("page3");
  });

  test("[C2] listHistory omits pageToken from the request when none is given", async () => {
    const fetchSpy = vi.fn(async (url: string) => {
      expect(new URL(url).searchParams.has("pageToken")).toBe(false);
      return new Response(JSON.stringify({ historyId: "100" }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchSpy);
    const client = createGmailClient("fake-access-token");

    await client.listHistory("100", 50);
  });

  test("[I1] listHistory throws errorType 'history_expired' on a 404 (startHistoryId too old), distinct from other failures", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 404 })));
    const client = createGmailClient("fake-access-token");

    await expect(client.listHistory("100", 50)).rejects.toMatchObject({ errorType: "history_expired" });
  });

  test("getCurrentHistoryId calls users.getProfile and returns its historyId", async () => {
    const fetchSpy = vi.fn(async (url: string) => {
      expect(url).toContain("profile");
      return new Response(JSON.stringify({ historyId: "999" }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchSpy);
    const client = createGmailClient("fake-access-token");

    expect(await client.getCurrentHistoryId()).toBe("999");
  });

  test("getCurrentHistoryId throws a typed GmailApiError on failure", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 500 })));
    const client = createGmailClient("fake-access-token");

    await expect(client.getCurrentHistoryId()).rejects.toBeInstanceOf(GmailApiError);
  });
});
