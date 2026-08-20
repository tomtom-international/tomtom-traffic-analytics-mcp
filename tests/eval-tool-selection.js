#!/usr/bin/env node
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
 * Tool-selection and query-quality evaluation.
 *
 * The other suites in this directory call tools by name: they prove a tool works
 * once it has been chosen. This one measures the two things a real client does
 * for itself, both of which depend entirely on the tool descriptions and schemas
 * the server advertises:
 *
 *   Stage 1 — SELECTION.  Given a natural-language prompt and the server's real
 *             listTools() output, does the model reach for the right tool, and
 *             does it respect the ordering the descriptions ask for ("use
 *             tomtom-junction-search FIRST to discover IDs")?
 *
 *   Stage 2 — QUERY QUALITY.  The query parameter is mandatory on every tool, so
 *             the model must write code, not just pick a tool. Each tool call is
 *             executed for real, and the per-query results are inspected to see
 *             whether that code ran, errored, or silently returned nothing.
 *             `undefined`-shaped answers are the failure mode a sandboxed JS
 *             engine has and a SQL engine does not, so they are reported
 *             separately from hard errors.
 *
 * Stage 1 is engine-agnostic: the query parameter name is read from the schema,
 * so this file also runs against the DuckDB/`sql_queries` revision for
 * comparison. Stage 2 reports `empty` results for both engines but only calls
 * them suspicious for the JS one, where an unknown field yields `undefined`
 * rather than an error.
 *
 * Requires ANTHROPIC_API_KEY (or an `ant auth login` profile). TomTom keys are
 * needed only for stage 2 — without them, selection is still measured and the
 * query verdicts are reported as `api_error`.
 *
 * Usage:
 *   node tests/eval-tool-selection.js [--dry-run] [--verbose] [--case=<id>]
 *                                     [--model=<id>] [--runs=<n>] [--no-execute]
 *
 * Flags:
 *   --dry-run      Validate cases and tool-schema conversion, print the matrix,
 *                  make no API calls at all. Needs no keys.
 *   --case=<id>    Run a single case by id (repeatable, comma-separated).
 *   --model=<id>   Model under evaluation. Default claude-opus-5.
 *   --runs=<n>     Repeat every case n times (default 1). Tool choice is not
 *                  deterministic; >1 turns a pass/fail into a rate.
 *   --no-execute   Stage 1 only. Tools are advertised but never really called,
 *                  so no TomTom quota is spent and no query is ever executed.
 *   --verbose      Print each turn, the arguments, and the query source.
 */

import dotenv from "dotenv";
import { Client as McpClient } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { existsSync } from "node:fs";

dotenv.config();

const __dirname = dirname(fileURLToPath(import.meta.url));

const possibleServerPaths = [
  resolve(__dirname, "..", "bin", "tomtom-traffic-analytics-mcp.js"),
  resolve(__dirname, "bin", "tomtom-traffic-analytics-mcp.js"),
  resolve(__dirname, "..", "tomtom-traffic-analytics-mcp.js"),
  resolve(__dirname, "tomtom-traffic-analytics-mcp.js"),
];

const serverPath = possibleServerPaths.find((p) => existsSync(p));
if (!serverPath) {
  console.error("Could not find the MCP server entry point. Searched:");
  for (const p of possibleServerPaths) console.error(`  - ${p}`);
  process.exit(1);
}

// ============================================================================
// CONFIGURATION
// ============================================================================

const args = process.argv.slice(2);
const flag = (name) => args.some((a) => a === `--${name}`);
const value = (name, fallback) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};

const DRY_RUN = flag("dry-run");
const VERBOSE = flag("verbose");
const NO_EXECUTE = flag("no-execute");
const MODEL = value("model", "claude-opus-5");
const RUNS = Number.parseInt(value("runs", "1"), 10);
const ONLY_CASES = value("case", null)
  ?.split(",")
  .map((s) => s.trim())
  .filter(Boolean);

/** Hard ceiling on tool calls per case, so a confused model cannot loop forever. */
const MAX_TURNS = 5;

/**
 * The evaluator is told nothing about the tools beyond what the server
 * advertises. That is the whole point: the descriptions have to carry the
 * routing on their own. It is told to be decisive, because a model that always
 * asks a clarifying question would score zero without being wrong.
 */
const SYSTEM_PROMPT = [
  "You are a traffic analyst assistant with access to TomTom traffic tools.",
  "Answer the user's question by calling the tools available to you.",
  "Prefer acting over asking: if a question is answerable with the tools, call them",
  "rather than asking the user for clarification.",
].join(" ");

// ============================================================================
// EVAL CASES
// ============================================================================

/**
 * `expect` is a set, not a single name: several prompts have more than one
 * defensible first move, and an eval that punishes a reasonable choice measures
 * the eval author's taste rather than the tool descriptions. `rejects` names
 * tools that would be actively wrong, so a case can fail loudly rather than
 * just missing.
 *
 * `expectFirst` is what makes the ordering guidance testable — the junction and
 * route tools all say some variant of "use the search tool first to discover
 * IDs", and nothing until now checked that the instruction lands.
 */
const CASES = [
  // --- live vs archive: the pair most likely to be confused -----------------
  {
    id: "live-now",
    prompt: "What is the delay on each approach at our Amsterdam Zuid junction right now?",
    expectFirst: ["tomtom-junction-search"],
    expect: ["tomtom-junction-live-data"],
    rejects: ["tomtom-junction-archive"],
    why: "'right now' is the live tool; the junction is named, not numbered, so search comes first",
  },
  {
    id: "archive-yesterday",
    prompt:
      "Compare yesterday's morning peak against the afternoon peak at our Amsterdam Zuid junction.",
    expectFirst: ["tomtom-junction-search"],
    expect: ["tomtom-junction-archive"],
    rejects: ["tomtom-junction-live-data"],
    why: "a named past window over a date range is the archive tool, not the live snapshot",
  },
  {
    id: "archive-intraday-pattern",
    prompt:
      "Which hour of the day has the worst queues at our junctions? Use the last two days of data.",
    expect: ["tomtom-junction-search", "tomtom-junction-archive"],
    rejects: ["tomtom-junction-live-data"],
    why: "intra-day pattern detection over 2 days is exactly the archive tool's stated purpose",
  },

  // --- discovery-first ordering --------------------------------------------
  {
    id: "discover-junctions",
    prompt: "Which junctions do we have monitored, and what are their IDs?",
    expect: ["tomtom-junction-search"],
    rejects: ["tomtom-junction-live-data", "tomtom-junction-archive"],
    why: "pure catalog discovery; no traffic data needed",
  },
  {
    id: "discover-routes",
    prompt: "List the routes we monitor and tell me which one is worst right now.",
    expectFirst: ["tomtom-route-search"],
    expect: ["tomtom-route-search"],
    why: "route discovery first; the delay ranking is available from the search tool's own fields",
  },
  {
    id: "route-detail",
    prompt:
      "Break down our slowest monitored route segment by segment and show me where the delay is concentrated.",
    expectFirst: ["tomtom-route-search"],
    expect: ["tomtom-route-monitoring-details"],
    why: "segment-level detail needs the details tool, but the route ID has to be discovered first",
  },

  // --- live traffic: point vs area ----------------------------------------
  {
    id: "flow-point",
    prompt:
      "How fast is traffic moving right now at latitude 52.379, longitude 4.900, and how does that compare to the free-flow speed?",
    expect: ["tomtom-traffic-flow-segment"],
    rejects: ["tomtom-traffic-incidents", "tomtom-area-analytics-stats"],
    why: "a single lat/lon speed reading is the flow-segment tool",
  },
  {
    id: "incidents-area",
    prompt: "Are there any accidents or road closures in central Amsterdam at the moment?",
    expect: ["tomtom-traffic-incidents"],
    rejects: ["tomtom-traffic-flow-segment"],
    why: "incident categories over an area is the incidents tool",
  },
  {
    id: "incidents-multi-area",
    prompt:
      "Compare how many traffic incidents there are in central Amsterdam versus central Rotterdam right now.",
    expect: ["tomtom-traffic-incidents"],
    rejects: ["tomtom-area-analytics-stats"],
    why: "the incidents tool takes several named bboxes for exactly this cross-area comparison",
  },

  // --- area analytics -----------------------------------------------------
  {
    id: "area-stats-trend",
    prompt:
      "Show me the weekly trend in average speed across the Amsterdam city centre area for the last month.",
    expect: ["tomtom-area-analytics-stats"],
    rejects: ["tomtom-traffic-flow-segment", "tomtom-junction-archive"],
    why: "historical area-wide aggregate over a polygon is the area analytics tool",
  },
  {
    id: "area-vs-flow",
    prompt:
      "I need average speed over a whole neighbourhood polygon, not a single road. Which is congested in the Amsterdam centre?",
    expect: ["tomtom-area-analytics-stats"],
    rejects: ["tomtom-traffic-flow-segment"],
    why: "explicitly area-wide, so the point-based flow tool would be wrong",
  },

  // --- prompts that should NOT go to the obvious-sounding tool -------------
  {
    id: "turn-ratios",
    prompt:
      "What proportion of traffic turns left versus continues straight at our Amsterdam Zuid junction right now?",
    expectFirst: ["tomtom-junction-search"],
    expect: ["tomtom-junction-live-data"],
    why: "turn ratios live on the junction tools; 'right now' makes it the live one",
  },
  {
    id: "stops-histogram",
    prompt: "How many times does a typical vehicle have to stop at our monitored junctions?",
    expect: ["tomtom-junction-search", "tomtom-junction-live-data"],
    rejects: ["tomtom-traffic-flow-segment"],
    why: "the stops histogram is a junction dataset, not a flow-segment field",
  },
  {
    id: "junction-not-adhoc",
    prompt: "Give me the approach delays for the junction at 52.34, 4.91.",
    expect: ["tomtom-junction-search", "tomtom-traffic-flow-segment"],
    why: "junction tools cannot take ad-hoc coordinates; searching the catalogue or falling back to flow are both defensible",
  },

  // --- query-writing pressure (stage 2 is the real subject here) -----------
  {
    id: "percentile-query",
    prompt:
      "What is the 95th percentile approach delay across the last two days at our monitored junctions?",
    expect: ["tomtom-junction-search", "tomtom-junction-archive"],
    why: "no percentile helper exists in the sandbox, so the model has to write one",
  },
  {
    id: "grouped-aggregate",
    prompt:
      "Rank our monitored junctions by average delay over the last two days and show only the worst three.",
    expect: ["tomtom-junction-search", "tomtom-junction-archive"],
    why: "group-by plus sort plus limit, the shape most likely to be written wrong",
  },
];

// ============================================================================
// TOOL PLUMBING
// ============================================================================

/**
 * MCP advertises `inputSchema`; the Messages API wants `input_schema`. Nothing
 * else is touched — the descriptions and schemas reach the model exactly as the
 * server emits them, because those are the thing under test.
 *
 * `cache_control` on the final tool caches the whole tool prefix. The tool list
 * is identical across every case and turn, so this is the difference between
 * paying for ~8k tokens of schema once per run and paying for it on every turn.
 */
function toAnthropicTools(mcpTools) {
  const tools = mcpTools.map((t) => ({
    name: t.name,
    description: t.description ?? "",
    input_schema: t.inputSchema,
  }));
  if (tools.length > 0) {
    tools[tools.length - 1] = {
      ...tools[tools.length - 1],
      cache_control: { type: "ephemeral" },
    };
  }
  return tools;
}

/**
 * Finds the mandatory query parameter for a tool. This is what keeps stage 1
 * runnable on the DuckDB revision: `js_queries` there is `sql_queries`, and the
 * name is discovered rather than assumed.
 */
function queryParamName(tool) {
  const props = tool.inputSchema?.properties ?? {};
  return Object.keys(props).find((k) => k === "js_queries" || k === "sql_queries") ?? null;
}

/** Whichever engine the server is running, in the wording used for reporting. */
function engineLabel(mcpTools) {
  const names = new Set(mcpTools.map((t) => queryParamName(t)).filter(Boolean));
  if (names.has("js_queries")) return { engine: "QuickJS (js_queries)", param: "js_queries" };
  if (names.has("sql_queries")) return { engine: "DuckDB (sql_queries)", param: "sql_queries" };
  return { engine: "unknown", param: null };
}

// ============================================================================
// STAGE 2: QUERY VERDICTS
// ============================================================================

/**
 * Classifies one executed tool call. The distinction that matters is between a
 * query the model wrote badly and an API call that failed for reasons outside
 * the model's control — conflating them would blame the model for an expired
 * TomTom key.
 *
 * Verdicts:
 *   ok         every query returned a value
 *   empty      a query succeeded but returned nothing — on the JS engine this is
 *              the `undefined` failure mode, since an unknown field name yields
 *              no error
 *   error      a query raised; the model's code was wrong
 *   api_error  the tool never got as far as running a query
 */
function classifyToolResult(rawText) {
  let parsed;
  try {
    parsed = JSON.parse(rawText);
  } catch {
    // Handlers stringify their envelope, so unparseable text is an error string.
    return { verdict: "api_error", detail: firstLine(rawText) };
  }

  if (parsed?.error || parsed?.isError) {
    return { verdict: "api_error", detail: firstLine(parsed.error ?? rawText) };
  }

  const aggregated = parsed?.aggregated_data;
  if (!aggregated || typeof aggregated !== "object") {
    return { verdict: "api_error", detail: "no aggregated_data in the response" };
  }

  const queryErrors = [];
  const emptyQueries = [];
  for (const [name, result] of Object.entries(aggregated)) {
    if (result && typeof result === "object" && "error" in result) {
      queryErrors.push(`${name}: ${firstLine(String(result.error))}`);
      continue;
    }
    if (isEmptyResult(result)) emptyQueries.push(name);
  }

  if (queryErrors.length > 0) {
    return { verdict: "error", detail: queryErrors.join(" | ") };
  }
  if (emptyQueries.length > 0) {
    return { verdict: "empty", detail: `empty: ${emptyQueries.join(", ")}` };
  }
  return { verdict: "ok", detail: `${Object.keys(aggregated).length} query/queries returned` };
}

/**
 * A query is "empty" when it came back with nothing usable. `null` and
 * `undefined` are the interesting cases: on the JS engine a typo'd field name
 * produces exactly this, with no error anywhere.
 */
function isEmptyResult(result) {
  if (result === null || result === undefined) return true;
  const v = result && typeof result === "object" && "value" in result ? result.value : result;
  if (v === null || v === undefined) return true;
  if (Array.isArray(v)) return v.length === 0;
  if (typeof v === "number") return Number.isNaN(v);
  if (typeof v === "object") return Object.keys(v).length === 0;
  return false;
}

function firstLine(text) {
  return String(text ?? "")
    .split("\n")[0]
    .slice(0, 160);
}

// ============================================================================
// AGENTIC LOOP
// ============================================================================

/**
 * Executes one `tool_use` block and returns both the record used for scoring and
 * the `tool_result` block to hand back to the model.
 *
 * The two are deliberately produced together: the verdict is computed from the
 * full response text, while the copy sent back to the model is truncated, so
 * scoring never depends on how much context the model was given.
 */
async function executeToolUse(use, ctx, turn) {
  const { mcpClient, toolsByName } = ctx;
  const record = {
    name: use.name,
    input: use.input,
    turn,
    querySource: extractQuerySource(use.input, ctx.queryParam),
  };

  if (NO_EXECUTE) {
    record.verdict = "not_executed";
    record.detail = "--no-execute";
    return {
      record,
      result: {
        type: "tool_result",
        tool_use_id: use.id,
        content:
          "Execution is disabled for this evaluation run. Assume the call succeeded and finish your answer.",
      },
    };
  }

  if (!toolsByName.has(use.name)) {
    record.verdict = "api_error";
    record.detail = `unknown tool ${use.name}`;
    return {
      record,
      result: {
        type: "tool_result",
        tool_use_id: use.id,
        content: `No such tool: ${use.name}`,
        is_error: true,
      },
    };
  }

  let text = "";
  let isError = false;
  try {
    const res = await mcpClient.callTool({ name: use.name, arguments: use.input });
    text = (res.content ?? [])
      .filter((c) => c.type === "text")
      .map((c) => c.text)
      .join("\n");
    isError = Boolean(res.isError);
  } catch (err) {
    text = err instanceof Error ? err.message : String(err);
    isError = true;
  }

  const { verdict, detail } = isError
    ? { verdict: "api_error", detail: firstLine(text) }
    : classifyToolResult(text);
  record.verdict = verdict;
  record.detail = detail;

  if (VERBOSE) {
    console.log(`      ${use.name} -> ${verdict}: ${detail}`);
    for (const [qName, src] of Object.entries(record.querySource ?? {})) {
      console.log(`        ${qName}: ${String(src).replace(/\s+/g, " ").slice(0, 200)}`);
    }
  }

  return {
    record,
    result: {
      type: "tool_result",
      tool_use_id: use.id,
      // Truncated so one archive response cannot blow up the context.
      content: text.slice(0, 8000) || "(empty response)",
      is_error: isError,
    },
  };
}

/**
 * Runs one case: prompt the model with the real tool list, execute whatever it
 * calls, feed the results back, and stop when it answers or runs out of turns.
 *
 * `--no-execute` short-circuits execution with a stub result. The model still
 * sees a well-formed reply so the conversation can continue, but no TomTom
 * request is made and no query is run, which makes stage 1 cheap and offline.
 */
async function runCase(evalCase, ctx) {
  const { anthropic, tools } = ctx;
  const messages = [{ role: "user", content: evalCase.prompt }];
  const toolCalls = [];
  let stopReason = null;
  let finalText = "";

  for (let turn = 0; turn < MAX_TURNS; turn++) {
    const response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 16000,
      system: SYSTEM_PROMPT,
      thinking: { type: "adaptive" },
      tools,
      messages,
    });

    stopReason = response.stop_reason;

    // A safety decline is neither a selection hit nor a miss; record and stop.
    if (stopReason === "refusal") {
      return {
        toolCalls,
        stopReason,
        finalText: "",
        refusal: response.stop_details?.category ?? "unknown",
      };
    }

    const toolUses = response.content.filter((b) => b.type === "tool_use");
    for (const block of response.content) {
      if (block.type === "text") finalText += block.text;
    }

    if (toolUses.length === 0) break;

    messages.push({ role: "assistant", content: response.content });

    // Every tool_result for a turn goes back in ONE user message; splitting them
    // teaches the model to stop calling tools in parallel.
    const results = [];
    for (const use of toolUses) {
      const { record, result } = await executeToolUse(use, ctx, turn);
      toolCalls.push(record);
      results.push(result);
    }

    messages.push({ role: "user", content: results });
  }

  return { toolCalls, stopReason, finalText, refusal: null };
}

/** Pulls the query record out of a tool call, whatever the engine calls it. */
function extractQuerySource(input, queryParam) {
  if (!queryParam) return null;
  const queries = input?.[queryParam];
  if (!queries || typeof queries !== "object") return null;
  return queries;
}

// ============================================================================
// SCORING
// ============================================================================

function scoreCase(evalCase, outcome) {
  const called = outcome.toolCalls.map((c) => c.name);
  const first = called[0] ?? null;

  const selection = (() => {
    if (outcome.refusal) return { status: "REFUSAL", note: outcome.refusal };
    if (called.length === 0) return { status: "NO_CALL", note: "model answered without tools" };

    if (evalCase.rejects?.some((r) => called.includes(r))) {
      const hit = evalCase.rejects.filter((r) => called.includes(r));
      return { status: "WRONG", note: `called rejected ${hit.join(", ")}` };
    }
    if (evalCase.expectFirst && !evalCase.expectFirst.includes(first)) {
      return { status: "ORDER", note: `first call was ${first}` };
    }
    if (!evalCase.expect.some((e) => called.includes(e))) {
      return { status: "MISS", note: `never called ${evalCase.expect.join(" or ")}` };
    }
    return { status: "PASS", note: called.join(" -> ") };
  })();

  const executed = outcome.toolCalls.filter((c) => c.verdict && c.verdict !== "not_executed");
  const query = (() => {
    if (executed.length === 0) return { status: "N/A", note: "nothing executed" };
    const errors = executed.filter((c) => c.verdict === "error");
    const empties = executed.filter((c) => c.verdict === "empty");
    const apiErrors = executed.filter((c) => c.verdict === "api_error");
    const ok = executed.filter((c) => c.verdict === "ok");

    if (errors.length > 0) {
      return { status: "ERROR", note: errors.map((e) => e.detail).join(" | ") };
    }
    if (ok.length === 0 && apiErrors.length > 0) {
      return { status: "API", note: apiErrors[0].detail };
    }
    if (empties.length > 0) {
      return { status: "EMPTY", note: empties.map((e) => e.detail).join(" | ") };
    }
    return { status: "OK", note: `${ok.length} call(s) returned data` };
  })();

  return { selection, query, called };
}

// ============================================================================
// REPORTING
// ============================================================================

function pad(text, width) {
  const s = String(text ?? "");
  return s.length >= width ? s.slice(0, width) : s + " ".repeat(width - s.length);
}

function printMatrix() {
  console.log(`\nEVAL CASES (${CASES.length})`);
  console.log("=".repeat(100));
  for (const c of CASES) {
    console.log(`  ${pad(c.id, 24)} expect: ${c.expect.join(" | ")}`);
    if (c.expectFirst) console.log(`  ${pad("", 24)} first:  ${c.expectFirst.join(" | ")}`);
    if (c.rejects) console.log(`  ${pad("", 24)} reject: ${c.rejects.join(" | ")}`);
    console.log(`  ${pad("", 24)} why:    ${c.why}`);
  }
  console.log("=".repeat(100));
}

function printResults(rows, meta) {
  console.log(`\n\nRESULTS — ${meta.engine}, model ${MODEL}, ${RUNS} run(s) per case`);
  console.log("=".repeat(100));
  console.log(` ${pad("Case", 24)}| ${pad("Selection", 10)}| ${pad("Query", 8)}| Detail`);
  console.log(`${"-".repeat(26)}+${"-".repeat(11)}+${"-".repeat(9)}+${"-".repeat(50)}`);
  for (const r of rows) {
    console.log(
      ` ${pad(r.id, 24)}| ${pad(r.selection.status, 10)}| ${pad(r.query.status, 8)}| ${firstLine(
        r.selection.status === "PASS" ? r.query.note : r.selection.note
      )}`
    );
  }
  console.log("=".repeat(100));
  printSelectionSummary(rows);
  printQuerySummary(rows);
  printFailures(rows);
  console.log();
}

function printSelectionSummary(rows) {
  const tally = (list, key, val) => list.filter((r) => r[key].status === val).length;
  const total = rows.length;
  const selPass = tally(rows, "selection", "PASS");

  console.log("\nSELECTION");
  console.log(`  PASS     ${selPass}/${total}  (${((selPass / total) * 100).toFixed(0)}%)`);
  for (const status of ["ORDER", "MISS", "WRONG", "NO_CALL", "REFUSAL"]) {
    const n = tally(rows, "selection", status);
    if (n > 0) console.log(`  ${pad(status, 9)}${n}/${total}`);
  }
}

function printQuerySummary(rows) {
  const tally = (list, key, val) => list.filter((r) => r[key].status === val).length;
  const total = rows.length;
  const qOk = tally(rows, "query", "OK");
  const qErr = tally(rows, "query", "ERROR");
  const qEmpty = tally(rows, "query", "EMPTY");
  const qApi = tally(rows, "query", "API");

  console.log("\nQUERY QUALITY");
  const executedRows = total - tally(rows, "query", "N/A");
  if (executedRows === 0) {
    console.log("  nothing executed (--no-execute)");
  } else {
    console.log(`  OK       ${qOk}/${executedRows}   queries ran and returned data`);
    if (qErr > 0)
      console.log(`  ERROR    ${qErr}/${executedRows}   query raised — model wrote bad code`);
    if (qEmpty > 0)
      console.log(
        `  EMPTY    ${qEmpty}/${executedRows}   ran but returned nothing (the silent-wrong mode)`
      );
    if (qApi > 0)
      console.log(`  API      ${qApi}/${executedRows}   never reached a query (API/key error)`);
  }
}

function printFailures(rows) {
  const failures = rows.filter((r) => r.selection.status !== "PASS" || r.query.status === "ERROR");
  if (failures.length === 0) return;
  console.log("\nNEEDS ATTENTION");
  for (const f of failures) {
    console.log(`  - ${f.id}: selection=${f.selection.status} (${f.selection.note})`);
    if (f.query.status === "ERROR") console.log(`      query error: ${f.query.note}`);
  }
}

// ============================================================================
// MAIN
// ============================================================================

/** Connects to the server over stdio and reports what it advertises. */
async function connectToServer() {
  const mcpClient = new McpClient({ name: "tomtom-tool-selection-eval", version: "1.0.0" });
  const transport = new StdioClientTransport({
    command: "node",
    args: [serverPath],
    env: { ...process.env },
  });
  await mcpClient.connect(transport);

  const { tools: mcpTools } = await mcpClient.listTools();
  const meta = engineLabel(mcpTools);

  console.log(`Server advertises ${mcpTools.length} tools; engine: ${meta.engine}`);
  const missingQueryParam = mcpTools.filter((t) => !queryParamName(t)).map((t) => t.name);
  if (missingQueryParam.length > 0) {
    console.log(`  note: no query parameter found on ${missingQueryParam.join(", ")}`);
  }

  return {
    mcpClient,
    mcpTools,
    meta,
    tools: toAnthropicTools(mcpTools),
    toolsByName: new Map(mcpTools.map((t) => [t.name, t])),
  };
}

/**
 * Every tool a case names must actually exist, or a rename would silently score
 * as MISS on every run and read as a routing regression.
 */
function unknownToolsIn(cases, mcpTools) {
  const advertised = new Set(mcpTools.map((t) => t.name));
  const unknown = new Set();
  for (const c of cases) {
    for (const n of [...c.expect, ...(c.expectFirst ?? []), ...(c.rejects ?? [])]) {
      if (!advertised.has(n)) unknown.add(n);
    }
  }
  return [...unknown];
}

/**
 * Loads the SDK lazily so --dry-run works in a checkout that has never
 * installed it — which is the case for the DuckDB revision this eval is meant
 * to be run against for comparison.
 */
async function createAnthropicClient() {
  if (!process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_AUTH_TOKEN) {
    console.error("\nANTHROPIC_API_KEY is not set — this eval needs a model to evaluate.");
    console.error("Set ANTHROPIC_API_KEY, or run `ant auth login`, then re-run.");
    console.error("Use --dry-run to validate the cases without any API call.");
    return null;
  }
  try {
    const { default: Anthropic } = await import("@anthropic-ai/sdk");
    return new Anthropic();
  } catch {
    console.error("\n@anthropic-ai/sdk is not installed in this checkout.");
    console.error("Install it (pnpm add -D @anthropic-ai/sdk) or use --dry-run.");
    return null;
  }
}

/**
 * Runs every selected case (RUNS times each) and scores it. A case that throws
 * is recorded as an ERROR row rather than aborting the run, so one transport
 * hiccup does not discard the results already collected.
 */
async function runAllCases(selected, ctx) {
  const rows = [];
  for (const evalCase of selected) {
    for (let run = 0; run < RUNS; run++) {
      const label = RUNS > 1 ? `${evalCase.id}#${run + 1}` : evalCase.id;
      process.stdout.write(`  ${pad(label, 26)}`);
      try {
        const outcome = await runCase(evalCase, ctx);
        const scored = scoreCase(evalCase, outcome);
        rows.push({ id: label, ...scored });
        console.log(`${scored.selection.status} / ${scored.query.status}`);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        rows.push({
          id: label,
          selection: { status: "ERROR", note: message },
          query: { status: "N/A", note: "case threw" },
          called: [],
        });
        console.log(`ERROR — ${firstLine(message)}`);
      }
    }
  }
  return rows;
}

async function main() {
  const selected = ONLY_CASES ? CASES.filter((c) => ONLY_CASES.includes(c.id)) : CASES;
  if (selected.length === 0) {
    console.error(`No cases matched --case=${ONLY_CASES?.join(",")}`);
    process.exit(1);
  }

  if (DRY_RUN) {
    printMatrix();
    console.log("\n--dry-run: connecting to the server to validate schemas, no API calls\n");
  }

  const { mcpClient, mcpTools, meta, tools, toolsByName } = await connectToServer();

  const unknown = unknownToolsIn(selected, mcpTools);
  if (unknown.length > 0) {
    console.error(`\nEval references tools the server does not advertise: ${unknown.join(", ")}`);
    console.error("Update the cases in this file to match the current tool names.");
    await mcpClient.close();
    process.exit(1);
  }

  if (DRY_RUN) {
    console.log(`All ${selected.length} case(s) reference known tools. Schema conversion OK.`);
    console.log(`Tool prefix cached at: ${tools[tools.length - 1].name}`);
    await mcpClient.close();
    process.exit(0);
  }

  const anthropic = await createAnthropicClient();
  if (!anthropic) {
    await mcpClient.close();
    process.exit(1);
  }

  const ctx = { anthropic, mcpClient, tools, toolsByName, queryParam: meta.param };

  const rows = await runAllCases(selected, ctx);

  printResults(rows, meta);
  await mcpClient.close();

  // Selection regressions and query errors both fail the run; API errors do not,
  // since an unusable TomTom key is not a defect in the thing being measured.
  const hardFailures = rows.filter(
    (r) =>
      ["WRONG", "MISS", "NO_CALL", "ERROR"].includes(r.selection.status) ||
      r.query.status === "ERROR"
  );
  process.exit(hardFailures.length > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
