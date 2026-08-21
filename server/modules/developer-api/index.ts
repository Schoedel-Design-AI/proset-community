import type { Express } from "express";
import { developerKeysRouter, developerApiRouter } from "./router";
import { mcpRouter } from "./mcp";

/**
 * Mounts the developer-facing surface:
 *   - `/api/developer`  — API-key management (Firebase-session auth)
 *   - `/api/v1`         — public REST API (API-key auth)
 *   - `/mcp`            — hosted Model Context Protocol server (API-key auth)
 */
export function registerDeveloperApi(app: Express): void {
  app.use("/api/developer", developerKeysRouter);
  app.use("/api/v1", developerApiRouter);
  app.use("/mcp", mcpRouter);
}

export { apiKeyAuth, generateApiKey, hashApiKey, API_KEY_PREFIX } from "./api-keys";
export { runCoreConversion } from "./conversion";
export type { CoreConversionInput, CoreConversionResult } from "./conversion";
