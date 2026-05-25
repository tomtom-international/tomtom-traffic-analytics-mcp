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
 * Table schema for traffic incidents data
 */
export const INCIDENTS_TABLE: TableDefinition = {
  name: "incidents",
  columns: [
    { name: "area_name", type: "TEXT", nullable: true }, // Area identifier for multi-bbox comparison queries
    { name: "id", type: "TEXT", nullable: false },
    { name: "iconCategory", type: "TEXT", nullable: false },
    { name: "magnitudeOfDelay", type: "TEXT", nullable: true },
    { name: "startTime", type: "TEXT", nullable: true },
    { name: "endTime", type: "TEXT", nullable: true },
    { name: "from", type: "TEXT", nullable: true },
    { name: "to", type: "TEXT", nullable: true },
    { name: "length", type: "REAL", nullable: true },
    { name: "delay", type: "INTEGER", nullable: true },
    { name: "roadNumbers", type: "TEXT", nullable: true },
    { name: "timeValidity", type: "TEXT", nullable: true },
    { name: "probabilityOfOccurrence", type: "TEXT", nullable: true },
    { name: "numberOfReports", type: "INTEGER", nullable: true },
    { name: "lastReportTime", type: "TEXT", nullable: true },
    { name: "events", type: "TEXT", nullable: true }, // JSON-serialised array of {description, code, iconCategory}
    { name: "geometry_type", type: "TEXT", nullable: false },
    { name: "coordinates", type: "TEXT", nullable: false },
    { name: "geom_geojson", type: "TEXT", nullable: true }, // Full GeoJSON for ST_GeomFromGeoJSON
    { name: "geom", type: "GEOMETRY", nullable: true }, // Native geometry for spatial queries
  ],
};

/**
 * Complete schema for traffic incidents tool
 */
export const TRAFFIC_INCIDENTS_SCHEMA: TableDefinition[] = [INCIDENTS_TABLE];

/**
 * SQL query examples for traffic incidents tool documentation
 *
 * iconCategory and magnitudeOfDelay are pre-translated to human-readable names
 * by the flattener layer (see mappings.ts).
 */
export const TRAFFIC_INCIDENTS_SQL_EXAMPLES = `
Available table: incidents
Columns: area_name (for multi-bbox queries), id, iconCategory, magnitudeOfDelay, startTime, endTime, "from", "to", length, delay, roadNumbers, timeValidity, probabilityOfOccurrence, numberOfReports, lastReportTime, events (JSON array — use ->> for text, -> / json_extract for JSON), geometry_type, coordinates

Example queries:
1. Default (accidents + roadworks):
   SELECT id, iconCategory, delay, magnitudeOfDelay FROM incidents WHERE iconCategory IN ('Accident', 'RoadWorks')

2. **MULTI-AREA COMPARISON** - Incidents by area:
   SELECT area_name, COUNT(*) as total_incidents, SUM(CASE WHEN iconCategory = 'Accident' THEN 1 ELSE 0 END) as accidents FROM incidents GROUP BY area_name

3. **MULTI-AREA COMPARISON** - Average delay by area:
   SELECT area_name, ROUND(AVG(delay), 2) as avg_delay_sec, COUNT(*) as incidents_with_delay FROM incidents WHERE delay IS NOT NULL GROUP BY area_name ORDER BY avg_delay_sec DESC

4. Major incidents only:
   SELECT id, iconCategory, delay FROM incidents WHERE magnitudeOfDelay IN ('Moderate', 'Major') ORDER BY delay DESC
`.trim();
