import type { ReactElement } from "react";
import { render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { vi } from "vitest";

// [Phase 8 Task 9, Ruling] Hono's `hc()` client is Proxy-based -- every
// property access (`apiClient.trends`, `.$get`, etc.) returns a fresh
// Proxy with no `set`/`defineProperty` trap, so `vi.spyOn(apiClient.x,
// "$get")` silently fails to intercept calls (it writes to the Proxy's
// inner no-op function, which the `get` trap never consults). The real
// interception point -- confirmed by reading hono's client.js -- is the
// plain global `fetch` every `$get`/`$post`/etc. call ultimately invokes.
// Every page test mocks fetch directly instead.

export function renderWithProviders(ui: ReactElement, options?: { initialEntries?: string[] }) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={options?.initialEntries ?? ["/"]}>{ui}</MemoryRouter>
    </QueryClientProvider>
  );
}

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

type FetchHandler = {
  test: (url: string, method: string) => boolean;
  respond: () => Response | Promise<Response>;
};

/** Mocks global fetch, dispatching to the first handler whose `test` matches. */
export function mockFetch(handlers: FetchHandler[]) {
  const spy = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const method = (init?.method ?? "GET").toUpperCase();
    const handler = handlers.find((h) => h.test(url, method));
    if (!handler) {
      throw new Error(`mockFetch: no handler matched ${method} ${url}`);
    }
    return handler.respond();
  });
  vi.stubGlobal("fetch", spy);
  return spy;
}

/** Matches a request whose URL contains `fragment` and whose method matches (default GET). */
export function urlContains(fragment: string, method = "GET") {
  return (url: string, reqMethod: string) => url.includes(fragment) && reqMethod === method;
}
