import { describe, expect, test, vi } from "vitest";
import { refreshAccessToken } from "../src/services/gmailTokenRefresh";
import { GmailApiError } from "../src/adapters/gmailClient";

const config = { gmailClientId: "client-id", gmailClientSecret: "client-secret" };

describe("refreshAccessToken", () => {
  test("POSTs grant_type=refresh_token to Google's token endpoint and returns the new access token + expiry", async () => {
    const fetchSpy = vi.fn(async (url: string, init: RequestInit) => {
      expect(url).toBe("https://oauth2.googleapis.com/token");
      const body = new URLSearchParams(init.body as string);
      expect(body.get("grant_type")).toBe("refresh_token");
      expect(body.get("refresh_token")).toBe("stored-refresh-token");
      expect(body.get("client_id")).toBe("client-id");
      expect(body.get("client_secret")).toBe("client-secret");
      return new Response(JSON.stringify({ access_token: "new-access-token", expires_in: 3600 }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchSpy);

    const result = await refreshAccessToken(config, "stored-refresh-token");

    expect(result.accessToken).toBe("new-access-token");
    expect(new Date(result.expiresAt).getTime()).toBeGreaterThan(Date.now());
    expect(fetchSpy).toHaveBeenCalledOnce();
  });

  test("a revoked/expired refresh_token (400) throws a GmailApiError classified as auth_failure", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: "invalid_grant" }), { status: 400 })));

    await expect(refreshAccessToken(config, "revoked-token")).rejects.toMatchObject({
      errorType: "auth_failure",
    });
  });

  test("throws a typed GmailApiError (not a generic TypeError) on a 500", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 500 })));

    await expect(refreshAccessToken(config, "x")).rejects.toBeInstanceOf(GmailApiError);
  });

  test("a malformed response (missing access_token) throws rather than returning an unusable token", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ expires_in: 3600 }), { status: 200 })));

    await expect(refreshAccessToken(config, "x")).rejects.toBeInstanceOf(GmailApiError);
  });
});
