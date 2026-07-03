/*
 * Copyright (C) 2025 TomTom NV
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 *
 * Registers MCP App HTML resources (interactive UIs) served from the
 * dist-apps directory, with the CSP metadata required by the ext-apps host.
 *
 * Deviations from the reference implementation
 * (tomtom-mcp/src/tools/helpers/resourceRegistry.ts):
 *  - Registration is synchronous: this server builds a new McpServer per
 *    HTTP request, so there is no benefit to an async wrapper around a
 *    synchronous `registerAppResource` call.
 *  - Successfully-read HTML is memoized in a module-level Map keyed by
 *    resource URI, so repeated `resources/read` calls (one per request)
 *    do not re-read the same file from disk. Failed reads are NOT
 *    memoized, so a later `npm run build:apps` is picked up without a
 *    server restart.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ReadResourceResult } from "@modelcontextprotocol/sdk/types.js";
import { registerAppResource, RESOURCE_MIME_TYPE } from "@modelcontextprotocol/ext-apps/server";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { logger } from "../../utils/logger";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Base path for built MCP apps.
 * After rollup bundling, import.meta.url points to dist/index(.esm|.cjs).js
 * so we need ./apps to reach dist/apps/.
 *
 * This resolves relative to the built bundle (dist/), not the source tree —
 * running from source via `npm run dev` has no dist/apps, so it serves the
 * "not found" fallback HTML by design (run `npm run build:apps` to populate it).
 */
const APP_BASE_PATH = path.resolve(__dirname, "./apps");

/**
 * CSP domain lists attached to every app resource's contents (`_meta.ui.csp`).
 * These are intentionally NOT attached to tool `_meta` — the ext-apps host
 * reads CSP from the resource contents that back the app's iframe.
 */
const APP_RESOURCE_CSP = {
  connectDomains: ["https://api.tomtom.com", "https://*.api.tomtom.com", "blob:"],
  resourceDomains: ["https://api.tomtom.com", "https://*.api.tomtom.com", "blob:", "data:"],
};

/**
 * Module-level memoization of successfully-read app HTML, keyed by resource
 * URI. Avoids a disk read on every `resources/read` call.
 */
const htmlCache = new Map<string, string>();

/**
 * Register an MCP App resource from the dist-apps directory.
 *
 * @param server - MCP server instance
 * @param resourceUri - URI for the resource (e.g., "ui://tomtom-traffic/area-analytics/app.html")
 * @param category - App category (e.g., area-analytics, traffic-incidents)
 * @param appName - App directory name
 */
export function registerAppResourceFromPath(
  server: McpServer,
  resourceUri: string,
  category: string,
  appName: string
): void {
  const htmlPath = path.join(APP_BASE_PATH, category, appName, "app.html");

  registerAppResource(
    server,
    resourceUri,
    resourceUri,
    { mimeType: RESOURCE_MIME_TYPE },
    async (): Promise<ReadResourceResult> => {
      const cached = htmlCache.get(resourceUri);

      if (cached !== undefined) {
        return buildResult(resourceUri, cached);
      }

      try {
        const html = await fs.readFile(htmlPath, "utf-8");
        htmlCache.set(resourceUri, html);
        return buildResult(resourceUri, html);
      } catch (error) {
        logger.warn(
          `Failed to load app resource "${resourceUri}" from "${htmlPath}": ${String(error)}`
        );
        return {
          contents: [
            {
              uri: resourceUri,
              mimeType: RESOURCE_MIME_TYPE,
              text: `<!DOCTYPE html><html><head><title>Error</title></head><body><p>App not found. Run <code>npm run build:apps</code></p><p>Path: ${htmlPath}</p></body></html>`,
            },
          ],
        };
      }
    }
  );
}

function buildResult(resourceUri: string, html: string): ReadResourceResult {
  return {
    contents: [
      {
        uri: resourceUri,
        mimeType: RESOURCE_MIME_TYPE,
        text: html,
        _meta: {
          ui: {
            csp: APP_RESOURCE_CSP,
          },
        },
      },
    ],
  };
}
