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
 * HTTP Integration Test for TomTom Traffic Analytics MCP Server
 *
 * Starts the HTTP server, calls ALL tools via MCP-over-HTTP (SSE),
 * validates response structures deeply, and tests auth behavior.
 *
 * Usage:
 *   node tests/test-http-tools.js [toolName] [--verbose] [--metrics-only]
 *
 * Requires:
 *   - Built server (pnpm run build)
 *   - TOMTOM_MOVE_PORTAL_KEY and/or TOMTOM_API_KEY in .env
 */

import { spawn } from "child_process";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";

dotenv.config();

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, "..");

// CLI args
const args = process.argv.slice(2);
const VERBOSE = args.includes("--verbose");
const METRICS_ONLY = args.includes("--metrics-only");
const TOOL_FILTER = args.find((a) => !a.startsWith("--"));

const PORT = 3999;
const MOVE_PORTAL_KEY = process.env.TOMTOM_MOVE_PORTAL_KEY || "";
const API_KEY = process.env.TOMTOM_API_KEY || "";
if (!MOVE_PORTAL_KEY && !API_KEY) {
  console.error("Missing TOMTOM_MOVE_PORTAL_KEY and TOMTOM_API_KEY in environment or .env file");
  console.error("At least one API key is required for HTTP integration tests");
  process.exit(1);
}

// ─── SSE Response Parsing ────────────────────────────────────────────────────

function parseSSEResponse(text) {
  const dataLine = text.split("\n").find((line) => line.startsWith("data: "));
  if (!dataLine) throw new Error(`No data line in SSE response: ${text.substring(0, 200)}`);
  return JSON.parse(dataLine.slice(6));
}

// ─── MCP-over-HTTP Calls ─────────────────────────────────────────────────────

async function callToolsList() {
  const body = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} });
  const res = await fetch(`http://localhost:${PORT}/mcp`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json,text/event-stream",
      "tomtom-api-key": API_KEY,
      "tomtom-move-portal-key": MOVE_PORTAL_KEY,
    },
    body,
  });
  if (!res.ok) throw new Error(`tools/list failed: HTTP ${res.status}`);
  const sse = parseSSEResponse(await res.text());
  return sse.result?.tools || [];
}

async function callTool(toolName, params) {
  const body = JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    method: "tools/call",
    params: { name: toolName, arguments: params },
  });

  const res = await fetch(`http://localhost:${PORT}/mcp`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json,text/event-stream",
      "tomtom-api-key": API_KEY,
      "tomtom-move-portal-key": MOVE_PORTAL_KEY,
    },
    body,
  });

  if (!res.ok) throw new Error(`tools/call ${toolName} failed: HTTP ${res.status}`);
  const sse = parseSSEResponse(await res.text());

  if (sse.error) throw new Error(`MCP error: ${JSON.stringify(sse.error)}`);

  // The MCP response for tools/call has result.content
  return sse.result;
}

// ─── Server Management ───────────────────────────────────────────────────────

function startServer() {
  return new Promise((resolve, reject) => {
    const serverFile = `${PROJECT_ROOT}/dist/indexHttp.esm.js`;
    const child = spawn("node", [serverFile], {
      env: { ...process.env, PORT: String(PORT) },
      stdio: ["ignore", "pipe", "pipe"],
    });

    let started = false;
    const timeout = setTimeout(() => {
      if (!started) {
        child.kill();
        reject(new Error("Server startup timed out (15s)"));
      }
    }, 15000);

    // Our logger writes to stderr via console.error
    child.stderr.on("data", (chunk) => {
      const text = chunk.toString();
      if (text.includes("HTTP Server started") && !started) {
        started = true;
        clearTimeout(timeout);
        resolve(child);
      }
      if (VERBOSE) process.stderr.write(`  [server] ${text}`);
    });

    child.stdout.on("data", (chunk) => {
      if (VERBOSE) process.stdout.write(`  [server] ${chunk.toString()}`);
    });

    child.on("error", (err) => {
      clearTimeout(timeout);
      reject(new Error(`Failed to start server: ${err.message}`));
    });

    child.on("exit", (code) => {
      if (!started) {
        clearTimeout(timeout);
        reject(new Error(`Server exited with code ${code} before starting`));
      }
    });
  });
}

// ─── Validators ──────────────────────────────────────────────────────────────

function validateSqlFilteredResponse(result, expectedToolName, options = {}) {
  try {
    if (!result.content || !result.content[0] || !result.content[0].text) {
      return fail("Invalid response structure - missing content");
    }
    const data = JSON.parse(result.content[0].text);

    if (data.error) return fail(`API error: ${data.error}`);
    if (!data.metadata) return fail("Missing metadata");
    if (data.metadata.tool !== expectedToolName) {
      return fail(`metadata.tool = "${data.metadata.tool}", expected "${expectedToolName}"`);
    }
    if (!data.aggregated_data) return fail("Missing aggregated_data");

    const queryNames = Object.keys(data.aggregated_data);
    for (const name of queryNames) {
      const qr = data.aggregated_data[name];
      if (!qr || qr.error) {
        return fail(`${name}: ${qr?.error ?? "invalid query result structure"}`);
      }
      if (!("value" in qr)) return fail(`${name}: missing value`);
    }

    // Field validation — the keys of the first object in an array result
    if (options.expectedFields) {
      for (const [queryName, expectedFields] of Object.entries(options.expectedFields)) {
        const qr = data.aggregated_data[queryName];
        if (!qr || !Array.isArray(qr.value) || qr.value.length === 0) continue;
        const fields = Object.keys(qr.value[0]);
        for (const field of expectedFields) {
          if (!fields.includes(field)) {
            return fail(`${queryName}: expected field "${field}" not in [${fields.join(", ")}]`);
          }
        }
      }
    }

    const shapes = data.metadata.dataset_shapes || {};
    const tables = Object.entries(shapes)
      .map(([t, shape]) => `${t}:${shape.rows}`)
      .join(", ");
    const resultSummary = queryNames
      .map((n) => {
        const value = data.aggregated_data[n]?.value;
        return `${n}:${Array.isArray(value) ? `${value.length}r` : typeof value}`;
      })
      .join(", ");
    return pass(`rows: {${tables}} | results: {${resultSummary}}`);
  } catch (error) {
    return fail(`Invalid response: ${error.message}`);
  }
}

function pass(msg) {
  return { valid: true, message: msg };
}
function fail(msg) {
  return { valid: false, message: msg };
}

// ─── Test Results ────────────────────────────────────────────────────────────

class TestResults {
  constructor() {
    this.results = [];
    this.passed = 0;
    this.failed = 0;
    this.skipped = 0;
  }
  addResult(tool, name, status, msg, duration = null) {
    this.results.push({ tool, name, status, msg, duration });
    const icon = status === "PASS" ? "  PASS" : status === "FAIL" ? "  FAIL" : "  SKIP";
    const dur = duration ? ` (${duration}ms)` : "";
    console.log(`${icon} ${name} - ${msg}${dur}`);
    if (status === "PASS") this.passed++;
    else if (status === "FAIL") this.failed++;
    else this.skipped++;
  }
  printSummary() {
    console.log(`\n${"=".repeat(60)}`);
    console.log(`HTTP TEST SUMMARY: ${this.passed + this.failed + this.skipped} tests`);
    console.log(`${"=".repeat(60)}`);
    console.log(`  Passed:  ${this.passed}`);
    console.log(`  Failed:  ${this.failed}`);
    console.log(`  Skipped: ${this.skipped}`);
    console.log(`${"=".repeat(60)}`);
    if (this.failed > 0) {
      console.log("\nFailed tests:");
      this.results
        .filter((r) => r.status === "FAIL")
        .forEach((r) => console.log(`  - ${r.tool}: ${r.msg}`));
    }
  }
}

// ─── Test Scenarios (same tools, HTTP transport) ─────────────────────────────

function getRecentDates() {
  const to = new Date();
  to.setDate(to.getDate() - 1);
  const from = new Date(to);
  from.setDate(from.getDate() - 1);
  const fmt = (d) => d.toISOString().split("T")[0];
  return { from: fmt(from), to: fmt(to) };
}
const recentDates = getRecentDates();

const SCENARIOS = {
  "tomtom-junction-search": {
    params: {
      js_queries: {
        junctions:
          "junctions.slice(0, 5).map(j => ({ junction_id: j.junction_id, name: j.name, status: j.status }))",
      },
    },
    expectedFields: { junctions: ["junction_id", "name", "status"] },
    captureId: { field: "junction_id", key: "junctionId" },
  },
  "tomtom-route-search": {
    params: {
      js_queries: {
        routes:
          "routes.map(r => ({ route_id: r.route_id, route_name: r.route_name, route_status: r.route_status }))",
      },
    },
    expectedFields: { routes: ["route_id", "route_name", "route_status"] },
    captureId: { field: "route_id", key: "routeId" },
  },
  "tomtom-traffic-flow-segment": {
    params: {
      point: { latitude: 52.374, longitude: 4.8897 },
      style: "absolute",
      zoom: 12,
      js_queries: {
        flow:
          "flow_segment.map(s => ({ frc: s.frc, current_speed: s.current_speed, free_flow_speed: s.free_flow_speed }))",
      },
    },
    expectedFields: { flow: ["frc", "current_speed", "free_flow_speed"] },
  },
  "tomtom-traffic-incidents": {
    params: {
      bboxes: [{ name: "Amsterdam", bbox: "4.85,52.35,4.95,52.40" }],
      maxResults: 10,
      js_queries: {
        summary:
          "Object.entries(Object.groupBy(incidents, i => i.iconCategory)).map(([iconCategory, rows]) => ({ iconCategory, count: rows.length }))",
      },
    },
    expectedFields: { summary: ["iconCategory", "count"] },
  },
  "tomtom-area-analytics-stats": {
    params: {
      name: "HTTP Test Amsterdam",
      startDate: "2024-08-01",
      endDate: "2024-08-07",
      hours: [8, 9, 17, 18],
      frcs: [0, 1, 2, 3],
      dataTypes: ["CONGESTION_LEVEL"],
      features: [
        {
          type: "Feature",
          geometry: {
            type: "Polygon",
            coordinates: [
              [
                [4.896128, 52.382402],
                [4.875701, 52.368459],
                [4.923611, 52.36341],
                [4.896128, 52.382402],
              ],
            ],
          },
          properties: { name: "Amsterdam", timezone: "Europe/Amsterdam" },
        },
      ],
      js_queries: {
        trend:
          "Object.entries(Object.groupBy(timed_data.filter(r => r.aggregation_type === 'daily'), r => r.time.slice(0, 10))).map(([day, rows]) => ({ day, avg: +(rows.reduce((s, r) => s + r.congestion_level, 0) / rows.length).toFixed(2) })).sort((a, b) => a.day.localeCompare(b.day))",
      },
    },
    expectedFields: { trend: ["day", "avg"] },
  },
};

const DEPENDENT_SCENARIOS = {
  "tomtom-junction-live-data": {
    dependsOn: "junctionId",
    makeParams: (id) => ({
      junctionIds: [id],
      includeGeometry: false,
      js_queries: {
        approaches:
          "[...approaches].sort((a, b) => b.delay_sec - a.delay_sec).map(a => ({ approach_id: a.approach_id, delay_sec: a.delay_sec }))",
      },
    }),
    expectedFields: { approaches: ["approach_id", "delay_sec"] },
  },
  "tomtom-junction-archive": {
    dependsOn: "junctionId",
    makeParams: (id) => ({
      junctionIds: [id],
      from: recentDates.from,
      to: recentDates.to,
      js_queries: {
        avg: "Object.entries(Object.groupBy(approaches, a => a.approach_id)).map(([approach_id, rows]) => ({ approach_id, avg_delay: +(rows.reduce((s, r) => s + r.delay_sec, 0) / rows.length).toFixed(2) }))",
      },
    }),
    expectedFields: { avg: ["approach_id", "avg_delay"] },
  },
  "tomtom-route-monitoring-details": {
    dependsOn: "routeId",
    makeParams: (id) => ({
      routeIds: [id],
      js_queries: {
        info:
          "route_info.map(r => ({ route_name: r.route_name, travel_time: r.travel_time, delay_time: r.delay_time }))",
      },
    }),
    expectedFields: { info: ["route_name", "travel_time", "delay_time"] },
  },
};

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  console.log("TomTom Traffic Analytics MCP — HTTP Integration Test");
  console.log("=".repeat(60));

  // Start server
  console.log(`\nStarting HTTP server on port ${PORT}...`);
  let serverProcess;
  try {
    serverProcess = await startServer();
    console.log("Server started\n");
  } catch (e) {
    console.error(`Failed to start server: ${e.message}`);
    process.exit(1);
  }

  const results = new TestResults();
  const captured = {};

  try {
    // Wait for server readiness
    await new Promise((r) => setTimeout(r, 500));

    // --- Health check ---
    console.log("HEALTH CHECK");
    console.log("-".repeat(40));
    try {
      const healthRes = await fetch(`http://localhost:${PORT}/health`);
      const health = await healthRes.json();
      if (health.status === "ok") {
        results.addResult("health", "GET /health", "PASS", `status:ok, version:${health.version}`);
      } else {
        results.addResult("health", "GET /health", "FAIL", `status: ${health.status}`);
      }
    } catch (e) {
      results.addResult("health", "GET /health", "FAIL", e.message);
    }

    // --- Tools list ---
    console.log("\nTOOLS LIST");
    console.log("-".repeat(40));
    let tools;
    try {
      tools = await callToolsList();
      const names = tools.map((t) => t.name);
      const expected = [
        "tomtom-junction-search",
        "tomtom-route-search",
        "tomtom-traffic-flow-segment",
        "tomtom-traffic-incidents",
        "tomtom-area-analytics-stats",
        "tomtom-junction-live-data",
        "tomtom-junction-archive",
        "tomtom-route-monitoring-details",
      ];
      const missing = expected.filter((n) => !names.includes(n));
      if (missing.length === 0) {
        results.addResult(
          "tools/list",
          "All expected tools available",
          "PASS",
          `${tools.length} tools`
        );
      } else {
        results.addResult("tools/list", "Tools check", "FAIL", `Missing: ${missing.join(", ")}`);
      }
    } catch (e) {
      results.addResult("tools/list", "List tools", "FAIL", e.message);
      throw e; // Can't continue
    }

    if (METRICS_ONLY) {
      console.log("\n--metrics-only: skipping tool calls");
      return;
    }

    // --- Auth test (405/401) ---
    console.log("\nAUTH & ERROR HANDLING");
    console.log("-".repeat(40));

    // GET /mcp should be 405
    try {
      const getRes = await fetch(`http://localhost:${PORT}/mcp`);
      results.addResult(
        "auth",
        "GET /mcp returns 405",
        getRes.status === 405 ? "PASS" : "FAIL",
        `HTTP ${getRes.status}`
      );
    } catch (e) {
      results.addResult("auth", "GET /mcp returns 405", "FAIL", e.message);
    }

    // --- Phase 1: Independent tool calls ---
    const phase1Tools = TOOL_FILTER
      ? Object.keys(SCENARIOS).filter((t) => t === TOOL_FILTER)
      : Object.keys(SCENARIOS);

    console.log("\nPHASE 1: INDEPENDENT TOOLS");
    console.log("-".repeat(40));

    for (const toolName of phase1Tools) {
      const scenario = SCENARIOS[toolName];
      const t0 = Date.now();
      try {
        if (VERBOSE) console.log(`    Params: ${JSON.stringify(scenario.params)}`);

        const result = await callTool(toolName, scenario.params);
        const duration = Date.now() - t0;

        const validation = validateSqlFilteredResponse(result, toolName, {
          expectedFields: scenario.expectedFields,
        });

        results.addResult(
          toolName,
          toolName,
          validation.valid ? "PASS" : "FAIL",
          validation.message,
          duration
        );

        // Capture ID for Phase 2
        if (validation.valid && scenario.captureId) {
          try {
            const data = JSON.parse(result.content[0].text);
            for (const qr of Object.values(data.aggregated_data || {})) {
              const rows = qr?.value;
              if (Array.isArray(rows) && rows.length > 0 && rows[0]?.[scenario.captureId.field] != null) {
                captured[scenario.captureId.key] = String(rows[0][scenario.captureId.field]);
                break;
              }
            }
          } catch {
            /* ignore */
          }
        }
      } catch (e) {
        results.addResult(toolName, toolName, "FAIL", `Error: ${e.message}`, Date.now() - t0);
      }
    }

    // --- Phase 2: Dependent tool calls ---
    const phase2Tools = TOOL_FILTER
      ? Object.keys(DEPENDENT_SCENARIOS).filter((t) => t === TOOL_FILTER)
      : Object.keys(DEPENDENT_SCENARIOS);

    console.log("\nPHASE 2: DEPENDENT TOOLS");
    console.log("-".repeat(40));

    for (const toolName of phase2Tools) {
      const scenario = DEPENDENT_SCENARIOS[toolName];
      const depValue = captured[scenario.dependsOn];
      if (!depValue) {
        results.addResult(toolName, toolName, "SKIP", `No ${scenario.dependsOn} captured`);
        continue;
      }

      const params = scenario.makeParams(depValue);
      const t0 = Date.now();
      try {
        const result = await callTool(toolName, params);
        const duration = Date.now() - t0;
        const validation = validateSqlFilteredResponse(result, toolName, {
          expectedFields: scenario.expectedFields,
        });
        results.addResult(
          toolName,
          toolName,
          validation.valid ? "PASS" : "FAIL",
          validation.message,
          duration
        );
      } catch (e) {
        results.addResult(toolName, toolName, "FAIL", `Error: ${e.message}`, Date.now() - t0);
      }
    }
  } finally {
    console.log("\nShutting down server...");
    serverProcess.kill("SIGTERM");
    await new Promise((r) => setTimeout(r, 500));
  }

  results.printSummary();
  process.exit(results.failed > 0 ? 1 : 0);
}

process.on("SIGINT", () => {
  console.log("\nInterrupted");
  process.exit(1);
});
process.on("SIGTERM", () => {
  console.log("\nTerminated");
  process.exit(1);
});

main().catch((err) => {
  console.error(`Unhandled error: ${err.message}`);
  if (VERBOSE) console.error(err.stack);
  process.exit(1);
});
