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
 * Table schema for traffic flow segment data
 */
export const FLOW_SEGMENT_TABLE: TableDefinition = {
  name: "flow_segment",
  columns: [
    { name: "frc", type: "TEXT", nullable: true },
    { name: "current_speed", type: "REAL", nullable: true },
    { name: "free_flow_speed", type: "REAL", nullable: true },
    { name: "current_travel_time", type: "REAL", nullable: true },
    { name: "free_flow_travel_time", type: "REAL", nullable: true },
    { name: "confidence", type: "REAL", nullable: true },
    { name: "road_closure", type: "INTEGER", nullable: true },
    { name: "coordinates", type: "TEXT", nullable: true },
    { name: "openlr", type: "TEXT", nullable: true },
    { name: "geom_geojson", type: "TEXT", nullable: true }, // Full GeoJSON for ST_GeomFromGeoJSON
    { name: "geom", type: "GEOMETRY", nullable: true }, // Native geometry for spatial queries
  ],
};

/**
 * Complete schema for traffic flow segment tool
 */
export const TRAFFIC_FLOW_SEGMENT_SCHEMA: TableDefinition[] = [FLOW_SEGMENT_TABLE];

/**
 * SQL query examples for traffic flow segment tool documentation
 *
 * FRC (Functional Road Class):
 * FRC0=Motorway, FRC1=Major road, FRC2=Other major, FRC3=Secondary,
 * FRC4=Local connecting, FRC5=Local high, FRC6=Local
 */
export const TRAFFIC_FLOW_SEGMENT_SQL_EXAMPLES = `
Available table: flow_segment
Columns: frc (FRC0-FRC6), current_speed, free_flow_speed, current_travel_time, free_flow_travel_time, confidence (0-1, 1=highest quality), road_closure (0/1), coordinates, openlr

Spatial columns (avoid SELECT * — non-text types):
- geom_geojson (TEXT): GeoJSON LineString of the segment, queryable directly
- geom (GEOMETRY): native geometry, populated on demand by ST_ functions

FRC: FRC0=Motorway, FRC1=Major, FRC2=Other major, FRC3=Secondary, FRC4=Local connecting, FRC5=Local high, FRC6=Local

Example queries:
1. Get segment data:
   SELECT frc, current_speed, free_flow_speed, confidence FROM flow_segment

2. Calculate delay:
   SELECT current_travel_time - free_flow_travel_time as delay_seconds, confidence FROM flow_segment

3. Check road closure:
   SELECT frc, road_closure, current_speed FROM flow_segment WHERE road_closure = 1
`.trim();
