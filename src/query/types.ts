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
 * Result of flattening a TomTom API response into named datasets.
 *
 * The field is still called `tables` so the flatteners did not have to change
 * when the SQL engine was replaced; each entry is simply an array of plain
 * objects that user code sees as a JavaScript array.
 */
export interface FlattenResult {
  tables: Map<string, Record<string, unknown>[]>;
}

/** Shape metadata returned to the caller so a failed query can self-correct. */
export interface DatasetShape {
  rows: number;
  fields: string[];
}

export interface JsQuerySuccessResult {
  value: unknown;
  /** Length of the returned array, before truncation. Absent for non-arrays. */
  rowCount?: number;
  truncated?: boolean;
  truncationMessage?: string;
}

export interface JsQueryErrorResult {
  error: string;
}

export type JsQueryExecutionResult = JsQuerySuccessResult | JsQueryErrorResult;

export interface JsFilteredResponse {
  metadata: {
    tool: string;
    parameters: Record<string, unknown>;
    dataset_shapes: Record<string, DatasetShape>;
    queries_executed: number;
    warnings?: string[];
  };
  aggregated_data: Record<string, JsQueryExecutionResult>;
}

export const JS_QUERY_DEFAULTS = {
  QUERY_TIMEOUT_MS: 5000,
  MAX_ROWS_SOFT_LIMIT: 100000,
  MAX_RESULT_ROWS: 10000,
  /** Cap on the JSON returned by a single query, to protect the context window. */
  MAX_RESULT_BYTES: 1_000_000,
  MEMORY_LIMIT_BYTES: 512 * 1024 * 1024,
  /**
   * Deliberately small. QuickJS only raises its own "stack overflow" once this
   * limit is hit, and anything above ~256KB lets guest recursion exhaust the
   * host's WASM stack first — which surfaces as an uncatchable RangeError that
   * takes the server process down. Measured: 256KB traps cleanly, 384KB and up
   * (including the library default) crash the host. The cost is a guest
   * recursion depth of roughly 1,500 frames, which is far more than the
   * reduce/map/filter pipelines these queries are made of.
   */
  MAX_STACK_SIZE_BYTES: 256 * 1024,
  /**
   * Sandbox reuse across requests. OFF by default, and deliberately so: a
   * reused sandbox is a weaker isolation guarantee than a fresh one, and the
   * saving is small next to the TomTom call it sits behind. See ENGINE_REUSE
   * in jsQueryEngine.ts for what reuse does and does not protect.
   */
  REUSE_ENABLED_ENV: "TOMTOM_MCP_SANDBOX_REUSE",
  /** Most sandboxes kept alive at once. Each holds its own WASM heap. */
  REUSE_MAX_SANDBOXES: 2,
  /** How long an idle sandbox may be reused before it is disposed. */
  REUSE_TTL_MS: 5 * 60 * 1000,
} as const;

/** Type guard to check if a query result contains an error */
export function isQueryError(result: JsQueryExecutionResult): result is JsQueryErrorResult {
  return "error" in result;
}
