// The frontend type-checks against the backend's route types (src/api/client.ts
// imports ../../../backend/src/index), so the backend's packages must be
// installed before `tsc` runs. Hosting builds only install the frontend by
// default, so install the backend's too when they are missing. A no-op locally.
import { existsSync } from "node:fs";
import { execSync } from "node:child_process";

const marker = new URL("../../backend/node_modules/hono/package.json", import.meta.url);
if (!existsSync(marker)) {
  console.log("Installing backend packages for type-checking...");
  execSync("npm --prefix ../backend ci --no-audit --no-fund", { stdio: "inherit" });
}
