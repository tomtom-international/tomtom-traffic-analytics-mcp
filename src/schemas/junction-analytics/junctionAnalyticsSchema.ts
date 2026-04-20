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

// Junction definition list schema
export const junctionDefinitionListSchema = {
  page: z.number().min(0).optional().default(0).describe("Page number for pagination (0-based)"),
  size: z.number().min(1).max(1000).optional().describe("Number of results per page (max 1000)"),
  includeGeometry: z
    .boolean()
    .optional()
    .describe("Whether to include junction geometry in the response"),
};

// SQL queries schema for filtering live data responses
const liveDataSqlQueriesSchema = z
  .record(z.string(), z.string())
  .refine((obj) => Object.keys(obj).length > 0, {
    message: 'At least one SQL query is required. Provide queries like: {"delays": "SELECT ..."}',
  })
  .describe(
    `REQUIRED: SQL queries to filter/aggregate the live data. Keys are output names, values are SQL queries.`
  );

// Junction live data details schema - requires junction IDs array
export const junctionLiveDataDetailsSchema = {
  junctionIds: z
    .array(z.string())
    .min(1)
    .max(20)
    .describe("Junction IDs to query. Max 20. Data is merged for cross-junction SQL comparisons."),
  includeGeometry: z
    .boolean()
    .optional()
    .describe(
      "Whether to include junction geometry in the response. Set to true to populate junction_metadata, approach_metadata, and exit_metadata tables."
    ),
  sql_queries: liveDataSqlQueriesSchema,
};

// SQL queries schema for filtering large responses
const sqlQueriesSchema = z
  .record(z.string(), z.string())
  .refine((obj) => Object.keys(obj).length > 0, {
    message:
      'At least one SQL query is required. Provide queries like: {"hourly_avg": "SELECT ..."}',
  })
  .describe(
    `REQUIRED: SQL queries to filter/aggregate the archive data. Keys are output names, values are SQL queries.`
  );

// Junction archive schema - requires junction IDs array
export const junctionArchiveSchema = {
  junctionIds: z
    .array(z.string())
    .min(1)
    .max(20)
    .describe("Junction IDs to query. Max 20. Data is merged for cross-junction SQL comparisons."),
  from: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .describe("Start date in YYYY-MM-DD format"),
  to: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional()
    .describe(
      "End date in YYYY-MM-DD format (optional). Note: API is limited to a maximum range of 2 days"
    ),
  sql_queries: sqlQueriesSchema,
};

// SQL queries schema for junction search
const junctionSearchSqlQueriesSchema = z
  .record(z.string(), z.string())
  .refine((obj) => Object.keys(obj).length > 0, {
    message:
      'At least one SQL query is required. Provide queries like: {"active_junctions": "SELECT ..."}',
  })
  .describe(
    `REQUIRED: SQL queries to filter/aggregate junction definitions. Keys are output names, values are SQL queries.`
  );

// Junction search schema
export const junctionSearchSchema = {
  view: z
    .enum(["compact", "full"])
    .optional()
    .default("compact")
    .describe(
      "Table detail level. 'compact' (default): junctions table only. 'full': adds approaches and exits tables for structural search."
    ),
  sql_queries: junctionSearchSqlQueriesSchema,
};

// Combined schemas export
export const JunctionArchiveSchemas = {
  junctionSearchSchema,
  junctionLiveDataDetailsSchema,
  junctionArchiveSchema,
};
