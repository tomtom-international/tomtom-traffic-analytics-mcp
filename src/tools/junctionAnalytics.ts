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
  junctionSearchSchema,
  junctionLiveDataDetailsSchema,
  junctionArchiveSchema,
} from "../schemas/junction-analytics/junctionAnalyticsSchema";
import {
  getJunctionSearchHandler,
  getJunctionLiveDataDetailsHandler,
  getJunctionArchiveHandler,
} from "../handlers/junctionAnalyticsHandler";

/**
 * Creates and registers Junction Analytics tools
 */
export function createJunctionAnalyticsTools(server: McpServer): void {
  // Search junctions with SQL filtering
  server.registerTool(
    "tomtom-junction-search",
    {
      description: `Search and filter all your junctions using SQL queries. Use this FIRST to discover junction IDs by name, status, country, or other properties, then pass the IDs to tomtom-junction-live-data or tomtom-junction-archive for traffic analysis. Returns junction catalog metadata only — no live traffic data. Junctions must be pre-created in Move Portal (no ad-hoc lat/lon queries).

    Fetches ALL junctions (auto-paginating) and loads them into a queryable database.

    REQUIRES sql_queries parameter - an object with named queries, e.g.: {"active": "SELECT ..."}

    **SQL Dialect: DuckDB** (PostgreSQL-compatible).

    **Compact view (default) - Table: junctions**
    Columns: junction_id, name, status (ACTIVE/PENDING_UPDATE/ERROR), country_code (ISO 3166-1 alpha-3, e.g. ESP/DEU/USA), drive_on_left (0/1), traffic_lights (0/1), num_approaches, num_exits, created_at, last_modified_at, time_zone

    **Full view (view="full") - adds tables: approaches, exits**
    - approaches: junction_id, approach_id, name, road_name, direction (NORTH/SOUTH/EAST/WEST), frc (numeric 0-7, see server FRC scale), length, one_way_road (0/1), excluded (0/1), drivable (0/1)
    - exits: junction_id, exit_id, name, road_name, direction, frc, one_way_road (0/1), drivable (0/1)

    **Example queries:**
    - Find by name: SELECT junction_id, name FROM junctions WHERE name ILIKE '%highway%'
    - Active junctions: SELECT junction_id, name, country_code FROM junctions WHERE status = 'ACTIVE'
    - Count by country: SELECT country_code, COUNT(*) as cnt FROM junctions GROUP BY country_code ORDER BY cnt DESC  -- country_code uses 3-letter codes: ESP, DEU, USA, GBR
    - Find by road (full view): SELECT j.junction_id, j.name, a.road_name FROM junctions j JOIN approaches a ON j.junction_id = a.junction_id WHERE a.road_name ILIKE '%Main%'`,
      inputSchema: junctionSearchSchema,
    },
    getJunctionSearchHandler()
  );

  // Get junction live data details with SQL filtering
  server.registerTool(
    "tomtom-junction-live-data",
    {
      description: `Real-time traffic snapshot for one or more junctions. Returns a single live reading per junction covering approach delays, queue lengths, turn ratios, and stops histogram. Use tomtom-junction-search first to discover junction IDs.

    REQUIRES sql_queries parameter - an object with named queries, e.g.: {"delays": "SELECT ..."}

    **SQL Dialect: DuckDB** (PostgreSQL-compatible). Use DuckDB functions:
    - Rounding: ROUND(value, 2)
    - No template variables — data is pre-loaded, just query it directly

    **Important — includeGeometry side effect:**
    The three *_metadata tables (junction_metadata, approach_metadata, exit_metadata) are only populated when includeGeometry=true. Without it, JOINs to those tables silently return empty rows.

    **Available Tables:**
    - approaches: junction_id, approach_id, travel_time_sec, free_flow_travel_time_sec, delay_sec, usual_delay_sec, stops, queue_length_meters, volume_per_hour, is_closed (0/1)
    - turn_ratios: junction_id, approach_id, exit_id, exit_index, ratio_percent, probes_count
    - stops_histogram: junction_id, approach_id, number_of_stops, number_of_vehicles
    - junction_metadata: junction_id, name, country_code (3-letter ISO: ESP/DEU/USA), drive_on_left (0/1), traffic_lights (0/1)
    - approach_metadata: junction_id, approach_id, name, road_name, direction, frc (numeric 0-7, see server FRC scale), length, one_way_road, excluded, drivable
    - exit_metadata: junction_id, exit_id, name, road_name, direction, frc (numeric 0-7, see server FRC scale), one_way_road, drivable

    **Example queries:**
    - Most delayed: SELECT approach_id, delay_sec, queue_length_meters FROM approaches ORDER BY delay_sec DESC LIMIT 5
    - Turn ratios: SELECT exit_id, ratio_percent FROM turn_ratios WHERE approach_id = 1 ORDER BY ratio_percent DESC
    - With metadata: SELECT a.approach_id, am.road_name, a.delay_sec FROM approaches a LEFT JOIN approach_metadata am ON a.approach_id = am.approach_id

    **MULTI-JUNCTION COMPARISON queries:**
    - Rank by congestion: SELECT junction_id, ROUND(AVG(delay_sec), 2) as avg_delay FROM approaches GROUP BY junction_id ORDER BY avg_delay DESC
    - Compare queues: SELECT junction_id, MAX(queue_length_meters) as max_queue, COUNT(DISTINCT approach_id) as num_approaches FROM approaches GROUP BY junction_id`,
      inputSchema: junctionLiveDataDetailsSchema,
    },
    getJunctionLiveDataDetailsHandler()
  );

  // Get junction archive with SQL filtering
  server.registerTool(
    "tomtom-junction-archive",
    {
      description: `Download minute-by-minute historical traffic data for junctions over a specified date range (maximum 2 days). Use tomtom-junction-search first to find junction IDs. Use for peak-hour analysis, before/after comparisons, and intra-day pattern detection.

    REQUIRES sql_queries parameter - an object with named queries, e.g.: {"hourly_avg": "SELECT ..."}

    **SQL Dialect: DuckDB** (PostgreSQL-compatible). Use DuckDB functions:
    - Date formatting: time::DATE, date_part('hour', time::TIMESTAMP)
    - Rounding: ROUND(value, 2)
    - No template variables — data is pre-loaded, just query it directly

    **Available Tables:**
    - approaches: time, junction_id, approach_id, travel_time_sec, free_flow_travel_time_sec, delay_sec, usual_delay_sec, stops, queue_length_meters, volume_per_hour, is_closed (0/1)
    - turn_ratios: time, junction_id, approach_id, exit_id, exit_index, ratio_percent, probes_count

    **Example queries:**
    - Hourly delays: SELECT date_part('hour', time::TIMESTAMP) as hour, ROUND(AVG(delay_sec), 2) as avg_delay, MAX(delay_sec) as max_delay FROM approaches GROUP BY hour ORDER BY avg_delay DESC
    - Peak congestion: SELECT approach_id, ROUND(AVG(delay_sec), 2) as avg_delay, ROUND(AVG(queue_length_meters), 2) as avg_queue FROM approaches WHERE delay_sec > 30 GROUP BY approach_id ORDER BY avg_delay DESC LIMIT 5
    - Turn distribution: SELECT approach_id, exit_id, ROUND(AVG(ratio_percent), 2) as avg_ratio FROM turn_ratios GROUP BY approach_id, exit_id HAVING avg_ratio > 20

    **MULTI-JUNCTION COMPARISON queries:**
    - Compare junctions by average delay: SELECT junction_id, ROUND(AVG(delay_sec), 2) as avg_delay, ROUND(AVG(queue_length_meters), 2) as avg_queue FROM approaches GROUP BY junction_id ORDER BY avg_delay DESC
    - Hourly patterns per junction: SELECT junction_id, date_part('hour', time::TIMESTAMP) as hour, ROUND(AVG(delay_sec), 2) as avg_delay FROM approaches GROUP BY junction_id, hour ORDER BY junction_id, hour`,
      inputSchema: junctionArchiveSchema,
    },
    getJunctionArchiveHandler()
  );
}
