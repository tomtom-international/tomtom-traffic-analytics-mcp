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

// Data types schema
const dataTypeSchema = z
  .enum(["NETWORK_LENGTH", "CONGESTION_LEVEL", "FREE_FLOW_SPEED", "TRAVEL_TIME", "SPEED"])
  .describe("Traffic data types to analyze");

// Functional Road Classes (0-8)
const frcSchema = z
  .number()
  .int()
  .min(0)
  .max(8)
  .describe(
    "Functional road class (0-8): 0=Motorway, 1=Major, 2=OtherMajor, 3=Secondary, 4=LocalConnecting, 5=LocalHigh, 6=Local, 7=LocalMinor, 8=Other"
  );

// Hours (0-23)
const hourSchema = z.number().int().min(0).max(23);

// Date string validation (YYYY-MM-DD)
const dateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .describe("Date in YYYY-MM-DD format");

// GeoJSON Polygon geometry
const polygonGeometrySchema = z.object({
  type: z.literal("Polygon"),
  coordinates: z.array(z.array(z.array(z.number()).length(2))),
});

// GeoJSON MultiPolygon geometry
const multiPolygonGeometrySchema = z.object({
  type: z.literal("MultiPolygon"),
  coordinates: z.array(z.array(z.array(z.array(z.number()).length(2)))),
});

// GeoJSON Feature
const geoJSONFeatureSchema = z.object({
  type: z.literal("Feature"),
  geometry: z.union([polygonGeometrySchema, multiPolygonGeometrySchema]),
  properties: z
    .object({
      name: z.string().optional(),
      timezone: z
        .string()
        .optional()
        .describe(
          "Optional IANA timezone for the region (e.g., 'Europe/Amsterdam'). If set, the API applies a stricter endDate constraint — endDate must be at least ONE FULL DAY older than the latest available day (i.e., effectively ≥ 3 days before today). For the widest date coverage leave this unset so the API uses UTC."
        ),
    })
    .optional(),
});

// SQL queries schema for filtering large responses
const sqlQueriesSchema = z
  .record(z.string(), z.string())
  .refine((obj) => Object.keys(obj).length > 0, {
    message:
      'At least one SQL query is required. Provide queries like: {"daily_avg": "SELECT ..."}',
  })
  .describe(
    'SQL queries to run against the loaded tables. Object mapping named keys to DuckDB SELECT strings, e.g. {"my_query": "SELECT ... FROM table_name"}.'
  );

// Stats schema (lite version with restrictions)
export const areaAnalyticsStatsSchema = {
  name: z.string().min(1).max(250),
  startDate: dateSchema,
  endDate: dateSchema.describe(
    "End date (must be within 31 days of startDate). Data has a 24–48h processing delay, so endDate must be ≥ 2 days before today in UTC. If `properties.timezone` is set on the feature, the API requires an EXTRA day of margin — endDate must be ≥ 3 days before today. To avoid 400 errors, leave the feature timezone unset (UTC default) for the broadest coverage."
  ),
  hours: z.array(hourSchema).min(1).max(24),
  frcs: z.array(frcSchema).min(1).max(9),
  dataTypes: z.array(dataTypeSchema).min(1).max(5),
  features: z
    .array(geoJSONFeatureSchema)
    .length(1)
    .describe("Array of exactly one GeoJSON feature defining the analysis region"),
  sql_queries: sqlQueriesSchema,
};
