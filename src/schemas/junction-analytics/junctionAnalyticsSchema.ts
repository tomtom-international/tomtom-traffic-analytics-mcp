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
  page: z.number().min(0).optional().default(0),
  size: z.number().min(1).max(1000).optional(),
  includeGeometry: z.boolean().optional(),
};

// SQL queries schema for filtering live data responses
const liveDataSqlQueriesSchema = z
  .record(z.string(), z.string())
  .refine((obj) => Object.keys(obj).length > 0, {
    message: 'At least one SQL query is required. Provide queries like: {"delays": "SELECT ..."}',
  })
  .describe(
    'SQL queries to run against the loaded tables. Object mapping named keys to DuckDB SELECT strings, e.g. {"my_query": "SELECT ... FROM table_name"}.'
  );

// Junction live data details schema - requires junction IDs array
export const junctionLiveDataDetailsSchema = {
  junctionIds: z
    .array(z.string())
    .min(1)
    .max(20)
    .describe("Up to 20 IDs; data merged for cross-junction SQL"),
  includeGeometry: z
    .boolean()
    .optional()
    .describe("Set true to populate junction_metadata, approach_metadata, exit_metadata tables"),
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
    'SQL queries to run against the loaded tables. Object mapping named keys to DuckDB SELECT strings, e.g. {"my_query": "SELECT ... FROM table_name"}.'
  );

// Junction archive schema - requires junction IDs array
export const junctionArchiveSchema = {
  junctionIds: z
    .array(z.string())
    .min(1)
    .max(20)
    .describe("Up to 20 IDs; data merged for cross-junction SQL"),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  to: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional()
    .describe("Optional end date; API limited to a 2-day range"),
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
    'SQL queries to run against the loaded tables. Object mapping named keys to DuckDB SELECT strings, e.g. {"my_query": "SELECT ... FROM table_name"}.'
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
