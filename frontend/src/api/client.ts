import { hc } from "hono/client";
import type { AppType } from "../../../backend/src/index";

// The session cookie is `SameSite=None` (frontend/backend are separate
// origins), so every request needs `credentials: "include"` or the
// browser never sends it cross-origin.
function credentialedFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  return fetch(input, { ...init, credentials: "include" });
}

export const apiClient = hc<AppType>("/api", { fetch: credentialedFetch });
