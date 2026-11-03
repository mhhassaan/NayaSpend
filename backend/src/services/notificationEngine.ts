import { loadConfig, type ConfigEnv } from "../config";

export type Notification = { subject: string; body: string };

const FROM_ADDRESS = "NayaSpend <alerts@resend.dev>";

/**
 * Shared delivery layer for every alert (Gmail capture health, budget,
 * bill reminders). Contains no trigger-evaluation logic itself -- callers
 * decide when/what to send.
 */
export async function sendNotification(
  env: Partial<ConfigEnv>,
  notification: Notification
): Promise<void> {
  const config = loadConfig(env);

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.resendApiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: FROM_ADDRESS,
      to: [config.notificationEmail],
      subject: notification.subject,
      text: notification.body,
    }),
  });

  if (!response.ok) {
    throw new Error(`Resend notification failed with status ${response.status}`);
  }
}
