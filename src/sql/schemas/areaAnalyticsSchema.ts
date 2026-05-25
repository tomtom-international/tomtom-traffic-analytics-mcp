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
 * Table schema for area analytics timed data (temporal aggregations)
 */
export const TIMED_DATA_TABLE: TableDefinition = {
  name: "timed_data",
  columns: [
    { name: "region_name", type: "TEXT", nullable: true },
    { name: "timezone", type: "TEXT", nullable: true },
    { name: "level", type: "INTEGER", nullable: true },
    { name: "aggregation_type", type: "TEXT", nullable: false }, // 'all', 'yearly', 'monthly', 'daily', 'hourly'
    { name: "time", type: "TEXT", nullable: true },
    { name: "speed", type: "REAL", nullable: true }, // v
    { name: "free_flow_speed", type: "REAL", nullable: true }, // fv
    { name: "congestion_level", type: "REAL", nullable: true }, // c
    { name: "travel_time", type: "REAL", nullable: true }, // t
    { name: "network_length", type: "REAL", nullable: true }, // l
  ],
};

/**
 * Table schema for area analytics tiled data (spatial aggregations)
 */
export const TILED_DATA_TABLE: TableDefinition = {
  name: "tiled_data",
  columns: [
    { name: "region_name", type: "TEXT", nullable: true },
    { name: "lat", type: "REAL", nullable: false },
    { name: "lon", type: "REAL", nullable: false },
    { name: "speed", type: "REAL", nullable: true }, // v
    { name: "free_flow_speed", type: "REAL", nullable: true }, // fv
    { name: "congestion_level", type: "REAL", nullable: true }, // c
    { name: "travel_time", type: "REAL", nullable: true }, // t
    { name: "network_length", type: "REAL", nullable: true }, // l
    { name: "point_geom", type: "GEOMETRY", nullable: true }, // Native geometry for spatial queries (ST_Point(lon, lat))
  ],
};

/**
 * Complete schema for area analytics results tool
 */
export const AREA_ANALYTICS_SCHEMA: TableDefinition[] = [TIMED_DATA_TABLE, TILED_DATA_TABLE];

/**
 * SQL query examples for area analytics results tool documentation
 */
export const AREA_ANALYTICS_SQL_EXAMPLES = `
Available tables: timed_data, tiled_data

congestion_level is on a 0-100 scale (0=free flow, 100=standstill).

Spatial column on tiled_data (avoid SELECT * — non-text type):
- point_geom (GEOMETRY): ST_Point(lon, lat) of the tile centroid, populated on demand by ST_ functions

Example queries:
1. Daily congestion trend:
   SELECT time, AVG(congestion_level) as avg_congestion
   FROM timed_data WHERE aggregation_type = 'daily' GROUP BY time ORDER BY time

2. Congestion hotspots:
   SELECT lat, lon, congestion_level
   FROM tiled_data WHERE congestion_level > 70 ORDER BY congestion_level DESC LIMIT 50

3. Speed comparison by aggregation level:
   SELECT aggregation_type, AVG(speed) as avg_speed, AVG(free_flow_speed) as avg_free_flow
   FROM timed_data GROUP BY aggregation_type
`.trim();
