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

/**
 * SQL column data types supported by the filtering engine
 *
 * DuckDB type mapping:
 * - TEXT → VARCHAR
 * - REAL → DOUBLE
 * - INTEGER → INTEGER
 * - BIGINT → BIGINT (for large 64-bit IDs from TomTom API)
 * - GEOMETRY → GEOMETRY (requires spatial extension)
 */
export type SqlColumnType = "TEXT" | "REAL" | "INTEGER" | "BIGINT" | "GEOMETRY";

/**
 * Definition of a single column in a SQL table
 */
export interface ColumnDefinition {
  name: string;
  type: SqlColumnType;
  nullable?: boolean;
}

/**
 * Definition of a SQL table schema
 */
export interface TableDefinition {
  name: string;
  columns: ColumnDefinition[];
}

/**
 * Result of flattening nested JSON into relational tables
 */
export interface FlattenResult {
  tables: Map<string, Record<string, unknown>[]>;
}

/**
 * Result of executing a single SQL query
 */
export interface SqlQueryResult {
  columns: string[];
  rows: unknown[][];
  rowCount: number;
  truncated?: boolean;
  truncationMessage?: string;
}

/**
 * Result of executing a SQL query that encountered an error
 */
export interface SqlQueryErrorResult extends SqlQueryResult {
  error: string;
}

/**
 * Combined result type for query execution
 */
export type SqlQueryExecutionResult = SqlQueryResult | SqlQueryErrorResult;

/**
 * Metadata about the SQL filtering operation
 */
export interface SqlFilterMetadata {
  tool: string;
  parameters: Record<string, unknown>;
  raw_row_counts: Record<string, number>;
  queries_executed: number;
  warnings?: string[];
}

/**
 * Complete response format for tools with SQL filtering
 */
export interface SqlFilteredResponse {
  metadata: SqlFilterMetadata;
  aggregated_data: Record<string, SqlQueryExecutionResult>;
}

/**
 * Configuration options for the SQL filter engine
 */
export interface SqlFilterEngineOptions {
  queryTimeoutMs?: number;
  maxRows?: number;
  maxResultRows?: number;
}

/**
 * Default configuration values
 */
export const SQL_FILTER_DEFAULTS = {
  QUERY_TIMEOUT_MS: 5000,
  MAX_ROWS_SOFT_LIMIT: 100000,
  MAX_RESULT_ROWS: 10000,
} as const;

/**
 * Type guard to check if a query result contains an error
 */
export function isQueryError(result: SqlQueryExecutionResult): result is SqlQueryErrorResult {
  return "error" in result;
}
