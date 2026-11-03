import { describe, expect, test, vi } from "vitest";
import { sendNotification } from "../src/services/notificationEngine";

const testEnv = {
  GMAIL_CLIENT_ID: "a",
  GMAIL_CLIENT_SECRET: "b",
  GMAIL_REDIRECT_URI: "https://example.com/cb",
  RESEND_API_KEY: "test-resend-key",
  TOKEN_ENCRYPTION_KEY: btoa("test-key-32-bytes-long-exactly!!"),
  NOTIFICATION_EMAIL: "user@example.com",
};

describe("sendNotification", () => {
  test("POSTs to Resend's API with the Bearer token, recipient, and the given subject/body", async () => {
    const fetchSpy = vi.fn(async (url: string, init: RequestInit) => {
      expect(url).toBe("https://api.resend.com/emails");
      expect((init.headers as Record<string, string>).Authorization).toBe("Bearer test-resend-key");
      const body = JSON.parse(init.body as string);
      expect(body.to).toEqual(["user@example.com"]);
      expect(body.subject).toBe("Gmail access expired");
      expect(body.text).toBe("Reconnect your account.");
      return new Response(JSON.stringify({ id: "msg-1" }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchSpy);

    await sendNotification(testEnv, { subject: "Gmail access expired", body: "Reconnect your account." });

    expect(fetchSpy).toHaveBeenCalledOnce();
  });

  test("a failed Resend call throws rather than silently swallowing the notification", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 500 })));
    await expect(sendNotification(testEnv, { subject: "x", body: "y" })).rejects.toThrow();
  });
});
