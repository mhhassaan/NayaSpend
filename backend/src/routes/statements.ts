import { Hono } from "hono";
import { drizzle } from "drizzle-orm/d1";
import { importStatementCsv } from "../adapters/statementAdapter";

type Env = {
  DB: D1Database;
};

export const statementsRoutes = new Hono<{ Bindings: Env }>();

statementsRoutes.post("/", async (c) => {
  const body = await c.req.parseBody();
  const file = body.file;

  if (!(file instanceof File)) {
    return c.text("file is required", 400);
  }

  const text = await file.text();
  const fileRef = `${file.name}-${Date.now()}`;

  const db = drizzle(c.env.DB);
  const result = await importStatementCsv(db, text, fileRef);

  return c.json(result, 201);
});
