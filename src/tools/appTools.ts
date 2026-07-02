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
 * App-only tools: internal helpers consumed by MCP Apps (interactive UIs),
 * never surfaced to the LLM. Registered with `_meta.ui.visibility: ["app"]`.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerAppTool } from "@modelcontextprotocol/ext-apps/server";
import { z } from "zod";
import { getEffectiveApiKey } from "../services/base/tomtomClient";
import { getVizData } from "../services/cache/vizCache";

const getApiKeySchema = {};

const getVizDataSchema = {
  viz_id: z.string().describe("Unique visualization ID from the tool response _meta"),
};

/**
 * Creates and registers app-only tools.
 * These tools are only callable by MCP Apps (interactive UIs), not by the LLM.
 *
 * IMPORTANT: `tomtom-get-api-key` must only ever expose the standard TomTom
 * API key (`getEffectiveApiKey`) — the Move Portal key must never be reachable
 * from an app-facing tool.
 */
export function createAppTools(server: McpServer): void {
  registerAppTool(
    server,
    "tomtom-get-api-key",
    {
      title: "Get TomTom API Key",
      description: "Internal tool for apps to retrieve the TomTom API key",
      inputSchema: getApiKeySchema,
      annotations: {
        title: "Get TomTom API Key",
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
      _meta: {
        ui: {
          visibility: ["app"],
        },
      },
    },
    async () => {
      const apiKey = getEffectiveApiKey();

      if (!apiKey) {
        return {
          content: [{ type: "text" as const, text: "API key not available" }],
          isError: true,
        };
      }

      return {
        content: [{ type: "text" as const, text: apiKey }],
        isError: false,
      };
    }
  );

  registerAppTool(
    server,
    "tomtom-get-viz-data",
    {
      title: "Get Visualization Data",
      description: "Internal tool for apps to retrieve cached visualization data by viz_id",
      inputSchema: getVizDataSchema,
      annotations: {
        title: "Get Visualization Data",
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
      _meta: {
        ui: {
          visibility: ["app"],
        },
      },
    },
    async (params: { viz_id: string }) => {
      const data = getVizData(params.viz_id);

      if (data === undefined) {
        return {
          content: [{ type: "text" as const, text: "Visualization data not found or expired" }],
          isError: true,
        };
      }

      return {
        content: [{ type: "text" as const, text: JSON.stringify(data) }],
        isError: false,
      };
    }
  );
}
