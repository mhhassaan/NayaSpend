import type { SuggestionEnv, SuggestionOptions } from "./llmSuggestionService";

export function suggestionContext(c: { env: SuggestionEnv; executionCtx: { waitUntil(task: Promise<unknown>): void } }): SuggestionOptions {
  try {
    const ctx = c.executionCtx;
    return { env: c.env, waitUntil: task => ctx.waitUntil(task) };
  } catch {
    return { env: c.env };
  }
}
