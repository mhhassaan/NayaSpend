import { Hono } from "hono";
import { drizzle } from "drizzle-orm/d1";
import { captureRuns } from "../db/schema";
import { getGmailClient } from "../services/gmailCredentialStore";
import { runBackfill } from "../adapters/gmailAdapter";
import type { ConfigEnv } from "../config";

type Env = ConfigEnv & {
  DB: D1Database;
};

export const captureRoutes = new Hono<{ Bindings: Env }>();

captureRoutes.get("/health", async (c) => {
  const db = drizzle(c.env.DB);
  const [run] = await db.select().from(captureRuns);

  if (!run) {
    // A brand-new, never-run installation is a normal state the frontend's
    // Capture Health page must render, not an error -- so this is 200, not 404.
    return c.json({
      runStatus: "job_did_not_run",
      lastAttemptedRun: null,
      lastSuccessfulRun: null,
      errorType: null,
    });
  }

  return c.json(run);
});

captureRoutes.post("/backfill", async (c) => {
  const db = drizzle(c.env.DB);
  const client = await getGmailClient(db, c.env);

  if (!client) {
    return c.text("No Gmail account connected", 409);
  }

  const result = await runBackfill(db, client);
  return c.json(result);
});
