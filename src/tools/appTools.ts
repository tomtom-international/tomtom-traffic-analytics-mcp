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
import { getJunctionLiveData } from "../services/junction-analytics/junctionAnalyticsService";
import { getRouteDetails } from "../services/route-monitoring/routeMonitoringService";

const getApiKeySchema = {};

const getVizDataSchema = {
  viz_id: z.string().describe("Unique visualization ID from the tool response _meta"),
};

const getJunctionLiveSchema = {
  junctionIds: z.array(z.string()).min(1).max(20).describe("Junction IDs to fetch live data for"),
};

const getRouteDetailsSchema = {
  routeIds: z.array(z.coerce.string()).min(1).max(20).describe("Route IDs to fetch details for"),
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

  registerAppTool(
    server,
    "tomtom-get-junction-live",
    {
      title: "Get Junction Live Data",
      description: "Internal tool for apps to fetch raw live data for junctions on demand",
      inputSchema: getJunctionLiveSchema,
      annotations: {
        title: "Get Junction Live Data",
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
    async (params: { junctionIds: string[] }) => {
      try {
        const junctions = await Promise.all(
          params.junctionIds.map((id) => getJunctionLiveData(id))
        );
        return {
          content: [{ type: "text" as const, text: JSON.stringify({ junctions }) }],
          isError: false,
        };
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Failed to fetch junction live data";
        return {
          content: [{ type: "text" as const, text: message }],
          isError: true,
        };
      }
    }
  );

  registerAppTool(
    server,
    "tomtom-get-route-details",
    {
      title: "Get Route Details",
      description: "Internal tool for apps to fetch raw detailed data for routes on demand",
      inputSchema: getRouteDetailsSchema,
      annotations: {
        title: "Get Route Details",
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
    async (params: { routeIds: string[] }) => {
      try {
        const routes = await Promise.all(params.routeIds.map((id) => getRouteDetails(id)));
        return {
          content: [{ type: "text" as const, text: JSON.stringify({ routes }) }],
          isError: false,
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : "Failed to fetch route details";
        return {
          content: [{ type: "text" as const, text: message }],
          isError: true,
        };
      }
    }
  );
}
