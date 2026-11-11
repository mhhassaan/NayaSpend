// Dev: Vite proxies /api to the local Worker. Production: set VITE_API_BASE_URL
// (e.g. https://api.nayaspend.app) at build time.
export const API_BASE: string = (import.meta.env.VITE_API_BASE_URL ?? "/api").replace(/\/+$/, "");
