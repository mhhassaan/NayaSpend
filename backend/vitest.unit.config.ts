import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/llmSuggestionService.test.ts"],
    environment: "node",
  },
});
