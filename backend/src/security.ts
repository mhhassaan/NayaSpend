const IV_LENGTH_BYTES = 12;

function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

async function importKey(base64Key: string): Promise<CryptoKey> {
  const keyBytes = base64ToBytes(base64Key);
  return crypto.subtle.importKey("raw", keyBytes, "AES-GCM", false, [
    "encrypt",
    "decrypt",
  ]);
}

/**
 * Encrypts `plaintext` with AES-256-GCM using a fresh random 12-byte IV,
 * and packs IV + ciphertext (which includes the GCM auth tag) into one
 * base64 string.
 */
export async function encryptToken(plaintext: string, base64Key: string): Promise<string> {
  const key = await importKey(base64Key);
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH_BYTES));
  const encoded = new TextEncoder().encode(plaintext);
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, encoded);

  const packed = new Uint8Array(iv.length + ciphertext.byteLength);
  packed.set(iv, 0);
  packed.set(new Uint8Array(ciphertext), iv.length);
  return bytesToBase64(packed);
}

/**
 * Unpacks IV + ciphertext from `packed` and decrypts. Throws if the
 * ciphertext (or its GCM auth tag) was tampered with.
 */
export async function decryptToken(packed: string, base64Key: string): Promise<string> {
  const key = await importKey(base64Key);
  const packedBytes = base64ToBytes(packed);
  const iv = packedBytes.slice(0, IV_LENGTH_BYTES);
  const ciphertext = packedBytes.slice(IV_LENGTH_BYTES);

  const plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ciphertext);
  return new TextDecoder().decode(plaintext);
}
