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

/**
 * One coordinate. GeoJSON permits an optional third element for elevation, so
 * `[lon, lat, alt]` is valid input and must not be rejected — the previous
 * exact-length-2 rule turned conformant GeoJSON into `Invalid input at
 * features`, a message that tells the caller nothing it can act on.
 */
const coordinateSchema = z
  .array(z.number())
  .min(2, { message: "each position needs at least [longitude, latitude]" })
  .max(3, {
    message: "a position is [longitude, latitude] with an optional third elevation value",
  });

/**
 * A linear ring: at least four positions, first identical to last.
 *
 * Checked here rather than left to the API because "unclosed ring" is a fixable
 * mistake and the message says how to fix it. Compare the bare path-only error
 * the caller used to get.
 */
const linearRingSchema = z
  .array(coordinateSchema)
  .min(4, { message: "a polygon ring needs at least 4 positions, the last repeating the first" })
  .refine(
    (ring) => {
      const first = ring[0];
      const last = ring[ring.length - 1];
      return first?.[0] === last?.[0] && first?.[1] === last?.[1];
    },
    { message: "polygon ring is not closed — repeat the first position as the last" }
  );

// GeoJSON Polygon geometry
const polygonGeometrySchema = z.object({
  type: z.literal("Polygon"),
  coordinates: z
    .array(linearRingSchema)
    .min(1, { message: "Polygon coordinates are an array of rings: [[[lon,lat],...,[lon,lat]]]" }),
});

// GeoJSON MultiPolygon geometry
const multiPolygonGeometrySchema = z.object({
  type: z.literal("MultiPolygon"),
  coordinates: z.array(z.array(linearRingSchema)).min(1, {
    message: "MultiPolygon coordinates are an array of polygons, each an array of rings",
  }),
});

// GeoJSON Feature
const geoJSONFeatureSchema = z.object({
  type: z.literal("Feature"),
  // Discriminated on `type` rather than a plain union: a plain union reports a
  // generic "Invalid input" when both branches fail, which is what a Polygon
  // nested one level too shallow used to produce. Discriminating means the
  // Polygon branch's own message survives, and that message says what shape is
  // expected.
  geometry: z.discriminatedUnion("type", [polygonGeometrySchema, multiPolygonGeometrySchema]),
  properties: z
    .object({
      name: z.string().optional(),
      timezone: z
        .string()
        .optional()
        .describe(
          "Optional IANA timezone for the region (e.g., 'Europe/Amsterdam'). Setting it costs a day of date coverage; leave unset for UTC and the widest window."
        ),
    })
    .optional(),
});

// JavaScript queries schema for filtering large responses
const jsQueriesSchema = z
  .record(z.string(), z.string())
  .refine((obj) => Object.keys(obj).length > 0, {
    message:
      'At least one JavaScript query is required. Provide queries like: {"daily_avg": "rows.filter(r => ...)"}',
  })
  .describe(
    'Named JavaScript queries over the datasets this tool loads, e.g. {"my_query": "dataset_name.filter(r => r.value > 0).length"}. Contract in the server instructions.'
  );

// Stats schema (lite version with restrictions)
export const areaAnalyticsStatsSchema = {
  name: z.string().min(1).max(250),
  startDate: dateSchema,
  endDate: dateSchema.describe(
    // The processing-delay rule is enforced in the handler, which clamps the
    // window and reports it in metadata.warnings, so it no longer needs
    // explaining here — it did not work as prose.
    "End date, within 31 days of startDate. Clamped automatically if it falls inside the 24–48h processing delay."
  ),
  hours: z.array(hourSchema).min(1).max(24),
  frcs: z.array(frcSchema).min(1).max(9),
  dataTypes: z.array(dataTypeSchema).min(1).max(5),
  features: z
    .array(geoJSONFeatureSchema)
    .length(1)
    .describe(
      'Exactly one GeoJSON Feature defining the region, e.g. {"type":"Feature","properties":{},"geometry":{"type":"Polygon","coordinates":[[[4.85,52.35],[4.95,52.35],[4.95,52.40],[4.85,52.35]]]}} — note coordinates nest three deep and the ring closes.'
    ),
  js_queries: jsQueriesSchema,
};
