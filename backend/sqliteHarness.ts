// SQL-only D1 shim for Node versions with node:sqlite. Does not emulate Workers.
import { createRequire } from "node:module";
import { readFileSync, readdirSync } from "node:fs";
import type { SQLInputValue } from "node:sqlite";
import { beforeEach, afterAll } from "vitest";

// Vite 5 predates this builtin; resolve it through Node instead of Vite.
const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite") as typeof import("node:sqlite");
let sqlite: InstanceType<typeof DatabaseSync>;
const migrations = new URL("./migrations/", import.meta.url);
beforeEach(() => {
  sqlite?.close();
  // Match D1's SQLite string-literal compatibility used by existing migrations.
  sqlite = new DatabaseSync(":memory:", { enableDoubleQuotedStringLiterals: true });
  for (const file of readdirSync(migrations).filter(f => f.endsWith(".sql")).sort()) {
    sqlite.exec(readFileSync(new URL(file, migrations), "utf8"));
  }
});
afterAll(() => sqlite?.close());

class PreparedStatement {
  constructor(private sql: string, private params: SQLInputValue[] = []) {}
  bind(...values: SQLInputValue[]) { return new PreparedStatement(this.sql, values); }
  async all() {
    return { success: true, results: sqlite.prepare(this.sql).all(...this.params), meta: {} };
  }
  async raw() {
    const statement = sqlite.prepare(this.sql);
    statement.setReturnArrays(true);
    return statement.all(...this.params);
  }
  async run() {
    const result = sqlite.prepare(this.sql).run(...this.params);
    return { success: true, results: [], meta: { changes: result.changes, last_row_id: result.lastInsertRowid } };
  }
}
export const env = { DB: {
  prepare(sql: string) { return new PreparedStatement(sql); },
  async batch(statements: PreparedStatement[]) {
    sqlite.exec("BEGIN");
    try {
      const results = [];
      for (const statement of statements) results.push(await statement.all());
      sqlite.exec("COMMIT");
      return results;
    } catch (error) {
      sqlite.exec("ROLLBACK");
      throw error;
    }
  },
} };
