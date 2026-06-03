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
      description: `Retrieve historical traffic patterns (speed, free-flow speed, congestion, travel time) for one GeoJSON polygon over up to a 31-day window. NOT real-time — data has a 24–48h processing delay. timed_data = time-series across the polygon (trends over hours/days/months); tiled_data = spatial grid cells within the polygon (hotspot locations). Use for trend analysis, peak vs off-peak comparison, and hotspot detection.

    **Date constraint (avoids the most common 400 error):**
    - Without a feature timezone (UTC default): endDate must be ≥ 2 days before today.
    - WITH \`properties.timezone\` set on the feature (e.g. "Europe/Amsterdam"): the API applies a stricter rule — endDate must be ≥ 3 days before today. For the broadest coverage, leave the feature timezone UNSET and let the API default to UTC.

    REQUIRES sql_queries parameter: an object mapping named keys to DuckDB SELECT queries — e.g. {"daily_avg": "SELECT time::DATE AS day, AVG(congestion_level) FROM timed_data GROUP BY day"}.

    **SQL Dialect: DuckDB** (PostgreSQL-compatible). SELECT-only, 5s timeout, 10,000-row cap. Tips: ROUND(value, 2) for rounding; date helpers for the \`time\` column: time::DATE, date_part('hour', time::TIMESTAMP).

    **Available Tables:**
    - timed_data: region_name, timezone, level, aggregation_type ('all'|'yearly'|'monthly'|'daily'|'hourly'), time, speed, free_flow_speed, congestion_level (0-100; 0=free flow, 100=standstill), travel_time, network_length
    - tiled_data: region_name, lat, lon, speed, free_flow_speed, congestion_level (0-100; 0=free flow, 100=standstill), travel_time, network_length, point_geom (GEOMETRY, lazy ST_Point(lon, lat))

    Note: Column data depends on dataTypes you request. Valid values: NETWORK_LENGTH, CONGESTION_LEVEL, FREE_FLOW_SPEED, TRAVEL_TIME, SPEED. E.g., free_flow_speed column requires FREE_FLOW_SPEED in dataTypes.

    **Spatial column on tiled_data** — point_geom is native GEOMETRY populated on demand by ST_ functions. Avoid SELECT * (GEOMETRY does not serialise cleanly). Example: WHERE ST_DWithin(point_geom, ST_Point(4.9, 52.37), 1000).

    **Example queries:**
    - Daily trend: SELECT time::DATE as day, ROUND(AVG(congestion_level), 2) as avg FROM timed_data WHERE aggregation_type = 'daily' GROUP BY day ORDER BY day
    - Hotspots (congestion > 70%): SELECT lat, lon, congestion_level FROM tiled_data WHERE congestion_level > 70 ORDER BY congestion_level DESC LIMIT 20
    - Spatial filter: SELECT lat, lon, congestion_level FROM tiled_data WHERE ST_DWithin(point_geom, ST_Point(4.9, 52.37), 1000)`,
      inputSchema: areaAnalyticsStatsSchema,
    },
    getAreaAnalyticsStatsHandler()
  );
}
