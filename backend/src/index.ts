import { Hono } from "hono";

type Env = {
  DB: D1Database;
};

const app = new Hono<{ Bindings: Env }>();

export default {
  fetch: app.fetch,
  async scheduled(event: ScheduledEvent) {
    // Placeholder dispatcher. Real routing to captureScheduler, watchdog,
    // and the budget/bill evaluation loop lands in a later build phase
    // (design doc, Detailed Implementation Plan item 26).
    console.log(`scheduled event fired for cron: ${event.cron}`);
  },
};
