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
  trafficFlowDataSchema,
  trafficIncidentsSchema,
} from "../schemas/live-traffic/liveTrafficSchema";
import {
  getFlowSegmentDataHandler,
  createTrafficIncidentsHandler,
} from "../handlers/liveTrafficHandler";

/**
 * Creates and registers Traffic API tools (Flow, Incidents, etc.)
 */
export function createLiveTrafficTools(server: McpServer): void {
  server.registerTool(
    "tomtom-traffic-flow-segment",
    {
      description: `Get real-time traffic flow information for the road segment closest to given coordinates. Returns one segment per call: current and free-flow speed, current and free-flow travel time, confidence, and road-closure flag.

REQUIRES sql_queries parameter - an object with named queries, e.g.: {"segment_info": "SELECT ..."}

**SQL Dialect: DuckDB** (PostgreSQL-compatible).

**Available Table: flow_segment**
Columns: frc (FRC0-FRC6, see server FRC scale), current_speed, free_flow_speed, current_travel_time, free_flow_travel_time, confidence, road_closure (0/1), coordinates, openlr

**Example queries:**
- Get segment data: SELECT frc, current_speed, free_flow_speed, confidence FROM flow_segment
- Calculate delay: SELECT current_travel_time - free_flow_travel_time as delay_seconds, confidence FROM flow_segment`,
      inputSchema: trafficFlowDataSchema,
    },
    getFlowSegmentDataHandler()
  );

  server.registerTool(
    "tomtom-traffic-incidents",
    {
      description: `Query live traffic incidents (accidents, jams, closures, roadworks) within one or more named bounding boxes. Returns each active incident in the requested areas with category, delay, magnitude, geometry, and report metadata.

    REQUIRES sql_queries parameter - an object with named queries, e.g.: {"accidents": "SELECT ..."}

    **SQL Dialect: DuckDB** (PostgreSQL-compatible).

    **Available Table: incidents**
    Columns: area_name (for multi-bbox queries), id, iconCategory, magnitudeOfDelay, startTime, endTime, "from", "to", length, delay, roadNumbers, timeValidity, probabilityOfOccurrence, numberOfReports, lastReportTime, geometry_type, coordinates

    **IMPORTANT - delay column availability:**
    - Accident, JamLane, LaneClosure have real-time delay measurements
    - RoadWorks are informational markers with NULL delay - they mark construction zones, not real-time congestion
    - When averaging delays, use WHERE delay IS NOT NULL to exclude informational incidents

    **Default:** Use iconCategory IN ('Accident', 'RoadWorks') for accidents + roadworks. Use iconCategory = 'JamLane' or 'LaneClosure' only when user requests jams/lane issues.

    **Example queries:**
    - Default (accidents + roadworks): SELECT id, iconCategory, delay FROM incidents WHERE iconCategory IN ('Accident', 'RoadWorks')
    - Count by type: SELECT iconCategory, COUNT(*) as count FROM incidents GROUP BY iconCategory
    - Top delays: SELECT id, delay FROM incidents WHERE delay IS NOT NULL ORDER BY delay DESC LIMIT 10

    **MULTI-AREA COMPARISON queries:**
    - Incidents by area: SELECT area_name, COUNT(*) as total_incidents, SUM(CASE WHEN iconCategory = 'Accident' THEN 1 ELSE 0 END) as accidents FROM incidents GROUP BY area_name
    - Average delay by area: SELECT area_name, ROUND(AVG(delay), 2) as avg_delay_sec, COUNT(*) as incidents_with_delay FROM incidents WHERE delay IS NOT NULL GROUP BY area_name ORDER BY avg_delay_sec DESC`,
      inputSchema: trafficIncidentsSchema,
    },
    createTrafficIncidentsHandler()
  );
}
