import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Optional SQL integration harness, independent of the workerd test pool.
export default defineConfig({
  resolve: { alias: { "cloudflare:test": fileURLToPath(new URL("./sqliteHarness.ts", import.meta.url)) } },
  test: {
    environment: "node",
    include: ["test/nayapayCapture.test.ts", "test/gmailAdapter.test.ts", "test/gmailClient.test.ts", "test/dedupEngine.test.ts", "test/categorizationEngine.test.ts"],
  },
});
