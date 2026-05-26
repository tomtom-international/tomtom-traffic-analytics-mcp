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
import { areaAnalyticsStatsSchema } from "../schemas/area-analytics/areaAnalyticsSchema";
import { getAreaAnalyticsStatsHandler } from "../handlers/areaAnalyticsHandler";

/**
 * Creates and registers Area Analytics tools
 */
export function createAreaAnalyticsTools(server: McpServer): void {
  server.registerTool(
    "tomtom-area-analytics-stats",
    {
      description: `Retrieve historical traffic patterns (speed, free-flow speed, congestion, travel time) for one GeoJSON polygon over up to a 31-day window. NOT real-time — end date must be ≥ 2 days before today. timed_data = time-series across the polygon (trends over hours/days/months); tiled_data = spatial grid cells within the polygon (hotspot locations). Use for trend analysis, peak vs off-peak comparison, and hotspot detection.

    Date helpers for the \`time\` column: \`time::DATE\`, \`date_part('hour', time::TIMESTAMP)\`.

    **Available Tables:**
    - timed_data: region_name, timezone, level, aggregation_type ('all'|'yearly'|'monthly'|'daily'|'hourly'), time, speed, free_flow_speed, congestion_level (0-100; 0=free flow, 100=standstill), travel_time, network_length
    - tiled_data: region_name, lat, lon, speed, free_flow_speed, congestion_level (0-100; 0=free flow, 100=standstill), travel_time, network_length

    Note: Column data depends on dataTypes you request. Valid values: NETWORK_LENGTH, CONGESTION_LEVEL, FREE_FLOW_SPEED, TRAVEL_TIME, SPEED. E.g., free_flow_speed column requires FREE_FLOW_SPEED in dataTypes.

    **Spatial column on tiled_data** (avoid SELECT * — non-text type):
    - point_geom (GEOMETRY): ST_Point(lon, lat) of the tile centroid, populated on demand by ST_ functions
    - Example: SELECT lat, lon, congestion_level FROM tiled_data WHERE ST_DWithin(point_geom, ST_Point(4.9, 52.37), 1000)

    **Example queries:**
    - Daily trend: SELECT time::DATE as day, ROUND(AVG(congestion_level), 2) as avg FROM timed_data WHERE aggregation_type = 'daily' GROUP BY day ORDER BY day
    - Hotspots (congestion > 70%): SELECT lat, lon, congestion_level FROM tiled_data WHERE congestion_level > 70 ORDER BY congestion_level DESC LIMIT 20`,
      inputSchema: areaAnalyticsStatsSchema,
    },
    getAreaAnalyticsStatsHandler()
  );
}
