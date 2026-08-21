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

// JavaScript queries schema for filtering large responses
const jsQueriesSchema = z
  .record(z.string(), z.string())
  .refine((obj) => Object.keys(obj).length > 0, {
    message:
      'At least one JavaScript query is required. Provide queries like: {"slow_segments": "rows.filter(r => ...)"}',
  })
  .describe(
    'Named JavaScript queries over the datasets this tool loads, e.g. {"my_query": "dataset_name.filter(r => r.value > 0).length"}. Contract in the server instructions.'
  );

// Schema for getting detailed route information - requires route IDs array
export const getRouteDetailsSchema = {
  routeIds: z
    .array(z.coerce.string())
    .min(1)
    .max(20)
    .describe("Up to 20 IDs; data merged for cross-route queries"),
  js_queries: jsQueriesSchema,
};

// JavaScript queries schema for route search
const routeSearchJsQueriesSchema = z
  .record(z.string(), z.string())
  .refine((obj) => Object.keys(obj).length > 0, {
    message:
      'At least one JavaScript query is required. Provide queries like: {"delayed_routes": "rows.filter(r => ...)"}',
  })
  .describe(
    'Named JavaScript queries over the datasets this tool loads, e.g. {"my_query": "dataset_name.filter(r => r.value > 0).length"}. Contract in the server instructions.'
  );

// Route search schema
export const routeSearchSchema = {
  js_queries: routeSearchJsQueriesSchema,
};

// Combined schemas export
export const routeMonitoringSchemas = {
  getRouteDetails: getRouteDetailsSchema,
  routeSearch: routeSearchSchema,
};
