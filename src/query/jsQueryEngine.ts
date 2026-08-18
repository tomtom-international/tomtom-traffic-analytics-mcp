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

import variant from "@jitl/quickjs-singlefile-cjs-release-sync";
import {
  newQuickJSWASMModuleFromVariant,
  type QuickJSContext,
  type QuickJSRuntime,
  type QuickJSWASMModule,
} from "quickjs-emscripten-core";
import { logger } from "../utils/logger";
import {
  type DatasetShape,
  type FlattenResult,
  JS_QUERY_DEFAULTS,
  type JsQueryExecutionResult,
  type JsQuerySuccessResult,
} from "./types";
import { H3_BUNDLE_BASE64 } from "./vendor/h3Bundle";
import { TURF_BUNDLE_BASE64 } from "./vendor/turfBundle";

/**
 * The WASM module is compiled once per process and shared by every engine
 * instance; only runtimes and contexts are per-request.
 */
let wasmModulePromise: Promise<QuickJSWASMModule> | null = null;

function getWasmModule(): Promise<QuickJSWASMModule> {
  if (!wasmModulePromise) {
    wasmModulePromise = newQuickJSWASMModuleFromVariant(variant);
  }
  return wasmModulePromise;
}

/** Reset the cached module. Test-only seam. */
export function resetWasmModuleForTests(): void {
  wasmModulePromise = null;
}

const VALID_IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

/**
 * Runs inside the sandbox before any user code.
 *
 * `console` exists only because the emscripten runtime inside the h3 bundle
 * calls console.warn during start-up; it deliberately discards everything so
 * user code cannot use it as a side channel.
 */
const PRELUDE = `
globalThis.console = { log(){}, warn(){}, error(){}, info(){}, debug(){}, trace(){} };
globalThis.__run = function (fn, maxRows, maxBytes) {
  var out = fn();
  if (out === undefined) out = null;
  var rowCount;
  var truncated = false;
  if (Array.isArray(out)) {
    rowCount = out.length;
    if (rowCount > maxRows) { out = out.slice(0, maxRows); truncated = true; }
    var json = JSON.stringify(out);
    if (json === undefined) {
      throw new TypeError("Query returned a value that cannot be serialised to JSON.");
    }
    if (json.length > maxBytes) {
      var lo = 0, hi = out.length;
      while (lo < hi) {
        var mid = (lo + hi + 1) >> 1;
        if (JSON.stringify(out.slice(0, mid)).length <= maxBytes) { lo = mid; } else { hi = mid - 1; }
      }
      out = out.slice(0, lo);
      truncated = true;
    }
  } else {
    var single = JSON.stringify(out);
    if (single === undefined) {
      throw new TypeError(
        "Query returned a value that cannot be serialised to JSON (a function, a symbol, or undefined)."
      );
    }
    if (single.length > maxBytes) {
      throw new RangeError(
        "Query result is " + single.length + " bytes, over the " + maxBytes +
        " byte cap. Aggregate the data or return fewer fields."
      );
    }
  }
  var payload = { value: out };
  if (rowCount !== undefined) payload.rowCount = rowCount;
  if (truncated) {
    payload.truncated = true;
    payload.truncationMessage =
      "Results truncated to " + out.length + " of " + rowCount +
      " rows. Aggregate (reduce/group) or slice() for complete results.";
  }
  return JSON.stringify(payload);
};
`;

/**
 * JS Query Engine — sandboxed JavaScript execution for MCP response filtering.
 *
 * Replaces the DuckDB SQL engine. Flattened API responses are exposed to
 * caller-supplied JavaScript running inside a QuickJS WASM sandbox, with turf
 * and h3 injected on demand for geospatial work.
 *
 * The security model is deny-by-default: the sandbox is a separate WASM heap
 * with no host bindings at all. There is no filesystem, no network, no
 * process, no require/import and no timers — not because they are blocked,
 * but because nothing is ever bridged into the guest. The only values crossing
 * the boundary are the dataset JSON going in and a JSON string coming out.
 * Runaway code is bounded by an interrupt handler (wall-clock deadline), a
 * heap cap and a stack cap.
 */
export class JsQueryEngine {
  private runtime: QuickJSRuntime | null = null;
  private context: QuickJSContext | null = null;
  private shapes: Record<string, DatasetShape> = {};
  private datasetNames: string[] = [];
  private librariesLoaded = new Set<string>();

  /**
   * Create the sandbox and load the flattened datasets into it.
   */
  async initialize(data: FlattenResult): Promise<string[]> {
    const warnings: string[] = [];
    const startTime = Date.now();

    const wasmModule = await getWasmModule();
    this.runtime = wasmModule.newRuntime();
    this.runtime.setMemoryLimit(JS_QUERY_DEFAULTS.MEMORY_LIMIT_BYTES);
    this.runtime.setMaxStackSize(JS_QUERY_DEFAULTS.MAX_STACK_SIZE_BYTES);
    this.context = this.runtime.newContext();

    logger.debug(`QuickJS sandbox created in ${Date.now() - startTime}ms`);

    this.evalOrThrow(PRELUDE, "sandbox prelude");

    // Describe the data host-side: the shapes are cheap to compute here and are
    // returned in the response so a model that guessed a field name wrong can
    // fix it without another API round-trip.
    let totalRows = 0;
    const datasets: Record<string, Record<string, unknown>[]> = {};
    for (const [name, rows] of data.tables) {
      datasets[name] = rows;
      totalRows += rows.length;
      this.shapes[name] = { rows: rows.length, fields: collectFields(rows) };
      logger.debug(`Loaded dataset ${name} with ${rows.length} rows`);
    }
    this.datasetNames = Object.keys(datasets);

    this.injectDatasets(datasets);

    if (totalRows > JS_QUERY_DEFAULTS.MAX_ROWS_SOFT_LIMIT) {
      const warning = `Large dataset warning: ${totalRows} total rows exceeds soft limit of ${JS_QUERY_DEFAULTS.MAX_ROWS_SOFT_LIMIT}. Query performance may be affected.`;
      warnings.push(warning);
      logger.warn(warning);
    }

    return warnings;
  }

  /**
   * Serialise the datasets once and parse them inside the sandbox.
   *
   * Marshalling is the dominant cost of a sandboxed query (a single ~14 MB
   * payload takes roughly 400ms), so it happens exactly once per engine and
   * every query then runs against the already-parsed object graph.
   */
  private injectDatasets(datasets: Record<string, Record<string, unknown>[]>): void {
    const context = this.requireContext();
    const startTime = Date.now();
    const json = JSON.stringify(datasets);

    const handle = context.newString(json);
    try {
      context.setProp(context.global, "__datasets_json", handle);
    } finally {
      handle.dispose();
    }

    this.evalOrThrow(
      "globalThis.__datasets = JSON.parse(globalThis.__datasets_json);" +
        "delete globalThis.__datasets_json;",
      "dataset injection"
    );

    logger.debug(
      `Marshalled ${(json.length / 1024).toFixed(0)} KB into the sandbox in ${Date.now() - startTime}ms`
    );
  }

  /**
   * Inject a geospatial library, once, only if the queries reference it.
   *
   * Each bundle costs ~70-100ms to evaluate, which is worth avoiding for the
   * majority of queries that are purely tabular.
   */
  private loadLibrary(name: "turf" | "h3"): void {
    if (this.librariesLoaded.has(name)) return;
    const startTime = Date.now();
    const base64 = name === "turf" ? TURF_BUNDLE_BASE64 : H3_BUNDLE_BASE64;
    this.evalOrThrow(Buffer.from(base64, "base64").toString("utf8"), `${name} bundle`);
    this.librariesLoaded.add(name);
    logger.debug(`Injected ${name} into the sandbox in ${Date.now() - startTime}ms`);
  }

  /**
   * Execute named queries and return their results, keyed by query name.
   *
   * A query that throws, times out or blows the result cap fails on its own —
   * the others still run, matching the behaviour callers relied on before.
   */
  async executeQueries(
    queries: Record<string, string>
  ): Promise<Record<string, JsQueryExecutionResult>> {
    const sources = Object.values(queries).join("\n");
    if (/\bturf\s*\./.test(sources)) this.loadLibrary("turf");
    if (/\bh3\s*\./.test(sources)) this.loadLibrary("h3");

    const results: Record<string, JsQueryExecutionResult> = {};
    for (const [name, source] of Object.entries(queries)) {
      try {
        results[name] = this.executeQuery(source);
      } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        results[name] = { error: errorMessage };
        logger.warn(`Query "${name}" failed: ${errorMessage}`);
      }
    }
    return results;
  }

  private executeQuery(source: string): JsQuerySuccessResult {
    const context = this.requireContext();
    const runtime = this.requireRuntime();

    const deadline = Date.now() + JS_QUERY_DEFAULTS.QUERY_TIMEOUT_MS;
    let interrupted = false;
    runtime.setInterruptHandler(() => {
      if (Date.now() > deadline) {
        interrupted = true;
        return true;
      }
      return false;
    });

    try {
      this.compileQuery(source);

      const result = context.evalCode(
        `__run(__query, ${JS_QUERY_DEFAULTS.MAX_RESULT_ROWS}, ${JS_QUERY_DEFAULTS.MAX_RESULT_BYTES})`
      );
      if (result.error) {
        const detail = describeError(context, result.error);
        result.error.dispose();
        if (interrupted) {
          throw new Error(
            `Query timed out after ${JS_QUERY_DEFAULTS.QUERY_TIMEOUT_MS}ms. Simplify the query or filter the data first.`
          );
        }
        throw new Error(detail);
      }
      const json = context.getString(result.value);
      result.value.dispose();
      return JSON.parse(json) as JsQuerySuccessResult;
    } finally {
      runtime.removeInterruptHandler();
    }
  }

  /**
   * Compile the query into `__query` inside the sandbox, without running it.
   *
   * A query is usually a bare expression, but may be a statement block ending
   * in `return`. Rather than guessing which from the source text — a `return`
   * inside a string literal is enough to fool any regex — both forms are
   * offered to the parser and the one that compiles wins. Defining a function
   * only compiles its body, so the fallback costs a parse, never an execution.
   */
  private compileQuery(source: string): void {
    const context = this.requireContext();

    const asExpression = context.evalCode(buildWrapper(source, this.datasetNames, "expression"));
    if (!asExpression.error) {
      asExpression.value.dispose();
      return;
    }
    const expressionError = describeError(context, asExpression.error);
    asExpression.error.dispose();

    const asStatements = context.evalCode(buildWrapper(source, this.datasetNames, "statements"));
    if (!asStatements.error) {
      asStatements.value.dispose();
      return;
    }
    const statementsError = describeError(context, asStatements.error);
    asStatements.error.dispose();

    // Neither parse worked, so the source is simply invalid. The expression
    // error is usually the more helpful of the two for a one-line query.
    throw new Error(
      statementsError === expressionError
        ? expressionError
        : `${expressionError} (also invalid as a statement block: ${statementsError})`
    );
  }

  /** Row counts and field names per dataset, for response metadata. */
  getDatasetShapes(): Record<string, DatasetShape> {
    return this.shapes;
  }

  /**
   * Tear down the sandbox. Always call this when done to free the WASM heap.
   */
  close(): void {
    if (this.context) {
      this.context.dispose();
      this.context = null;
    }
    if (this.runtime) {
      this.runtime.dispose();
      this.runtime = null;
    }
    logger.debug("QuickJS sandbox disposed");
  }

  private evalOrThrow(code: string, what: string): void {
    const context = this.requireContext();
    const result = context.evalCode(code);
    if (result.error) {
      const detail = describeError(context, result.error);
      result.error.dispose();
      throw new Error(`Failed to initialise ${what}: ${detail}`);
    }
    result.value.dispose();
  }

  private requireContext(): QuickJSContext {
    if (!this.context) {
      throw new Error("Sandbox not initialized. Call initialize() first.");
    }
    return this.context;
  }

  private requireRuntime(): QuickJSRuntime {
    if (!this.runtime) {
      throw new Error("Sandbox not initialized. Call initialize() first.");
    }
    return this.runtime;
  }
}

/**
 * Union of the keys present across the rows of a dataset.
 *
 * Sampling only the first row would hide fields that are absent from it, so a
 * bounded scan is used instead — enough to describe real-world sparse rows
 * without walking a 50k-row array.
 */
function collectFields(rows: Record<string, unknown>[]): string[] {
  const fields = new Set<string>();
  for (const row of rows.slice(0, 50)) {
    for (const key of Object.keys(row)) fields.add(key);
  }
  return [...fields];
}

/**
 * Build the function definition the sandbox compiles for a query.
 *
 * Datasets are destructured into local consts so a query reads as
 * `incidents.filter(...)` rather than `data.incidents.filter(...)`; `data`
 * stays available for programmatic access. In "expression" mode the source is
 * the returned value; in "statements" mode it is the function body and has to
 * return for itself.
 */
export function buildWrapper(
  source: string,
  datasetNames: string[],
  mode: "expression" | "statements"
): string {
  const bindable = datasetNames.filter((name) => VALID_IDENTIFIER.test(name) && name !== "data");
  const destructure = bindable.length > 0 ? `const { ${bindable.join(", ")} } = __datasets;\n` : "";
  const body = mode === "expression" ? `return (\n${source}\n);` : source;

  return `globalThis.__query = function () {
"use strict";
const data = __datasets;
${destructure}${body}
};`;
}

/** Turn a sandbox error handle into a single-line message for the caller. */
function describeError(context: QuickJSContext, handle: unknown): string {
  try {
    const dumped = context.dump(handle as never) as
      | { name?: string; message?: string }
      | string
      | undefined;
    if (typeof dumped === "string") return dumped;
    if (dumped?.message) {
      return dumped.name ? `${dumped.name}: ${dumped.message}` : dumped.message;
    }
    return JSON.stringify(dumped);
  } catch {
    return "Unknown sandbox error";
  }
}
