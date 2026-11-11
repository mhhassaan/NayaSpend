import { hc } from "hono/client";
import type { AppType } from "../../../backend/src/index";
import { API_BASE } from "./base";

// The session cookie is `SameSite=None` (frontend/backend are separate
// origins), so every request needs `credentials: "include"` or the
// browser never sends it cross-origin.
function credentialedFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  return fetch(input, { ...init, credentials: "include" });
}

export const apiClient = hc<AppType>(API_BASE, { fetch: credentialedFetch });
