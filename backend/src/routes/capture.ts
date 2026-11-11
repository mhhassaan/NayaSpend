import { suggestionContext } from "../services/suggestionContext";
import { eq } from "drizzle-orm";
import { requireAuth, type AuthUser } from "../middleware/auth";
import { Hono } from "hono";
import { drizzle } from "drizzle-orm/d1";
import { captureRuns } from "../db/schema";
import { getGmailClient } from "../services/gmailCredentialStore";
import { runBackfill } from "../adapters/gmailAdapter";
import type { ConfigEnv } from "../config";

type Env = ConfigEnv & {
  DB: D1Database;
};

// [Phase 8 Task 5] Chained so `typeof captureRoutes` carries every route's
// schema -- see the identical fix/explanation in index.ts.
export const captureRoutes = new Hono<{ Bindings: Env; Variables: { user: AuthUser } }>()
  .use(requireAuth)
  .get("/health", async (c) => {
    const db = drizzle(c.env.DB);
    const [run] = await db.select().from(captureRuns).where(eq(captureRuns.userId, c.get("user").id));

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
  })
  .post("/backfill", async (c) => {
    const db = drizzle(c.env.DB);
    const client = await getGmailClient(db, c.env, c.get("user").id);

    if (!client) {
      return c.text("No Gmail account connected", 409);
    }

    const result = await runBackfill(db, client, c.get("user").id, suggestionContext(c));
    return c.json(result);
  });
