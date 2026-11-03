import { describe, expect, test, vi } from "vitest";
import { createGmailClient, NAYAPAY_QUERY } from "../src/adapters/gmailClient";

function base64url(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

describe("createGmailClient", () => {
  test("listMessages always includes the sender/subject query string, never an unscoped read", async () => {
    const fetchSpy = vi.fn(async (url: string) => {
      expect(new URL(url).searchParams.get("q")).toBe(NAYAPAY_QUERY);
      return new Response(JSON.stringify({ messages: [{ id: "m1" }], nextPageToken: "tok2" }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchSpy);

    const client = createGmailClient("fake-access-token");
    const result = await client.listMessages(NAYAPAY_QUERY, "tok1");

    expect(fetchSpy).toHaveBeenCalledOnce();
    expect(result.messages).toEqual([{ id: "m1" }]);
    expect(result.nextPageToken).toBe("tok2");
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
});
