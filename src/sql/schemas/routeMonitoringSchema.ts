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

import { TableDefinition } from "../types";

/**
 * Table schema for route monitoring route info
 */
export const ROUTE_INFO_TABLE: TableDefinition = {
  name: "route_info",
  columns: [
    { name: "route_id", type: "INTEGER", nullable: false },
    { name: "route_name", type: "TEXT", nullable: true },
    { name: "route_status", type: "TEXT", nullable: true },
    { name: "travel_time", type: "REAL", nullable: true },
    { name: "typical_travel_time", type: "REAL", nullable: true },
    { name: "delay_time", type: "REAL", nullable: true },
    { name: "passable", type: "INTEGER", nullable: true }, // 0/1 boolean
    { name: "route_length", type: "REAL", nullable: true },
    { name: "completeness", type: "REAL", nullable: true },
    { name: "typical_travel_time_coverage", type: "REAL", nullable: true },
    { name: "route_confidence", type: "REAL", nullable: true },
  ],
};

/**
 * Table schema for route monitoring segments
 */
export const SEGMENTS_TABLE: TableDefinition = {
  name: "segments",
  columns: [
    { name: "route_id", type: "INTEGER", nullable: false },
    { name: "segment_id", type: "BIGINT", nullable: false }, // Large 64-bit IDs from TomTom API
    { name: "segment_id_str", type: "TEXT", nullable: true },
    { name: "average_speed", type: "REAL", nullable: true },
    { name: "typical_speed", type: "REAL", nullable: true },
    { name: "segment_length", type: "REAL", nullable: true },
    { name: "open_lr_id", type: "TEXT", nullable: true },
    { name: "current_speed", type: "REAL", nullable: true },
    { name: "relative_speed", type: "REAL", nullable: true },
    { name: "confidence", type: "REAL", nullable: true },
    { name: "open_lr_length", type: "REAL", nullable: true },
  ],
};

/**
 * Complete schema for route monitoring details tool
 */
export const ROUTE_MONITORING_SCHEMA: TableDefinition[] = [ROUTE_INFO_TABLE, SEGMENTS_TABLE];

/**
 * SQL query examples for route monitoring details tool documentation
 */
export const ROUTE_MONITORING_SQL_EXAMPLES = `
Available tables: route_info, segments

Example queries:
1. Slow segments (below 50% typical speed):
   SELECT segment_id, current_speed, typical_speed, (typical_speed - current_speed) as speed_diff
   FROM segments WHERE current_speed < typical_speed * 0.5 ORDER BY speed_diff DESC

2. Route summary with segment stats:
   SELECT r.route_name, r.travel_time, r.delay_time, COUNT(s.segment_id) as segment_count, AVG(s.confidence) as avg_confidence
   FROM route_info r LEFT JOIN segments s ON r.route_id = s.route_id GROUP BY r.route_id

3. Low confidence segments:
   SELECT segment_id, current_speed, confidence
   FROM segments WHERE confidence < 0.5 ORDER BY confidence ASC
`.trim();
