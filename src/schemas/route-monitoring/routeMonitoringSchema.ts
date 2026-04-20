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

// SQL queries schema for filtering large responses
const sqlQueriesSchema = z
  .record(z.string(), z.string())
  .refine((obj) => Object.keys(obj).length > 0, {
    message:
      'At least one SQL query is required. Provide queries like: {"slow_segments": "SELECT ..."}',
  })
  .describe(
    `REQUIRED: SQL queries to filter/aggregate the route details. Keys are output names, values are SQL queries.`
  );

// Schema for getting detailed route information - requires route IDs array
export const getRouteDetailsSchema = {
  routeIds: z
    .array(z.coerce.string())
    .min(1)
    .max(20)
    .describe("Route IDs to query. Max 20. Data is merged for cross-route SQL comparisons."),
  sql_queries: sqlQueriesSchema,
};

// SQL queries schema for route search
const routeSearchSqlQueriesSchema = z
  .record(z.string(), z.string())
  .refine((obj) => Object.keys(obj).length > 0, {
    message:
      'At least one SQL query is required. Provide queries like: {"delayed_routes": "SELECT ..."}',
  })
  .describe(
    `REQUIRED: SQL queries to filter/aggregate route list. Keys are output names, values are SQL queries.`
  );

// Route search schema
export const routeSearchSchema = {
  sql_queries: routeSearchSqlQueriesSchema,
};

// Combined schemas export
export const routeMonitoringSchemas = {
  getRouteDetails: getRouteDetailsSchema,
  routeSearch: routeSearchSchema,
};
