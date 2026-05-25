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
import {
  getRouteDetailsSchema,
  routeSearchSchema,
} from "../schemas/route-monitoring/routeMonitoringSchema";
import { createRouteMonitoringHandlers } from "../handlers/routeMonitoringHandler";

/**
 * Creates and registers route monitoring tools
 */
export function createRouteMonitoringTools(server: McpServer): void {
  const handlers = createRouteMonitoringHandlers();

  // Search routes with SQL filtering
  server.registerTool(
    "tomtom-route-search",
    {
      description: `Search and filter all your monitored routes using SQL queries. Use this FIRST to discover route IDs by name, status, delay, or other properties, then pass the IDs to tomtom-route-monitoring-details for segment-level analysis. Returns one row per monitored route with current aggregate delay and travel-time vs typical.

    Fetches all routes with current traffic data and loads them into a queryable database.

    REQUIRES sql_queries parameter - an object with named queries, e.g.: {"delayed": "SELECT ..."}

    **SQL Dialect: DuckDB** (PostgreSQL-compatible).

    **Table: routes**
    Columns: route_id, route_name, route_status (NEW/ACTIVE/UPDATING/FAILED/ARCHIVED), travel_time, typical_travel_time, delay_time, passable (0/1), route_length, completeness, typical_travel_time_coverage

    **Example queries:**
    - Find by name: SELECT route_id, route_name FROM routes WHERE route_name ILIKE '%A10%'
    - Delayed routes: SELECT route_id, route_name, delay_time FROM routes WHERE delay_time > 60 ORDER BY delay_time DESC
    - Status summary: SELECT route_status, COUNT(*) as cnt FROM routes GROUP BY route_status
    - Active with delays: SELECT route_id, route_name, delay_time, ROUND(delay_time * 100.0 / NULLIF(travel_time, 0), 1) as delay_pct FROM routes WHERE route_status = 'ACTIVE' AND delay_time > 0 ORDER BY delay_pct DESC`,
      inputSchema: routeSearchSchema,
    },
    handlers.searchRoutes
  );

  // Get route details with SQL filtering
  server.registerTool(
    "tomtom-route-monitoring-details",
    {
      description: `Get detailed segment-level traffic analysis for routes. Use tomtom-route-search first to find route IDs. Returns a route-info summary plus one row per road segment with current vs typical speed, confidence, and OpenLR references.

    REQUIRES sql_queries parameter - an object with named queries, e.g.: {"slow_segments": "SELECT ..."}

    **SQL Dialect: DuckDB** (PostgreSQL-compatible). Use DuckDB functions:
    - Rounding: ROUND(value, 2)
    - No template variables — data is pre-loaded, just query it directly

    **Available Tables:**
    - route_info: route_id, route_name, route_status, travel_time, typical_travel_time, delay_time, passable (0/1), route_length, completeness, typical_travel_time_coverage, route_confidence
    - segments: route_id, segment_id, segment_id_str, average_speed, typical_speed, segment_length, open_lr_id, current_speed, relative_speed, confidence, open_lr_length

    **Example queries:**
    - Slow segments: SELECT segment_id, current_speed, typical_speed, (typical_speed - current_speed) as speed_diff FROM segments WHERE current_speed < typical_speed * 0.5 ORDER BY speed_diff DESC
    - Route summary: SELECT route_name, travel_time, delay_time, ROUND(route_confidence, 2) as confidence FROM route_info
    - Low confidence: SELECT segment_id, current_speed, confidence FROM segments WHERE confidence < 0.5 ORDER BY confidence

    **MULTI-ROUTE COMPARISON queries:**
    - Compare routes by delay: SELECT route_id, route_name, delay_time, travel_time, ROUND(delay_time * 100.0 / NULLIF(travel_time, 0), 1) as delay_percent FROM route_info ORDER BY delay_percent DESC
    - Route performance ranking: SELECT route_id, route_name, ROUND(route_confidence, 2) as confidence, completeness FROM route_info ORDER BY route_confidence DESC`,
      inputSchema: getRouteDetailsSchema,
    },
    handlers.getRouteDetails
  );
}
