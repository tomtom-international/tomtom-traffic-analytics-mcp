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
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { logger } from "./utils/logger";
import { validateMovePortalApiKey } from "./services/base/tomtomClient";
import { createJunctionAnalyticsTools } from "./tools/junctionAnalytics";
import { createRouteMonitoringTools } from "./tools/routeMonitoring";
import { createAreaAnalyticsTools } from "./tools/areaAnalytics";
import { createLiveTrafficTools } from "./tools/liveTraffic";
import { VERSION } from "./version";

const SERVER_INSTRUCTIONS = `TomTom traffic analytics over TomTom Traffic and Move Portal APIs. Eight tools across four domains:

- Live Traffic — point/area real-time data, no pre-config. Uses TOMTOM_API_KEY.
  - tomtom-traffic-flow-segment: speed/travel-time for one coordinate.
  - tomtom-traffic-incidents: incidents across 1–10 named bounding boxes.

- Area Analytics — historical stats for any GeoJSON polygon. Uses TOMTOM_MOVE_PORTAL_KEY.
  - tomtom-area-analytics-stats: aggregated speed/congestion, up to 31-day window, end date ≥ 2 days ago.

- Junction Analytics — junctions must be pre-created in Move Portal (cannot query arbitrary lat/lon). Uses TOMTOM_MOVE_PORTAL_KEY.
  - tomtom-junction-search → discover junction IDs first.
  - tomtom-junction-live-data: real-time metrics, up to 20 junctions per call.
  - tomtom-junction-archive: minute-by-minute history, max 2-day window, up to 20 junctions.

- Route Monitoring — routes must be pre-created in Move Portal. Uses TOMTOM_MOVE_PORTAL_KEY.
  - tomtom-route-search → discover route IDs first.
  - tomtom-route-monitoring-details: segment-level analysis, up to 20 routes per call.

Every tool requires a \`sql_queries\` parameter: an object mapping named keys to DuckDB SELECT queries — e.g. \`{"my_query": "SELECT ... FROM table_name"}\`. SQL dialect is DuckDB (PostgreSQL-compatible). API responses are flattened into in-memory tables; only your SELECT results return — full responses never enter context. SELECT-only, 5-second timeout, 10,000-row result cap. Booleans stored as 0/1 integers (1 = true, e.g. is_closed=1 means road is closed; 0 = false). DuckDB tips: \`ROUND(value, 2)\` for rounding; data is pre-loaded, so no template variables. Per-tool table schemas, columns and example queries live in each tool description.

FRC scale (Functional Road Class — road importance, lower number = more major road): 0=Motorway, 1=Major, 2=OtherMajor, 3=Secondary, 4=LocalConnecting, 5=LocalHigh, 6=Local, 7=LocalMinor, 8=Other. Live-traffic flow-segment uses string codes "FRC0"–"FRC6"; junction tools use integer 0–7; area-analytics input filter accepts 0–8.`;

/**
 * Factory function that creates and configures a TomTom Traffic Analytics MCP Server instance
 */
export function createServer(): McpServer {
  logger.info("Initializing TomTom Traffic Analytics MCP Server");

  validateServerApiKey();

  const server = new McpServer(
    {
      name: "TomTom Traffic Analytics MCP Server",
      version: VERSION,
    },
    {
      instructions: SERVER_INSTRUCTIONS,
    }
  );

  // Register all tools
  registerTools(server);

  logger.info("✅ TomTom Traffic Analytics MCP Server initialized with all tools");
  return server;
}

/**
 * Validates API key at startup
 */
function validateServerApiKey(): void {
  try {
    validateMovePortalApiKey();
    logger.info("✅ TomTom API key validated successfully");
  } catch (error: any) {
    logger.error(`❌ API key validation failed: ${error.message}`);
    logger.warn("Server will start but API calls may fail without valid credentials");
  }
}

/**
 * Registers all tools with the server
 */
function registerTools(server: McpServer): void {
  // Register area analytics tools
  createAreaAnalyticsTools(server);

  // Register junction analytics tools
  createJunctionAnalyticsTools(server);

  // Register route monitoring tools
  createRouteMonitoringTools(server);

  // Register Traffic API tools (flow, incidents, etc.)
  createLiveTrafficTools(server);
}
