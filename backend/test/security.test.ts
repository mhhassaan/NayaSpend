import { describe, expect, test } from "vitest";
import { decryptToken, encryptToken } from "../src/security";

// 32-byte key, base64-encoded (AES-256 requires exactly 32 key bytes).
const key = btoa("test-key-32-bytes-long-exactly!!");

describe("security token encryption", () => {
  test("encrypt then decrypt round-trips the original plaintext", async () => {
    const ciphertext = await encryptToken("super-secret-oauth-token", key);
    expect(await decryptToken(ciphertext, key)).toBe("super-secret-oauth-token");
  });

  test("two encryptions of the same plaintext produce different ciphertexts (random IV)", async () => {
    const a = await encryptToken("same-value", key);
    const b = await encryptToken("same-value", key);
    expect(a).not.toBe(b);
  });

  test("a tampered ciphertext fails to decrypt", async () => {
    const ciphertext = await encryptToken("super-secret-oauth-token", key);
    const tampered = ciphertext.slice(0, -4) + (ciphertext.slice(-4) === "abcd" ? "dcba" : "abcd");
    await expect(decryptToken(tampered, key)).rejects.toThrow();
  });
});
