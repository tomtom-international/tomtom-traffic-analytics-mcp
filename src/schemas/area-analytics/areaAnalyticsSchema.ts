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
const hourSchema = z.number().int().min(0).max(23).describe("Hour of day (0-23)");

// Date string validation (YYYY-MM-DD)
const dateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .describe("Date in YYYY-MM-DD format");

// GeoJSON Polygon geometry
const polygonGeometrySchema = z.object({
  type: z.literal("Polygon"),
  coordinates: z
    .array(z.array(z.array(z.number()).length(2)))
    .describe("Polygon coordinates array"),
});

// GeoJSON MultiPolygon geometry
const multiPolygonGeometrySchema = z.object({
  type: z.literal("MultiPolygon"),
  coordinates: z
    .array(z.array(z.array(z.array(z.number()).length(2))))
    .describe("MultiPolygon coordinates array"),
});

// GeoJSON Feature
const geoJSONFeatureSchema = z
  .object({
    type: z.literal("Feature"),
    geometry: z
      .union([polygonGeometrySchema, multiPolygonGeometrySchema])
      .describe("GeoJSON geometry - Polygon or MultiPolygon"),
    properties: z
      .object({
        name: z.string().optional().describe("Optional name for the region"),
        timezone: z
          .string()
          .optional()
          .describe("Optional timezone for the region (e.g., 'Europe/Amsterdam')"),
      })
      .optional()
      .describe("Feature properties"),
  })
  .describe("GeoJSON Feature defining the analysis region");

// SQL queries schema for filtering large responses
const sqlQueriesSchema = z
  .record(z.string(), z.string())
  .refine((obj) => Object.keys(obj).length > 0, {
    message:
      'At least one SQL query is required. Provide queries like: {"daily_avg": "SELECT ..."}',
  })
  .describe(
    `REQUIRED: SQL queries to filter/aggregate the report results. Keys are output names, values are SQL queries.`
  );

// Stats schema (lite version with restrictions)
export const areaAnalyticsStatsSchema = {
  name: z.string().min(1).max(250).describe("Name for the analysis report"),
  startDate: dateSchema.describe("Analysis start date in YYYY-MM-DD format"),
  endDate: dateSchema.describe(
    "Analysis end date in YYYY-MM-DD format (must be within 31 days from startDate and at least 2 days before today)"
  ),
  hours: z.array(hourSchema).min(1).max(24).describe("Array of hours to analyze (0-23)"),
  frcs: z
    .array(frcSchema)
    .min(1)
    .max(9)
    .describe("Array of functional road classes to include (0-8)"),
  dataTypes: z
    .array(dataTypeSchema)
    .min(1)
    .max(5)
    .describe("Array of traffic data types to analyze (one or more)"),
  features: z
    .array(geoJSONFeatureSchema)
    .length(1)
    .describe("Array containing exactly one GeoJSON feature defining analysis region"),
  sql_queries: sqlQueriesSchema,
};
