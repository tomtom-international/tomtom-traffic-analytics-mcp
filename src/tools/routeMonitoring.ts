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

  // Search routes with sandboxed JS filtering
  server.registerTool(
    "tomtom-route-search",
    {
      description: `Search and filter all your monitored routes using JavaScript. Use this FIRST to discover route IDs by name, status, delay, or other properties, then pass the IDs to tomtom-route-monitoring-details for segment-level analysis. Returns one row per monitored route with current aggregate delay and travel-time vs typical. Routes must be pre-configured in Move Portal.

    Fetches all routes with current traffic data and loads them into the sandbox.

    REQUIRES js_queries — e.g. {"delayed": "routes.filter(r => r.delay_time > 60)"}.

    **Runtime:** sandboxed JavaScript — see the server instructions for the query contract.

    Booleans are 0/1 numbers (passable=1 means the route is passable).

    **Available dataset: routes**
    Fields: route_id, route_name, route_status (NEW/ACTIVE/UPDATING/FAILED/ARCHIVED), travel_time, typical_travel_time, delay_time, passable (0/1), route_length, completeness, typical_travel_time_coverage

    **route_status states:**
    - ACTIVE: live monitoring, data flowing
    - NEW: created, not yet processed
    - UPDATING: definition being modified
    - FAILED: setup or processing error
    - ARCHIVED: no longer monitored, historical data retained

    **Example queries:**
    - Find by name: routes.filter(r => r.route_name.includes('A10')).map(r => ({ id: r.route_id, name: r.route_name }))
    - Delayed routes: routes.filter(r => r.delay_time > 60).sort((a, b) => b.delay_time - a.delay_time)
    - Status summary: Object.entries(Object.groupBy(routes, r => r.route_status)).map(([status, rows]) => ({ status, count: rows.length }))
    - Active with delays: routes.filter(r => r.route_status === 'ACTIVE' && r.delay_time > 0).map(r => ({ id: r.route_id, name: r.route_name, delayPct: r.travel_time ? +(r.delay_time * 100 / r.travel_time).toFixed(1) : null })).sort((a, b) => b.delayPct - a.delayPct)`,
      inputSchema: routeSearchSchema,
    },
    handlers.searchRoutes
  );

  // Get route details with sandboxed JS filtering
  server.registerTool(
    "tomtom-route-monitoring-details",
    {
      description: `Get detailed segment-level traffic analysis for routes. Use tomtom-route-search first to find route IDs. Returns a route-info summary plus one row per road segment with current vs typical speed, confidence, and OpenLR references.

    REQUIRES js_queries — e.g. {"slow_segments": "segments.filter(s => s.relative_speed < 80)"}.

    **Runtime:** sandboxed JavaScript — see the server instructions for the query contract.

    Booleans are 0/1 numbers.

    **Available datasets:**
    - route_info: route_id, route_name, route_status, travel_time, typical_travel_time, delay_time, passable (0/1), route_length, completeness, typical_travel_time_coverage, route_confidence (0-100 percentage)
    - segments: route_id, segment_id, segment_id_str, average_speed, typical_speed, segment_length, open_lr_id (OpenLR encoded segment reference), current_speed, relative_speed (% of typical; 100=at typical, <100=slower, >100=faster), confidence (0-100 percentage), open_lr_length (meters)

    **OpenLR:** open standard for map-agnostic encoding of road segments — the same segment can be referenced across different map databases.

    **Example queries:**
    - Slow segments: segments.filter(s => s.current_speed < s.typical_speed * 0.5).map(s => ({ id: s.segment_id, current: s.current_speed, typical: s.typical_speed, diff: s.typical_speed - s.current_speed })).sort((a, b) => b.diff - a.diff)
    - Route summary: route_info.map(r => ({ name: r.route_name, travelTime: r.travel_time, delay: r.delay_time, confidence: +r.route_confidence.toFixed(2) }))
    - Low confidence: segments.filter(s => s.confidence < 90).sort((a, b) => a.confidence - b.confidence)

    **MULTI-ROUTE COMPARISON queries:**
    - Compare by delay: route_info.map(r => ({ id: r.route_id, name: r.route_name, delay: r.delay_time, delayPct: r.travel_time ? +(r.delay_time * 100 / r.travel_time).toFixed(1) : null })).sort((a, b) => b.delayPct - a.delayPct)
    - Worst segment per route: Object.entries(Object.groupBy(segments, s => s.route_id)).map(([id, rows]) => ({ id, worst: rows.reduce((w, s) => (s.relative_speed < w.relative_speed ? s : w)) }))`,
      inputSchema: getRouteDetailsSchema,
    },
    handlers.getRouteDetails
  );
}
