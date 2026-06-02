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

import { z } from "zod";

/**
 * Schema definitions for Live Traffic APIs
 * - Traffic Flow Segment Data
 * - Traffic Incidents
 */

// ============================================================================
// SQL queries schema for filtering large responses
// ============================================================================

// SQL queries schema for Traffic Flow Segment
const flowSegmentSqlQueriesSchema = z
  .record(z.string(), z.string())
  .refine((obj) => Object.keys(obj).length > 0, {
    message:
      'At least one SQL query is required. Provide queries like: {"segment_info": "SELECT ..."}',
  })
  .describe(
    "SQL queries to run against the loaded tables. Object mapping named keys to DuckDB SELECT strings, e.g. {\"my_query\": \"SELECT ... FROM table_name\"}."
  );

// Named bbox schema for multi-area comparison
const namedBboxSchema = z.object({
  name: z
    .string()
    .min(1)
    .describe("Area name for identification in SQL queries (e.g., 'Downtown', 'Airport')"),
  bbox: z
    .string()
    .regex(/^-?\d+\.?\d*,-?\d+\.?\d*,-?\d+\.?\d*,-?\d+\.?\d*$/)
    .describe("Bounding box: minLon,minLat,maxLon,maxLat (e.g., '-122.42,37.77,-122.40,37.79')"),
});

// SQL queries schema for Traffic Incidents
const incidentsSqlQueriesSchema = z
  .record(z.string(), z.string())
  .refine((obj) => Object.keys(obj).length > 0, {
    message:
      'At least one SQL query is required. Provide queries like: {"accidents": "SELECT ..."}',
  })
  .describe(
    "SQL queries to run against the loaded tables. Object mapping named keys to DuckDB SELECT strings, e.g. {\"my_query\": \"SELECT ... FROM table_name\"}."
  );

// ============================================================================
// Traffic Flow Segment Data Schema
// ============================================================================

const pointSchema = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
});

export const trafficFlowDataSchema = {
  point: pointSchema,
  style: z
    .enum([
      "absolute",
      "relative",
      "relative0",
      "relative0-dark",
      "relative-delay",
      "reduced-sensitivity",
    ])
    .describe("'absolute' = actual speeds; 'relative' = speed relative to free-flow"),
  zoom: z.number().int().min(0).max(22).describe("Zoom 0-22; affects coordinate precision"),
  format: z.enum(["xml", "json", "jsonp"]).optional().default("json"),
  unit: z.enum(["kmph", "mph"]).optional().default("kmph"),
  thickness: z.number().int().min(1).max(20).optional().default(10),
  openLr: z.boolean().optional().default(false).describe("Include OpenLR code in response"),
  sql_queries: flowSegmentSqlQueriesSchema,
};

// ============================================================================
// Traffic Incidents Schema
// ============================================================================

// Traffic incidents schema - requires named bounding boxes array
export const trafficIncidentsSchema = {
  bboxes: z
    .array(namedBboxSchema)
    .min(1)
    .max(10)
    .describe(
      "Named bounding boxes for the query. Max 10. Example: [{name: 'Downtown', bbox: '-122.42,37.77,-122.40,37.79'}]"
    ),

  language: z
    .string()
    .optional()
    .describe(
      "Language for incident descriptions: 'en-US', 'de-DE', 'fr-FR', 'es-ES'. Default: 'en-US'."
    ),

  maxResults: z
    .number()
    .min(1)
    .max(1000)
    .optional()
    .describe(
      "Maximum incidents to return per area (1-1000). Use 10-20 for readability in high-traffic areas."
    ),

  categoryFilter: z
    .string()
    .optional()
    .describe(
      "Comma-separated category codes: 0=Accident, 1=Fog, 2=Dangerous, 3=Rain, 4=Ice, 5=JamLane, 6=LaneClosure, 7=RoadClosure, 8=RoadWorks, 9=Wind, 10=Flooding, 11=Detour, 14=Cluster"
    ),

  timeValidityFilter: z
    .enum(["present", "future"])
    .optional()
    .describe(
      "Time validity filter: 'present' (current), 'future' (upcoming). Default: 'present'."
    ),

  sql_queries: incidentsSqlQueriesSchema,
};

// ============================================================================
// Export all schemas
// ============================================================================

export const liveTrafficSchemas = {
  TrafficFlowSegmentData: trafficFlowDataSchema,
  TrafficIncidents: trafficIncidentsSchema,
};
