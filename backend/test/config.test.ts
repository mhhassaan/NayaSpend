import { describe, expect, test } from "vitest";
import { loadConfig } from "../src/config";

describe("loadConfig", () => {
  test("reads all four required secrets", () => {
    const env = {
      GMAIL_CLIENT_ID: "a",
      GMAIL_CLIENT_SECRET: "b",
      RESEND_API_KEY: "c",
      TOKEN_ENCRYPTION_KEY: "ZGQ=",
    };
    const config = loadConfig(env as any);
    expect(config).toEqual({
      gmailClientId: "a",
      gmailClientSecret: "b",
      resendApiKey: "c",
      tokenEncryptionKey: "ZGQ=",
    });
  });

  test("throws a clear error naming the specific missing secret", () => {
    const env = { GMAIL_CLIENT_ID: "a" };
    expect(() => loadConfig(env as any)).toThrow(/GMAIL_CLIENT_SECRET/);
  });
});
