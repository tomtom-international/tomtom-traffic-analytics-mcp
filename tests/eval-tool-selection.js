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
 * Models come from the agent-toolkit's Azure setup — see ./eval-model.js — so
 * this eval and the map-agent scenario suites read the same AZURE_* environment
 * and exercise the same deployments. Every case runs against EVERY configured
 * deployment and only passes when all of them route correctly, so a prompt that
 * happens to work on one model cannot hide a regression on another.
 *
 * Requires AZURE_API_KEY and AZURE_RESOURCE_NAME. TomTom keys are needed only
 * for stage 2 — without them, selection is still measured and the query verdicts
 * are reported as `api_error`.
 *
 * Usage:
 *   node tests/eval-tool-selection.js [--dry-run] [--verbose] [--case=<id>]
 *                                     [--models=<a,b>] [--runs=<n>] [--no-execute]
 *
 * Flags:
 *   --dry-run       Validate cases and tool-schema conversion, print the matrix,
 *                   make no model calls at all. Needs no keys.
 *   --case=<id>     Run a single case by id (repeatable, comma-separated).
 *   --models=<a,b>  Deployment ids to evaluate, overriding AZURE_MODEL_IDS /
 *                   AZURE_DEPLOYMENT_ID.
 *   --runs=<n>      Repeat every case n times (default 1). Tool choice is not
 *                   deterministic; >1 turns a pass/fail into a rate.
 *   --no-execute    Stage 1 only. Tools are advertised but never really called,
 *                   so no TomTom quota is spent and no query is ever executed.
 *   --verbose       Print each step, the arguments, and the query source.
 */

import dotenv from "dotenv";
import { jsonSchema, stepCountIs, tool, ToolLoopAgent } from "ai";
import { Client as McpClient } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { resolveAzureModels, resolveDeploymentIds } from "./eval-model.js";
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
const MODELS_OVERRIDE = value("models", null);
const RUNS = Number.parseInt(value("runs", "1"), 10);
const ONLY_CASES = value("case", null)
  ?.split(",")
  .map((s) => s.trim())
  .filter(Boolean);

/**
 * Hard ceiling on steps per case, so a confused model cannot loop forever.
 * Matches the agent-toolkit's `maxSteps: 10` order of magnitude but stays
 * tighter: these prompts need at most a discovery call plus an analysis call.
 */
const MAX_STEPS = 5;

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
 *
 * Prompts naming a junction use "Nassauplein", which is really in the account's
 * catalogue. An invented name measures nothing: the model searches, finds no
 * match, and correctly stops, which scores as a routing MISS while the routing
 * was in fact right. Keep these names in step with the catalogue.
 */
const CASES = [
  // --- live vs archive: the pair most likely to be confused -----------------
  {
    id: "live-now",
    prompt: "What is the delay on each approach at our Nassauplein junction right now?",
    expectFirst: ["tomtom-junction-search"],
    expect: ["tomtom-junction-live-data"],
    rejects: ["tomtom-junction-archive"],
    why: "'right now' is the live tool; the junction is named, not numbered, so search comes first",
  },
  {
    id: "archive-yesterday",
    prompt:
      "Compare yesterday's morning peak against the afternoon peak at our Nassauplein junction.",
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
      "What proportion of traffic turns left versus continues straight at our Nassauplein junction right now?",
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
 * Wraps the server's MCP tools as AI SDK tools.
 *
 * The descriptions and schemas reach the model exactly as the server emits them
 * — they are the thing under test, so nothing here rewrites or summarises them.
 * `jsonSchema()` passes the MCP JSON Schema straight through rather than
 * round-tripping it through Zod, which would risk changing what the model sees.
 *
 * `execute` is where stage 2 happens: the AI SDK drives the tool loop, and each
 * call is really performed against the MCP server, classified, and recorded via
 * `onCall` before the result goes back to the model.
 */
function toAiSdkTools(mcpTools, hooks) {
  const tools = {};
  for (const mcpTool of mcpTools) {
    tools[mcpTool.name] = tool({
      description: mcpTool.description ?? "",
      inputSchema: jsonSchema(mcpTool.inputSchema ?? { type: "object", properties: {} }),
      execute: (input) => runMcpTool(mcpTool, input, hooks),
    });
  }
  return tools;
}

/**
 * Performs one tool call, records the stage-2 verdict, and returns the text the
 * model sees. Kept separate from the wrapper so the verdict logic is readable
 * and the closure stays a one-liner.
 */
async function runMcpTool(mcpTool, input, { mcpClient, queryParam, onCall }) {
  const record = {
    name: mcpTool.name,
    input,
    querySource: extractQuerySource(input, queryParam),
  };

  if (NO_EXECUTE) {
    record.verdict = "not_executed";
    record.detail = "--no-execute";
    onCall(record);
    return "Execution is disabled for this evaluation run. Assume the call succeeded and finish your answer.";
  }

  const { text, isError } = await callMcpTool(mcpClient, mcpTool.name, input);
  const { verdict, detail, values } = isError
    ? { verdict: "api_error", detail: firstLine(text) }
    : classifyToolResult(text);
  record.verdict = verdict;
  record.detail = detail;
  record.values = values ?? {};
  onCall(record);

  // A failed query is the one case where the source matters more than the noise,
  // so print it in FULL and regardless of --verbose. Truncating here once cost a
  // diagnosis: a ReferenceError was observed with no record of what produced it.
  if (verdict === "error") {
    console.log(`\n      ${mcpTool.name} -> ${verdict}: ${detail}`);
    for (const [qName, src] of Object.entries(record.querySource ?? {})) {
      console.log(`        ${qName}: ${src}`);
    }
  } else if (VERBOSE) {
    console.log(`      ${mcpTool.name} -> ${verdict}: ${detail}`);
    for (const [qName, src] of Object.entries(record.querySource ?? {})) {
      console.log(`        ${qName}: ${String(src).replace(/\s+/g, " ").slice(0, 200)}`);
    }
  }

  // Truncated so one archive response cannot fill the context window. The
  // verdict above is computed from the full text, never from this copy.
  return text.slice(0, 8000) || "(empty response)";
}

/** Calls a tool over MCP, turning a thrown transport error into the same shape. */
async function callMcpTool(mcpClient, name, args) {
  try {
    const res = await mcpClient.callTool({ name, arguments: args });
    const text = (res.content ?? [])
      .filter((c) => c.type === "text")
      .map((c) => c.text)
      .join("\n");
    return { text, isError: Boolean(res.isError) };
  } catch (err) {
    return { text: err instanceof Error ? err.message : String(err), isError: true };
  }
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
  const values = {};
  for (const [name, result] of Object.entries(aggregated)) {
    if (result && typeof result === "object" && "error" in result) {
      queryErrors.push(`${name}: ${firstLine(String(result.error))}`);
      continue;
    }
    values[name] = normaliseQueryValue(result);
    if (isEmptyResult(result)) emptyQueries.push(name);
  }

  if (queryErrors.length > 0) {
    return { verdict: "error", detail: queryErrors.join(" | "), values };
  }
  if (emptyQueries.length > 0) {
    return { verdict: "empty", detail: `empty: ${emptyQueries.join(", ")}`, values };
  }
  return {
    verdict: "ok",
    detail: `${Object.keys(aggregated).length} query/queries returned`,
    values,
  };
}

/**
 * Presents a query result the same way whichever engine produced it, so a
 * semantic check can be written once.
 *
 * DuckDB returns `{ columns, rows }` with rows as positional arrays; the
 * sandbox returns `{ value }` with real objects. Zipping columns onto rows means
 * a check can talk about field names on both revisions.
 */
function normaliseQueryValue(result) {
  if (!result || typeof result !== "object") return result;
  if (Array.isArray(result.rows) && Array.isArray(result.columns)) {
    return result.rows.map((row) =>
      Object.fromEntries(result.columns.map((col, i) => [col, row[i]]))
    );
  }
  return "value" in result ? result.value : result;
}

/**
 * A query is "empty" when it came back with nothing usable. `null` and
 * `undefined` are the interesting cases: on the JS engine a typo'd field name
 * produces exactly this, with no error anywhere.
 */
function isEmptyResult(result) {
  if (result === null || result === undefined) return true;

  // The DuckDB revision returns { columns, rows, rowCount } rather than
  // { value }. Without this, a query that matched nothing would score OK there
  // and EMPTY here, and the cross-revision comparison would be meaningless.
  if (result && typeof result === "object" && Array.isArray(result.rows)) {
    return result.rows.length === 0;
  }

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
 * Runs one case against one model: hand the agent the real tool set and the
 * prompt, let the AI SDK drive the tool loop, and collect what it called.
 *
 * Tool calls are gathered by the `onCall` hook rather than read back off
 * `result.steps`, because the hook fires in execution order and already carries
 * the stage-2 verdict computed from the untruncated response.
 */
async function runCase(evalCase, ctx, model) {
  const toolCalls = [];
  const tools = toAiSdkTools(ctx.mcpTools, {
    mcpClient: ctx.mcpClient,
    queryParam: ctx.queryParam,
    onCall: (record) => toolCalls.push(record),
  });

  const agent = new ToolLoopAgent({
    model,
    tools,
    instructions: SYSTEM_PROMPT,
    stopWhen: [stepCountIs(MAX_STEPS)],
  });

  const result = await agent.generate({
    messages: [{ role: "user", content: evalCase.prompt }],
  });

  return {
    toolCalls,
    stopReason: result.finishReason,
    finalText: result.text ?? "",
    steps: result.steps?.length ?? 0,
    refusal: null,
  };
}

/** Pulls the query record out of a tool call, whatever the engine calls it. */
function extractQuerySource(input, queryParam) {
  if (!queryParam) return null;
  const queries = input?.[queryParam];
  if (!queries || typeof queries !== "object") return null;
  return queries;
}

// ============================================================================
// STAGE 3: DOES THE ANSWER MAKE SENSE?
// ============================================================================

/**
 * Stages 1 and 2 establish that the model picked the right tool and that its
 * code ran and returned something. Neither says the answer is RIGHT: a query
 * that averages the wrong field, or sorts ascending when the prompt said
 * "worst", passes both. That is the plausible-but-wrong failure the design doc
 * warns about, and catching it needs a per-case expectation.
 *
 * These checks are deliberately shape-and-plausibility level, not proofs. They
 * assert the things that would be wrong if the model had misread the datasets —
 * that the answer refers to junctions that exist, that a ranking really is
 * ordered, that an hour-of-day is an hour of day. They are written against the
 * normalised value, so the same check runs on both engines.
 *
 * Cases with no `check` are reported as `—`: not verified rather than verified.
 */

/** Every value any query returned for this case, flattened. */
function allValues(toolCalls) {
  return toolCalls.flatMap((c) => Object.values(c.values ?? {}));
}

/** Collects numeric leaves, so a check need not guess the model's field names. */
function numbersIn(value, depth = 0) {
  if (depth > 4) return [];
  if (typeof value === "number" && Number.isFinite(value)) return [value];
  if (Array.isArray(value)) return value.flatMap((v) => numbersIn(v, depth + 1));
  if (value && typeof value === "object") {
    return Object.values(value).flatMap((v) => numbersIn(v, depth + 1));
  }
  return [];
}

/** True when the case's output mentions any of these strings anywhere. */
function mentionsAny(toolCalls, needles) {
  const blob = JSON.stringify(allValues(toolCalls)).toLowerCase();
  return needles.some((n) => blob.includes(n.toLowerCase()));
}

/** The longest array any query returned — usually the answer to a "rank/list" prompt. */
function largestArray(toolCalls) {
  let best = null;
  for (const value of allValues(toolCalls)) {
    if (Array.isArray(value) && (best === null || value.length > best.length)) best = value;
  }
  return best;
}

/**
 * Checks a ranking really is ordered. Picks the numeric field that varies across
 * items and asserts it is non-increasing, so it works whatever the model named
 * the column. Returns null when there is nothing to check — two equal values
 * cannot be out of order.
 */
function checkDescending(rows) {
  if (!Array.isArray(rows) || rows.length < 2) return null;
  const keys = Object.keys(rows[0] ?? {}).filter((k) => typeof rows[0][k] === "number");
  for (const key of keys) {
    const series = rows.map((r) => r[key]).filter((n) => typeof n === "number");
    if (series.length !== rows.length) continue;
    if (new Set(series).size === 1) continue;
    const sorted = [...series].every((_, i) => i === 0 || series[i - 1] >= series[i]);
    if (!sorted) return `"${key}" is not ordered worst-first: [${series.join(", ")}]`;
    return null;
  }
  return null;
}

/** The junctions and route that really exist in this account, for reality checks. */
const KNOWN_JUNCTION_HINTS = ["nassauplein", "nassaukade", "jacob catskade"];
const KNOWN_ROUTE_HINTS = ["barna-girona", "137571"];

/**
 * Per-case semantic expectations, keyed by case id. Absent = not verified.
 * Written tolerantly on purpose: they must not fail a correct answer just
 * because the model chose different field names.
 */
const CHECKS = {
  "discover-junctions": (calls) =>
    mentionsAny(calls, KNOWN_JUNCTION_HINTS)
      ? null
      : "result never names a junction that exists in the catalogue",

  "discover-routes": (calls) =>
    mentionsAny(calls, KNOWN_ROUTE_HINTS)
      ? null
      : "result never names the monitored route (barna-girona / 137571)",

  "route-detail": (calls) =>
    mentionsAny(calls, KNOWN_ROUTE_HINTS)
      ? null
      : "segment breakdown does not reference the monitored route",

  "live-now": (calls) => {
    const delays = numbersIn(allValues(calls));
    if (delays.length === 0) return "no numeric delay anywhere in the result";
    // Approach delays are seconds. Anything past an hour means a unit or field mix-up.
    return delays.some((n) => n >= 0 && n <= 3600)
      ? null
      : `no plausible delay-in-seconds value; saw [${delays.slice(0, 5).join(", ")}]`;
  },

  "archive-intraday-pattern": (calls) => {
    const nums = numbersIn(allValues(calls));
    return nums.some((n) => Number.isInteger(n) && n >= 0 && n <= 23)
      ? null
      : "no hour-of-day (0-23) in a result that should be grouped by hour";
  },

  "grouped-aggregate": (calls) => {
    const rows = largestArray(calls);
    if (!Array.isArray(rows)) return "no array to rank";
    if (rows.length > 3) return `asked for the worst three, returned ${rows.length}`;
    return checkDescending(rows);
  },

  "percentile-query": (calls) => {
    const nums = numbersIn(allValues(calls));
    if (nums.length === 0) return "no numeric percentile in the result";
    return nums.some((n) => n >= 0 && n <= 3600)
      ? null
      : `no plausible delay-in-seconds percentile; saw [${nums.slice(0, 5).join(", ")}]`;
  },
};

/**
 * Runs the case's check, if it has one. A check only runs when there was output
 * to inspect: blaming the model for a wrong answer it never got to produce
 * would confuse an API failure with a reasoning failure.
 */
function scoreSemantics(evalCase, outcome) {
  const check = CHECKS[evalCase.id];
  if (!check) return { status: "—", note: "no expectation defined" };
  if (allValues(outcome.toolCalls).length === 0) {
    return { status: "N/A", note: "no output to check" };
  }
  // If ANY call hit an API error, the case never assembled the data its answer
  // needed, and judging what came back would blame the model for a 404. Seen
  // for real: an archive 404 left a percentile prompt with nothing to compute
  // from, and the check called the model wrong for not producing one.
  const apiFailed = outcome.toolCalls.filter((c) => c.verdict === "api_error");
  if (apiFailed.length > 0) {
    return { status: "N/A", note: `incomplete data (${apiFailed.length} API error(s))` };
  }
  try {
    const problem = check(outcome.toolCalls);
    return problem ? { status: "WRONG", note: problem } : { status: "SANE", note: "passes" };
  } catch (err) {
    return { status: "N/A", note: `check threw: ${firstLine(String(err))}` };
  }
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
    // A case can succeed on one call and hit an API error on another. Saying
    // plain "OK" there would hide the half that never ran, so the count travels
    // with the verdict.
    if (apiErrors.length > 0) {
      return {
        status: "PARTIAL",
        note: `${ok.length} call(s) returned data, ${apiErrors.length} hit API errors: ${apiErrors[0].detail}`,
      };
    }
    return { status: "OK", note: `${ok.length} call(s) returned data` };
  })();

  return { selection, query, semantics: scoreSemantics(evalCase, outcome), called };
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

function printResults(rows, meta, modelId) {
  console.log(`\n\nRESULTS — ${meta.engine}, ${modelId}, ${RUNS} run(s) per case`);
  console.log("=".repeat(100));
  console.log(
    ` ${pad("Case", 24)}| ${pad("Selection", 10)}| ${pad("Query", 8)}| ${pad("Sane", 6)}| Detail`
  );
  console.log(
    `${"-".repeat(26)}+${"-".repeat(11)}+${"-".repeat(9)}+${"-".repeat(7)}+${"-".repeat(40)}`
  );
  for (const r of rows) {
    // Show whichever problem is furthest upstream: a wrong tool explains a bad
    // query, and a failed query explains a missing answer.
    const detail =
      r.selection.status !== "PASS"
        ? r.selection.note
        : r.semantics.status === "WRONG"
          ? r.semantics.note
          : r.query.note;
    console.log(
      ` ${pad(r.id, 24)}| ${pad(r.selection.status, 10)}| ${pad(r.query.status, 8)}| ${pad(
        r.semantics.status,
        6
      )}| ${firstLine(detail)}`
    );
  }
  console.log("=".repeat(100));
  printSelectionSummary(rows);
  printQuerySummary(rows);
  printSemanticSummary(rows);
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
  const qPartial = tally(rows, "query", "PARTIAL");

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
    if (qPartial > 0)
      console.log(
        `  PARTIAL  ${qPartial}/${executedRows}   some calls worked, others hit API errors`
      );
  }
}

function printSemanticSummary(rows) {
  const tally = (val) => rows.filter((r) => r.semantics.status === val).length;
  const checked = tally("SANE") + tally("WRONG");
  console.log("\nANSWER SANITY (stage 3)");
  if (checked === 0) {
    console.log(`  nothing checkable ran (${rows.length} case(s))`);
  } else {
    console.log(`  SANE     ${tally("SANE")}/${checked}   answer is plausible for the prompt`);
    if (tally("WRONG") > 0) {
      console.log(
        `  WRONG    ${tally("WRONG")}/${checked}   ran and returned, but the answer is wrong`
      );
    }
  }
  const unchecked = rows.length - checked;
  if (unchecked > 0) {
    console.log(
      `  ${unchecked}/${rows.length} case(s) carry no expectation — not verified, not passed`
    );
  }
}

function printFailures(rows) {
  const failures = rows.filter(
    (r) =>
      r.selection.status !== "PASS" || r.query.status === "ERROR" || r.semantics.status === "WRONG"
  );
  if (failures.length === 0) return;
  console.log("\nNEEDS ATTENTION");
  for (const f of failures) {
    console.log(`  - ${f.id}: selection=${f.selection.status} (${f.selection.note})`);
    if (f.query.status === "ERROR") console.log(`      query error: ${f.query.note}`);
    if (f.semantics.status === "WRONG") console.log(`      wrong answer: ${f.semantics.note}`);
  }
}

/**
 * Per-case agreement across deployments. This is the view the agent-toolkit
 * suites are built around: a case that passes on one model and fails on another
 * is a weakness in the tool description, not a quirk of one model, and it is
 * invisible in any single-model report.
 */
function printCrossModel(perModel) {
  const ids = perModel.map((m) => m.id);
  const caseIds = perModel[0].rows.map((r) => r.id);

  console.log(`\n\nCROSS-MODEL AGREEMENT — ${ids.join(" vs ")}`);
  console.log("=".repeat(100));
  console.log(` ${pad("Case", 26)}| ${ids.map((id) => pad(id, 12)).join("| ")}`);
  console.log(`${"-".repeat(27)}+${ids.map(() => "-".repeat(13)).join("+")}`);

  const disagreed = [];
  for (const caseId of caseIds) {
    const statuses = perModel.map(({ rows }) => {
      const row = rows.find((r) => r.id === caseId);
      return row ? row.selection.status : "—";
    });
    if (new Set(statuses).size > 1) disagreed.push(caseId);
    console.log(` ${pad(caseId, 26)}| ${statuses.map((st) => pad(st, 12)).join("| ")}`);
  }
  console.log("=".repeat(100));

  const allPass = caseIds.filter((caseId) =>
    perModel.every(({ rows }) => rows.find((r) => r.id === caseId)?.selection.status === "PASS")
  ).length;
  console.log(`\n  ${allPass}/${caseIds.length} cases route correctly on EVERY deployment`);
  if (disagreed.length > 0) {
    console.log(
      `  ${disagreed.length} case(s) where deployments disagree: ${disagreed.join(", ")}`
    );
    console.log("  A disagreement is a description weakness, not a model quirk — fix the wording.");
  }
  console.log();
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

  return { mcpClient, mcpTools, meta };
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
 * Resolves the deployments to evaluate. Returns an empty list when Azure is not
 * configured, matching the agent-toolkit's skip-rather-than-fail behaviour.
 */
function resolveModels() {
  const models = resolveAzureModels(MODELS_OVERRIDE);
  if (models.length === 0) {
    console.error("\nAzure is not configured — this eval needs a model to evaluate.");
    console.error("Set AZURE_API_KEY and AZURE_RESOURCE_NAME (plus AZURE_DEPLOYMENT_ID or");
    console.error("AZURE_MODEL_IDS to choose deployments), then re-run.");
    console.error("Use --dry-run to validate the cases without any model call.");
  }
  return models;
}

/**
 * Runs every selected case (RUNS times each) and scores it. A case that throws
 * is recorded as an ERROR row rather than aborting the run, so one transport
 * hiccup does not discard the results already collected.
 */
async function runAllCases(selected, ctx, model) {
  const rows = [];
  for (const evalCase of selected) {
    for (let run = 0; run < RUNS; run++) {
      const label = RUNS > 1 ? `${evalCase.id}#${run + 1}` : evalCase.id;
      process.stdout.write(`  ${pad(label, 26)}`);
      try {
        const outcome = await runCase(evalCase, ctx, model);
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

  const { mcpClient, mcpTools, meta } = await connectToServer();

  const unknown = unknownToolsIn(selected, mcpTools);
  if (unknown.length > 0) {
    console.error(`\nEval references tools the server does not advertise: ${unknown.join(", ")}`);
    console.error("Update the cases in this file to match the current tool names.");
    await mcpClient.close();
    process.exit(1);
  }

  if (DRY_RUN) {
    console.log(`All ${selected.length} case(s) reference known tools.`);
    const probe = toAiSdkTools(mcpTools, {
      mcpClient,
      queryParam: meta.param,
      onCall: () => {},
    });
    console.log(`Schema conversion OK for ${Object.keys(probe).length} tool(s).`);
    console.log(
      `Deployments that would be evaluated: ${resolveDeploymentIds(MODELS_OVERRIDE).join(", ")}`
    );
    await mcpClient.close();
    process.exit(0);
  }

  const models = resolveModels();
  if (models.length === 0) {
    await mcpClient.close();
    process.exit(1);
  }

  const ctx = { mcpClient, mcpTools, queryParam: meta.param };

  // Every deployment runs the whole set. A prompt that routes correctly on one
  // model but not another is a real weakness in the descriptions, so the run
  // fails unless all of them pass — the agent-toolkit suites score the same way.
  const perModel = [];
  for (const { id, model } of models) {
    console.log(`\n${id}`);
    const rows = await runAllCases(selected, ctx, model);
    perModel.push({ id, rows });
  }

  for (const { id, rows } of perModel) {
    printResults(rows, meta, id);
  }

  if (perModel.length > 1) printCrossModel(perModel);

  await mcpClient.close();

  // Selection regressions and query errors both fail the run; API errors do not,
  // since an unusable TomTom key is not a defect in the thing being measured.
  const hardFailures = perModel.flatMap(({ rows }) =>
    rows.filter(
      (r) =>
        ["WRONG", "MISS", "NO_CALL", "ERROR"].includes(r.selection.status) ||
        r.query.status === "ERROR" ||
        r.semantics.status === "WRONG"
    )
  );
  process.exit(hardFailures.length > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
