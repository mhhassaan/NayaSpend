import { describe, expect, test } from "vitest";
import { loadConfig } from "../src/config";

// A real 32-byte base64 key, matching AES-256's required key length.
const VALID_KEY = btoa("test-key-32-bytes-long-exactly!!");

describe("loadConfig", () => {
  test("reads all four required secrets", () => {
    const env = {
      GMAIL_CLIENT_ID: "a",
      GMAIL_CLIENT_SECRET: "b",
      RESEND_API_KEY: "c",
      TOKEN_ENCRYPTION_KEY: VALID_KEY,
    };
    const config = loadConfig(env);
    expect(config).toEqual({
      gmailClientId: "a",
      gmailClientSecret: "b",
      resendApiKey: "c",
      tokenEncryptionKey: VALID_KEY,
    });
  });

  test("throws a clear error naming the specific missing secret", () => {
    const env = { GMAIL_CLIENT_ID: "a" };
    expect(() => loadConfig(env)).toThrow(/GMAIL_CLIENT_SECRET/);
  });

  test("throws naming TOKEN_ENCRYPTION_KEY when it is a whitespace-only string", () => {
    const env = {
      GMAIL_CLIENT_ID: "a",
      GMAIL_CLIENT_SECRET: "b",
      RESEND_API_KEY: "c",
      TOKEN_ENCRYPTION_KEY: "   ",
    };
    expect(() => loadConfig(env)).toThrow(/TOKEN_ENCRYPTION_KEY/);
  });

  test("throws naming TOKEN_ENCRYPTION_KEY when it does not decode to exactly 32 bytes", () => {
    const env = {
      GMAIL_CLIENT_ID: "a",
      GMAIL_CLIENT_SECRET: "b",
      RESEND_API_KEY: "c",
      TOKEN_ENCRYPTION_KEY: "ZGQ=", // decodes to 2 bytes, not 32
    };
    expect(() => loadConfig(env)).toThrow(/TOKEN_ENCRYPTION_KEY/);
  });

  test("throws naming TOKEN_ENCRYPTION_KEY when it is not valid base64", () => {
    const env = {
      GMAIL_CLIENT_ID: "a",
      GMAIL_CLIENT_SECRET: "b",
      RESEND_API_KEY: "c",
      TOKEN_ENCRYPTION_KEY: "your-base64-encoded-32-byte-key", // placeholder-shaped, not valid base64
    };
    expect(() => loadConfig(env)).toThrow(/TOKEN_ENCRYPTION_KEY/);
  });
});
