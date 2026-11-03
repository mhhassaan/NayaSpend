import type { ConfigEnv } from "../config";

export type Notification = { subject: string; body: string };

const FROM_ADDRESS = "NayaSpend <alerts@resend.dev>";

type NotificationEnv = Pick<ConfigEnv, "RESEND_API_KEY" | "NOTIFICATION_EMAIL">;

/**
 * Shared delivery layer for every alert (Gmail capture health, budget,
 * bill reminders). Contains no trigger-evaluation logic itself -- callers
 * decide when/what to send.
 *
 * Deliberately depends on only its own two secrets, not the full
 * loadConfig -- an alert is most needed exactly when something else is
 * broken, and a missing/invalid Gmail secret must never also silence the
 * Watchdog's ability to say so.
 */
export async function sendNotification(
  env: Partial<NotificationEnv>,
  notification: Notification
): Promise<void> {
  if (!env.RESEND_API_KEY?.trim() || !env.NOTIFICATION_EMAIL?.trim()) {
    throw new Error("Missing required secret: RESEND_API_KEY or NOTIFICATION_EMAIL");
  }

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: FROM_ADDRESS,
      to: [env.NOTIFICATION_EMAIL],
      subject: notification.subject,
      text: notification.body,
    }),
  });

  if (!response.ok) {
    throw new Error(`Resend notification failed with status ${response.status}`);
  }
}
