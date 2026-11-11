import { suggestionContext } from "../services/suggestionContext";
import type { SuggestionEnv } from "../services/llmSuggestionService";
import { requireAuth, type AuthUser } from "../middleware/auth";
import { Hono } from "hono";
import { drizzle } from "drizzle-orm/d1";
import { importStatementCsv, parseStatementCsv } from "../adapters/statementAdapter";

type Env = SuggestionEnv & {
  DB: D1Database;
};

const ACCEPTED_CONTENT_TYPES = new Set(["text/csv", "text/plain", "application/vnd.ms-excel"]);

function looksLikeCsv(file: File): boolean {
  if (file.name.toLowerCase().endsWith(".csv")) return true;
  return ACCEPTED_CONTENT_TYPES.has(file.type);
}

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// [Phase 8 Task 5] Chained so `typeof statementsRoutes` carries its
// route's schema -- see the identical fix/explanation in index.ts.
export const statementsRoutes = new Hono<{ Bindings: Env; Variables: { user: AuthUser } }>()
  .use(requireAuth)
  .post("/", async (c) => {
  const body = await c.req.parseBody();
  const file = body.file;

  if (!(file instanceof File)) {
    return c.text("file is required", 400);
  }
  if (!looksLikeCsv(file)) {
    return c.text("file must be a CSV (.csv extension or a CSV content type)", 400);
  }

  const text = await file.text();

  // [Final review C1] fileRef must be stable across re-uploads of the
  // same content -- a timestamp-based fileRef gave every upload a fresh
  // idempotency key, so a retry (or an accidental double-submit) silently
  // double-imported every row. Hashing the content makes the same file
  // produce the same fileRef every time, which is what
  // importStatementCsv's own (fileRef, rowIndex) idempotency key relies on.
  const fileRef = await sha256Hex(text);

  // [Final review I4] zero data rows (an empty file, or a header-only
  // CSV) has nothing to import -- a 201 with imported: 0 reads as a
  // misleading success per the plan's Review Focus item.
  const rows = parseStatementCsv(text, fileRef);
  if (rows.length === 0) {
    return c.text("file has no data rows to import", 422);
  }

  const db = drizzle(c.env.DB);
  const result = await importStatementCsv(db, text, fileRef, c.get("user").id, suggestionContext(c));

  return c.json(result, 201);
});
