import { base64ToBytes } from "./security";

const ENCRYPTION_KEY_LENGTH_BYTES = 32; // AES-256 requires exactly 32 key bytes.

export type ConfigEnv = {
  GMAIL_CLIENT_ID: string;
  GMAIL_CLIENT_SECRET: string;
  GMAIL_REDIRECT_URI: string;
  RESEND_API_KEY: string;
  TOKEN_ENCRYPTION_KEY: string;
  NOTIFICATION_EMAIL: string;
};

export type AppConfig = {
  gmailClientId: string;
  gmailClientSecret: string;
  gmailRedirectUri: string;
  resendApiKey: string;
  tokenEncryptionKey: string;
  notificationEmail: string;
};

const REQUIRED_KEYS = [
  "GMAIL_CLIENT_ID",
  "GMAIL_CLIENT_SECRET",
  "GMAIL_REDIRECT_URI",
  "RESEND_API_KEY",
  "TOKEN_ENCRYPTION_KEY",
  "NOTIFICATION_EMAIL",
] as const;

export function loadConfig(env: Partial<ConfigEnv>): AppConfig {
  for (const key of REQUIRED_KEYS) {
    if (!env[key]?.trim()) {
      throw new Error(`Missing required secret: ${key}`);
    }
  }

  const tokenEncryptionKey = env.TOKEN_ENCRYPTION_KEY as string;
  let decodedKeyLength: number;
  try {
    decodedKeyLength = base64ToBytes(tokenEncryptionKey).length;
  } catch {
    throw new Error(
      `Invalid TOKEN_ENCRYPTION_KEY: not valid base64 (expected a base64-encoded ${ENCRYPTION_KEY_LENGTH_BYTES}-byte key)`
    );
  }
  if (decodedKeyLength !== ENCRYPTION_KEY_LENGTH_BYTES) {
    throw new Error(
      `Invalid TOKEN_ENCRYPTION_KEY: must decode to exactly ${ENCRYPTION_KEY_LENGTH_BYTES} bytes for AES-256-GCM, got ${decodedKeyLength}`
    );
  }

  return {
    gmailClientId: env.GMAIL_CLIENT_ID as string,
    gmailClientSecret: env.GMAIL_CLIENT_SECRET as string,
    gmailRedirectUri: env.GMAIL_REDIRECT_URI as string,
    resendApiKey: env.RESEND_API_KEY as string,
    tokenEncryptionKey: env.TOKEN_ENCRYPTION_KEY as string,
    notificationEmail: env.NOTIFICATION_EMAIL as string,
  };
}
