import { applyD1Migrations, env } from "cloudflare:test";

// Runs once before the test suite: applies every migration under
// backend/migrations/ to the isolated local D1 instance each test run
// gets, so schema.test.ts (and later tests) see real tables.
await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
