export type ConfigEnv = {
  GMAIL_CLIENT_ID: string;
  GMAIL_CLIENT_SECRET: string;
  RESEND_API_KEY: string;
  TOKEN_ENCRYPTION_KEY: string;
};

export type AppConfig = {
  gmailClientId: string;
  gmailClientSecret: string;
  resendApiKey: string;
  tokenEncryptionKey: string;
};

const REQUIRED_KEYS = [
  "GMAIL_CLIENT_ID",
  "GMAIL_CLIENT_SECRET",
  "RESEND_API_KEY",
  "TOKEN_ENCRYPTION_KEY",
] as const;

export function loadConfig(env: Partial<ConfigEnv>): AppConfig {
  for (const key of REQUIRED_KEYS) {
    if (!env[key]) {
      throw new Error(`Missing required secret: ${key}`);
    }
  }

  return {
    gmailClientId: env.GMAIL_CLIENT_ID as string,
    gmailClientSecret: env.GMAIL_CLIENT_SECRET as string,
    resendApiKey: env.RESEND_API_KEY as string,
    tokenEncryptionKey: env.TOKEN_ENCRYPTION_KEY as string,
  };
}
