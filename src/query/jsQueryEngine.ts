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
import { createHash } from "node:crypto";
import { getEffectiveApiKey, getEffectiveMovePortalKey } from "../services/base/tomtomClient";
import { logger } from "../utils/logger";
import {
  type DatasetShape,
  type FlattenResult,
  JS_QUERY_DEFAULTS,
  type JsQueryExecutionResult,
  type JsQuerySuccessResult,
  type QueryExecutionOptions,
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

/**
 * Sandbox reuse.
 *
 * Marshalling is the dominant cost of a sandboxed query, and a follow-up
 * question about the same data pays it again for nothing — a query against an
 * already-loaded sandbox is roughly 4ms against ~75ms of setup. Reuse keeps a
 * loaded sandbox alive so the second request skips that work.
 *
 * It is OFF unless `TOMTOM_MCP_SANDBOX_REUSE=1`, for two honest reasons.
 *
 * The saving is smaller than it looks. The TomTom call in front of it is
 * 100-900ms and still happens on every request, because the pool is keyed by
 * the data itself rather than by the request — nothing here serves a stale
 * traffic reading. On a repeated junction-archive call it removes ~75ms from
 * ~1150ms. Its real value is server CPU under concurrency, not user latency.
 *
 * And a reused sandbox is a weaker guarantee than a fresh one. Entries are
 * keyed by the caller's credentials as well as the data, so nothing is ever
 * shared between tenants, and globals a query created are deleted before the
 * sandbox goes back in the pool. What is *not* undone is mutation of the
 * guest's own built-ins: a query that assigns to `Array.prototype` leaves that
 * behind for the next user of the same sandbox, who is the same tenant looking
 * at the same data. A fresh context is the only complete answer, and a fresh
 * context is what this trades away.
 */
interface PooledSandbox {
  runtime: QuickJSRuntime;
  context: QuickJSContext;
  shapes: Record<string, DatasetShape>;
  datasetNames: string[];
  datasets: Record<string, Record<string, unknown>[]>;
  injected: Set<string>;
  librariesLoaded: Set<string>;
  baselineGlobals: string[];
  warnings: string[];
  inUse: boolean;
  expiresAt: number;
}

const sandboxPool = new Map<string, PooledSandbox>();

/**
 * Contexts kept warm for their *libraries* rather than their data.
 *
 * turf costs ~98ms to evaluate and h3 ~46ms, and neither ever varies, while the
 * data varies on every request. Keeping a context whose prelude and bundles are
 * already evaluated and marshalling only the data takes a geospatial request
 * from ~237ms to ~68ms. That hits on nearly every such request, where
 * `sandboxPool` only hits on a repeated identical one.
 *
 * Keyed by credentials alone. It has to be: sharing one context between tenants
 * would let a query's mutation of a guest built-in reach another tenant, which
 * is a regression rather than a weaker guarantee. Within one tenant it is the
 * same trade `sandboxPool` already makes.
 */
const warmLibraryPool = new Map<string, PooledSandbox>();

function warmLibsEnabled(): boolean {
  const flag = process.env[JS_QUERY_DEFAULTS.WARM_LIBS_ENABLED_ENV];
  return flag === "1" || flag === "true";
}

/** Identity of the caller, with no data in it — the warm pool's key. */
function credentialFingerprint(): string {
  return createHash("sha1")
    .update(getEffectiveMovePortalKey() ?? "")
    .update("\u0000")
    .update(getEffectiveApiKey() ?? "")
    .digest("hex");
}

function reuseEnabled(): boolean {
  const flag = process.env[JS_QUERY_DEFAULTS.REUSE_ENABLED_ENV];
  return flag === "1" || flag === "true";
}

/**
 * Identity of a loaded sandbox: whose credentials it was loaded for, and
 * exactly which bytes it holds.
 *
 * The credential half keeps tenants apart in HTTP mode, where keys arrive per
 * request. The data half must be a full content hash — keying on row counts or
 * a sample would let changed data collide with a stale sandbox and answer from
 * the wrong numbers, which is far worse than the work it would save.
 */
function fingerprint(datasetJson: Record<string, string>): string {
  const hash = createHash("sha1");
  hash.update(getEffectiveMovePortalKey() ?? "");
  hash.update("\u0000");
  hash.update(getEffectiveApiKey() ?? "");
  for (const name of Object.keys(datasetJson).sort()) {
    hash.update("\u0000");
    hash.update(name);
    hash.update("\u0000");
    hash.update(datasetJson[name]);
  }
  return hash.digest("hex");
}

/** Drop expired entries, and the oldest idle ones once over the cap. */
function evictSandboxes(): void {
  const now = Date.now();
  for (const [key, entry] of sandboxPool) {
    if (!entry.inUse && entry.expiresAt <= now) {
      disposeSandbox(entry);
      sandboxPool.delete(key);
    }
  }
  while (sandboxPool.size > JS_QUERY_DEFAULTS.REUSE_MAX_SANDBOXES) {
    const victim = [...sandboxPool.entries()]
      .filter(([, entry]) => !entry.inUse)
      .sort((a, b) => a[1].expiresAt - b[1].expiresAt)[0];
    if (!victim) return;
    disposeSandbox(victim[1]);
    sandboxPool.delete(victim[0]);
  }
}

/** Same policy as evictSandboxes, over the warm pool's own caps. */
function evictWarmSandboxes(): void {
  const now = Date.now();
  for (const [key, entry] of warmLibraryPool) {
    if (!entry.inUse && entry.expiresAt <= now) {
      disposeSandbox(entry);
      warmLibraryPool.delete(key);
    }
  }
  while (warmLibraryPool.size > JS_QUERY_DEFAULTS.WARM_LIBS_MAX_SANDBOXES) {
    const victim = [...warmLibraryPool.entries()]
      .filter(([, entry]) => !entry.inUse)
      .sort((a, b) => a[1].expiresAt - b[1].expiresAt)[0];
    if (!victim) return;
    disposeSandbox(victim[1]);
    warmLibraryPool.delete(victim[0]);
  }
}

function disposeSandbox(entry: PooledSandbox): void {
  try {
    entry.context.dispose();
    entry.runtime.dispose();
  } catch (error) {
    logger.warn(`Failed to dispose a pooled sandbox: ${String(error)}`);
  }
}

/** Empty the pool. Test-only seam, and a clean shutdown hook. */
export function clearSandboxPoolForTests(): void {
  for (const pool of [sandboxPool, warmLibraryPool]) {
    for (const [key, entry] of pool) {
      disposeSandbox(entry);
      pool.delete(key);
    }
  }
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
  /** Flattened rows held host-side until a query proves it needs them. */
  private datasets: Record<string, Record<string, unknown>[]> = {};
  /** Datasets actually marshalled into the sandbox so far. */
  private injected = new Set<string>();
  private librariesLoaded = new Set<string>();
  /** Own-property names of the guest global after setup, used to undo a query's globals. */
  private baselineGlobals: string[] = [];
  /** Pool key, set only when this engine's sandbox is eligible for reuse. */
  private poolKey: string | null = null;
  /** Warm-pool key, set when this sandbox may be handed on with its libraries. */
  private warmKey: string | null = null;
  /** Pre-serialised datasets, kept so a pool miss does not stringify twice. */
  private datasetJson: Record<string, string> = {};
  /** Warnings belonging to the sandbox, so a reusing caller gets the same ones. */
  private pooledWarnings: string[] = [];

  /**
   * Create the sandbox and load the flattened datasets into it.
   */
  async initialize(data: FlattenResult): Promise<string[]> {
    const warnings: string[] = [];
    const startTime = Date.now();

    // Serialising per dataset rather than in one blob: the strings are what the
    // fingerprint is computed from AND what gets injected, so a pool miss does
    // not pay for stringify twice.
    if (reuseEnabled()) {
      for (const [name, rows] of data.tables) this.datasetJson[name] = JSON.stringify(rows);
      this.poolKey = fingerprint(this.datasetJson);
      const pooled = sandboxPool.get(this.poolKey);
      if (pooled && !pooled.inUse && pooled.expiresAt > Date.now()) {
        pooled.inUse = true;
        this.adopt(pooled);
        logger.debug(`Reused a loaded sandbox (${this.injected.size} dataset(s) already in)`);
        return pooled.warnings;
      }
    }

    if (!this.adoptWarmSandbox()) await this.createSandbox(startTime);

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
    this.datasets = datasets;

    // Nothing is marshalled yet. Marshalling is the dominant cost of a
    // sandboxed query and most requests touch a fraction of what was fetched
    // (a junction archive is three quarters turn_ratios, which a delay query
    // never reads), so it is deferred until the query text says what it needs.
    this.prepareDatasetObject();

    if (totalRows > JS_QUERY_DEFAULTS.MAX_ROWS_SOFT_LIMIT) {
      const warning = `Large dataset warning: ${totalRows} total rows exceeds soft limit of ${JS_QUERY_DEFAULTS.MAX_ROWS_SOFT_LIMIT}. Query performance may be affected.`;
      warnings.push(warning);
      logger.warn(warning);
    }

    this.captureBaselineGlobals();
    this.pooledWarnings = warnings;
    return warnings;
  }

  /**
   * Take a context whose prelude and libraries are already evaluated, if one is
   * free for this caller. Returns false when the warm pool is off or empty.
   *
   * ~144ms of turf and h3 parsing that would otherwise be repeated. The data
   * was deleted when the context was pooled, so only this request's data is
   * marshalled into it.
   */
  private adoptWarmSandbox(): boolean {
    if (!warmLibsEnabled()) return false;
    this.warmKey = credentialFingerprint();
    const warm = warmLibraryPool.get(this.warmKey);
    if (!warm || warm.inUse || warm.expiresAt <= Date.now()) return false;

    warm.inUse = true;
    this.runtime = warm.runtime;
    this.context = warm.context;
    this.librariesLoaded = warm.librariesLoaded;
    const loaded = this.librariesLoaded.size ? [...this.librariesLoaded].join(", ") : "no";
    logger.debug(`Reused a warm sandbox (${loaded} libraries already evaluated)`);
    return true;
  }

  /** Build a context from scratch and evaluate the prelude into it. */
  private async createSandbox(startTime: number): Promise<void> {
    const wasmModule = await getWasmModule();
    this.runtime = wasmModule.newRuntime();
    this.runtime.setMemoryLimit(JS_QUERY_DEFAULTS.MEMORY_LIMIT_BYTES);
    this.runtime.setMaxStackSize(JS_QUERY_DEFAULTS.MAX_STACK_SIZE_BYTES);
    this.context = this.runtime.newContext();

    logger.debug(`QuickJS sandbox created in ${Date.now() - startTime}ms`);
    this.evalOrThrow(PRELUDE, "sandbox prelude");
  }

  /** Take over a pooled sandbox's state. The handle is new; the sandbox is not. */
  private adopt(pooled: PooledSandbox): void {
    this.runtime = pooled.runtime;
    this.context = pooled.context;
    this.shapes = pooled.shapes;
    this.datasetNames = pooled.datasetNames;
    this.datasets = pooled.datasets;
    this.injected = pooled.injected;
    this.librariesLoaded = pooled.librariesLoaded;
    this.baselineGlobals = pooled.baselineGlobals;
    this.pooledWarnings = pooled.warnings;
  }

  /**
   * Record which globals belong to the sandbox itself, so anything a query adds
   * can be told apart from it later. Refreshed after a library loads, since turf
   * and h3 legitimately add globals of their own.
   */
  private captureBaselineGlobals(): void {
    const context = this.requireContext();
    const result = context.evalCode("JSON.stringify(Object.getOwnPropertyNames(globalThis))");
    if (result.error) {
      result.error.dispose();
      this.baselineGlobals = [];
      return;
    }
    this.baselineGlobals = JSON.parse(context.getString(result.value)) as string[];
    result.value.dispose();
  }

  /**
   * Delete everything a query put on the guest global.
   *
   * This is what makes reuse defensible: without it the next request on this
   * sandbox would see the previous one's globals. It does not undo mutation of
   * the guest's built-in prototypes — see the note on the pool above.
   */
  private resetUserGlobals(): void {
    const keep = JSON.stringify(this.baselineGlobals);
    this.evalOrThrow(
      `(function () {
  var keep = ${keep};
  var allowed = {};
  for (var i = 0; i < keep.length; i++) allowed[keep[i]] = true;
  var names = Object.getOwnPropertyNames(globalThis);
  for (var j = 0; j < names.length; j++) {
    if (!allowed[names[j]]) { try { delete globalThis[names[j]]; } catch (e) {} }
  }
})();`,
      "sandbox reset"
    );
  }

  /**
   * Create the empty dataset object, and guard every name that is not loaded.
   *
   * The guard is the important half. Without it an un-marshalled dataset would
   * read as `undefined`, and `undefined.filter(...)` is the silent-wrong
   * failure this engine is already criticised for. A throwing getter converts
   * any access the source-scan failed to predict into a loud, explicable error.
   */
  private prepareDatasetObject(): void {
    const guards = this.datasetNames
      .map((name) => {
        const message = JSON.stringify(
          `dataset '${name}' was not loaded because no query mentioned it by name. ` +
            `Reference it directly (e.g. ${name}.length) rather than through a computed key.`
        );
        return `Object.defineProperty(globalThis.__datasets, ${JSON.stringify(name)}, {
  configurable: true,
  get: function () { throw new ReferenceError(${message}); }
});`;
      })
      .join("\n");

    this.evalOrThrow(`globalThis.__datasets = {};\n${guards}`, "dataset scaffold");
  }

  /**
   * Marshal the datasets these queries need, if they are not already in.
   *
   * A dataset is needed when its name appears as an identifier in the query
   * source. Over-inclusion is harmless — a name inside a comment or string
   * costs only the transfer — whereas under-inclusion would hide data, so
   * anything ambiguous resolves to loading it. A query that touches `data`
   * itself may index it any way it likes, so that loads everything.
   */
  private ensureDatasets(sources: string): void {
    const wantsEverything = /\bdata\b/.test(sources);
    const needed = this.datasetNames.filter(
      (name) =>
        !this.injected.has(name) &&
        (wantsEverything || new RegExp(`\\b${escapeForRegExp(name)}\\b`).test(sources))
    );
    if (needed.length === 0) return;

    const subset: Record<string, Record<string, unknown>[]> = {};
    for (const name of needed) subset[name] = this.datasets[name];
    this.injectDatasets(subset);
  }

  /**
   * Serialise the given datasets and parse them inside the sandbox.
   *
   * Marshalling dominates the cost of a sandboxed query — the guest-side
   * JSON.parse alone is roughly two thirds of it — so each dataset crosses the
   * boundary at most once and every later query runs against the parsed graph.
   */
  private injectDatasets(datasets: Record<string, Record<string, unknown>[]>): void {
    const context = this.requireContext();
    const startTime = Date.now();
    const names = Object.keys(datasets);
    // Reuse the strings made for the fingerprint rather than serialising again.
    const json = names.every((name) => this.datasetJson[name] !== undefined)
      ? `{${names.map((name) => `${JSON.stringify(name)}:${this.datasetJson[name]}`).join(",")}}`
      : JSON.stringify(datasets);

    const handle = context.newString(json);
    try {
      context.setProp(context.global, "__datasets_json", handle);
    } finally {
      handle.dispose();
    }

    // `delete` first: the name currently holds the throwing guard, and a plain
    // assignment would run its setter-less getter and fail.
    this.evalOrThrow(
      `(function () {
  var incoming = JSON.parse(globalThis.__datasets_json);
  for (var key in incoming) {
    delete globalThis.__datasets[key];
    globalThis.__datasets[key] = incoming[key];
  }
  delete globalThis.__datasets_json;
})();`,
      "dataset injection"
    );

    for (const name of Object.keys(datasets)) this.injected.add(name);

    logger.debug(
      `Marshalled ${Object.keys(datasets).join(", ")} — ${(json.length / 1024).toFixed(0)} KB into the sandbox in ${Date.now() - startTime}ms`
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
    // turf and h3 add globals of their own; they are part of the sandbox now.
    this.captureBaselineGlobals();
    logger.debug(`Injected ${name} into the sandbox in ${Date.now() - startTime}ms`);
  }

  /**
   * Execute named queries and return their results, keyed by query name.
   *
   * A query that throws, times out or blows the result cap fails on its own —
   * the others still run, matching the behaviour callers relied on before.
   */
  async executeQueries(
    queries: Record<string, string>,
    options: QueryExecutionOptions = {}
  ): Promise<Record<string, JsQueryExecutionResult>> {
    const sources = Object.values(queries).join("\n");
    this.ensureDatasets(sources);
    if (/\bturf\s*\./.test(sources)) this.loadLibrary("turf");
    if (/\bh3\s*\./.test(sources)) this.loadLibrary("h3");

    const results: Record<string, JsQueryExecutionResult> = {};
    for (const [name, source] of Object.entries(queries)) {
      try {
        results[name] = this.executeQuery(source, options);
      } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        results[name] = { error: errorMessage };
        logger.warn(`Query "${name}" failed: ${errorMessage}`);
      }
    }
    return results;
  }

  private executeQuery(source: string, options: QueryExecutionOptions = {}): JsQuerySuccessResult {
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

      // `Infinity` is a JS literal the guest understands, and every cap check in
      // __run is a `>` comparison, so it disables them without a second code path.
      const maxRows = options.untruncated ? "Infinity" : String(JS_QUERY_DEFAULTS.MAX_RESULT_ROWS);
      const maxBytes = options.untruncated
        ? "Infinity"
        : String(JS_QUERY_DEFAULTS.MAX_RESULT_BYTES);
      const result = context.evalCode(`__run(__query, ${maxRows}, ${maxBytes})`);
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

    const bindable = this.datasetNames.filter((name) => this.injected.has(name));
    const asExpression = context.evalCode(buildWrapper(source, bindable, "expression"));
    if (!asExpression.error) {
      asExpression.value.dispose();
      return;
    }
    const expressionError = describeError(context, asExpression.error);
    asExpression.error.dispose();

    const asStatements = context.evalCode(buildWrapper(source, bindable, "statements"));
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
    // A pooled sandbox is handed back rather than torn down: its loaded data is
    // the whole point. Everything a query added to the global is deleted first.
    const poolKey = this.poolKey;
    if (poolKey && this.runtime && this.context) {
      try {
        this.resetUserGlobals();
        sandboxPool.set(poolKey, {
          runtime: this.runtime,
          context: this.context,
          shapes: this.shapes,
          datasetNames: this.datasetNames,
          datasets: this.datasets,
          injected: this.injected,
          librariesLoaded: this.librariesLoaded,
          baselineGlobals: this.baselineGlobals,
          warnings: this.pooledWarnings,
          inUse: false,
          expiresAt: Date.now() + JS_QUERY_DEFAULTS.REUSE_TTL_MS,
        });
        this.runtime = null;
        this.context = null;
        this.poolKey = null;
        // The data pool keeps the libraries too, so there is nothing left for
        // the warm pool to hold on to.
        this.warmKey = null;
        this.datasetJson = {};
        evictSandboxes();
        return;
      } catch (error) {
        // A sandbox that cannot be reset is not safe to hand on. Fall through
        // and dispose it, so a failed reset costs performance, never isolation.
        logger.warn(`Sandbox reset failed, disposing instead of pooling: ${String(error)}`);
        this.poolKey = null;
        sandboxPool.delete(poolKey);
      }
    }

    // No exact-data reuse, but the libraries in this context are still worth
    // keeping. The data goes; `__datasets` is deleted outright rather than left
    // for the next caller, who has different data and no business seeing this.
    const warmKey = this.warmKey;
    if (warmKey && this.runtime && this.context) {
      try {
        this.resetUserGlobals();
        this.evalOrThrow("delete globalThis.__datasets;", "warm sandbox data eviction");
        warmLibraryPool.set(warmKey, {
          runtime: this.runtime,
          context: this.context,
          shapes: {},
          datasetNames: [],
          datasets: {},
          injected: new Set<string>(),
          librariesLoaded: this.librariesLoaded,
          baselineGlobals: this.baselineGlobals,
          warnings: [],
          inUse: false,
          expiresAt: Date.now() + JS_QUERY_DEFAULTS.WARM_LIBS_TTL_MS,
        });
        this.runtime = null;
        this.context = null;
        this.warmKey = null;
        this.datasets = {};
        this.datasetJson = {};
        evictWarmSandboxes();
        return;
      } catch (error) {
        logger.warn(`Warm sandbox reset failed, disposing instead of pooling: ${String(error)}`);
        this.warmKey = null;
        warmLibraryPool.delete(warmKey);
      }
    }

    this.datasets = {};
    this.datasetJson = {};

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

/**
 * Escape a dataset name for use in a RegExp. Flattener names are plain
 * identifiers today, but a name is data and must not be able to smuggle
 * pattern syntax into the scan.
 */
function escapeForRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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
