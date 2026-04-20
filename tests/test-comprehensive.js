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
 * Comprehensive Integration Test Suite for TomTom Traffic Analytics MCP Server
 *
 * Tests all tools via stdio MCP transport against real TomTom APIs.
 * Validates response structure, metadata shape, SQL query results,
 * and data integrity — not just that the response is non-empty.
 *
 * Usage:
 *   node tests/test-comprehensive.js [toolName] [--verbose] [--metrics-only]
 *
 * Flags:
 *   --metrics-only   Only connect, list tools, print token metrics table, exit
 *   --verbose        Show full request/response details
 *   [toolName]       Run only tests for a specific tool
 */

import dotenv from 'dotenv';
import { Client as McpClient } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { existsSync } from 'fs';

// Load environment variables
dotenv.config();

// Get directory paths and find server
const __dirname = dirname(fileURLToPath(import.meta.url));

const possibleServerPaths = [
  resolve(__dirname, '..', 'bin', 'tomtom-traffic-analytics-mcp.js'),
  resolve(__dirname, 'bin', 'tomtom-traffic-analytics-mcp.js'),
  resolve(__dirname, '..', 'tomtom-traffic-analytics-mcp.js'),
  resolve(__dirname, 'tomtom-traffic-analytics-mcp.js'),
];

let serverPath = null;
for (const path of possibleServerPaths) {
  if (existsSync(path)) {
    serverPath = path;
    break;
  }
}

if (!serverPath) {
  console.error('Could not find TomTom Traffic Analytics MCP Server file!');
  console.error('Searched in:');
  possibleServerPaths.forEach(path => console.error(`  - ${path}`));
  process.exit(1);
}

// Configuration
const TEST_TOOL = process.argv.find(a => !a.startsWith('--') && a !== process.argv[0] && a !== process.argv[1])?.toLowerCase();
const VERBOSE = process.argv.includes('--verbose');
const METRICS_ONLY = process.argv.includes('--metrics-only');


// ============================================================================
// TOKEN METRICS — Measures the actual MCP listTools() response
// ============================================================================

function printToolMetrics(toolsResponse) {
  const tools = toolsResponse.tools;
  const fullResponseJson = JSON.stringify(toolsResponse);

  console.log('\nTOOL TOKEN METRICS (from MCP listTools response)');
  console.log('='.repeat(85));
  console.log(` ${'Tool Name'.padEnd(38)}| ${'Desc'.padStart(6)} | ${'Schema'.padStart(6)} | ${'Wire'.padStart(7)} | ${'~Tokens'.padStart(7)} | ${'%'.padStart(4)}`);
  console.log(`${'─'.repeat(39)}+${('─'.repeat(8))}+${('─'.repeat(8))}+${('─'.repeat(9))}+${('─'.repeat(9))}+${'─'.repeat(5)}`);

  let totalDesc = 0;
  let totalSchema = 0;
  let totalWire = 0;

  const rows = [];
  for (const tool of tools) {
    const descChars = (tool.description || '').length;
    const schemaChars = JSON.stringify(tool.inputSchema || {}).length;
    const wireChars = JSON.stringify(tool).length;
    const tokens = Math.ceil(wireChars / 4);

    totalDesc += descChars;
    totalSchema += schemaChars;
    totalWire += wireChars;

    rows.push({ name: tool.name, descChars, schemaChars, wireChars, tokens });
  }

  for (const row of rows) {
    const pct = totalWire > 0 ? Math.round((row.wireChars / totalWire) * 100) : 0;
    console.log(
      ` ${row.name.padEnd(38)}| ${fmt(row.descChars).padStart(6)} | ${fmt(row.schemaChars).padStart(6)} | ${fmt(row.wireChars).padStart(7)} | ${fmt(row.tokens).padStart(7)} | ${(pct + '%').padStart(4)}`
    );
  }

  const totalTokens = Math.ceil(totalWire / 4);
  const fullTokens = Math.ceil(fullResponseJson.length / 4);

  console.log(`${'─'.repeat(39)}+${('─'.repeat(8))}+${('─'.repeat(8))}+${('─'.repeat(9))}+${('─'.repeat(9))}+${'─'.repeat(5)}`);
  console.log(
    ` ${'TOTAL (' + tools.length + ' tools)'.padEnd(29)}| ${fmt(totalDesc).padStart(6)} | ${fmt(totalSchema).padStart(6)} | ${fmt(totalWire).padStart(7)} | ${fmt(totalTokens).padStart(7)} |`
  );
  console.log(
    ` ${'Full listTools() response'.padEnd(38)}| ${''.padStart(6)} | ${''.padStart(6)} | ${fmt(fullResponseJson.length).padStart(7)} | ${fmt(fullTokens).padStart(7)} |`
  );
  console.log('='.repeat(85));
  console.log(`\nApproximation: 1 token ~ 4 chars. Wire = JSON.stringify(tool) per tool.\n`);
}

function fmt(n) {
  return n.toLocaleString('en-US');
}

// ============================================================================
// DEEP VALIDATORS — Verify data integrity, not just response shape
// ============================================================================

/**
 * Parse the MCP tool response into the SqlFilteredResponse object
 */
function parseResponse(result) {
  if (!result.content || !result.content[0] || !result.content[0].text) {
    throw new Error('Invalid response structure - missing content');
  }
  return JSON.parse(result.content[0].text);
}

/**
 * Validate the core SqlFilteredResponse shape, metadata fields, and query results.
 * Returns { valid, message, details } with specific failure reasons.
 */
function validateSqlFilteredResponse(result, expectedToolName, options = {}) {
  try {
    const data = parseResponse(result);

    // Check for API-level errors
    if (data.error) return fail(`API error: ${data.error}`);

    // --- Metadata validation ---
    if (!data.metadata) return fail('Missing metadata in response');
    if (data.metadata.tool !== expectedToolName) {
      return fail(`metadata.tool = "${data.metadata.tool}", expected "${expectedToolName}"`);
    }
    if (typeof data.metadata.queries_executed !== 'number' || data.metadata.queries_executed < 1) {
      return fail(`metadata.queries_executed should be >= 1, got: ${data.metadata.queries_executed}`);
    }
    if (!data.metadata.raw_row_counts || typeof data.metadata.raw_row_counts !== 'object') {
      return fail('metadata.raw_row_counts is missing or not an object');
    }
    if (data.metadata.parameters === undefined) {
      return fail('metadata.parameters is missing');
    }

    // --- Aggregated data validation ---
    if (!data.aggregated_data || typeof data.aggregated_data !== 'object') {
      return fail('Missing or invalid aggregated_data');
    }

    const queryNames = Object.keys(data.aggregated_data);
    if (queryNames.length === 0) {
      return fail('aggregated_data has no query results');
    }

    // Validate each query result has { columns, rows, rowCount }
    const queryErrors = [];
    for (const name of queryNames) {
      const qr = data.aggregated_data[name];
      if (!qr) { queryErrors.push(`${name}: null result`); continue; }
      if (!Array.isArray(qr.columns)) queryErrors.push(`${name}: missing columns array`);
      if (!Array.isArray(qr.rows)) queryErrors.push(`${name}: missing rows array`);
      if (typeof qr.rowCount !== 'number') queryErrors.push(`${name}: missing rowCount`);

      // Verify rows match rowCount
      if (Array.isArray(qr.rows) && typeof qr.rowCount === 'number' && qr.rows.length !== qr.rowCount) {
        queryErrors.push(`${name}: rows.length (${qr.rows.length}) != rowCount (${qr.rowCount})`);
      }

      // Verify each row has same length as columns
      if (Array.isArray(qr.columns) && Array.isArray(qr.rows) && qr.rows.length > 0) {
        const colLen = qr.columns.length;
        for (let i = 0; i < Math.min(qr.rows.length, 3); i++) { // Check first 3 rows
          if (qr.rows[i].length !== colLen) {
            queryErrors.push(`${name}: row[${i}] has ${qr.rows[i].length} values, expected ${colLen} columns`);
          }
        }
      }
    }

    if (queryErrors.length > 0) {
      return fail(`Query result errors: ${queryErrors.join('; ')}`);
    }

    // --- Expected columns validation (if provided) ---
    if (options.expectedColumns) {
      for (const [queryName, expectedCols] of Object.entries(options.expectedColumns)) {
        const qr = data.aggregated_data[queryName];
        if (!qr) { continue; }
        for (const col of expectedCols) {
          if (!qr.columns.includes(col)) {
            queryErrors.push(`${queryName}: expected column "${col}" not found in [${qr.columns.join(', ')}]`);
          }
        }
      }
      if (queryErrors.length > 0) {
        return fail(`Column validation: ${queryErrors.join('; ')}`);
      }
    }

    // --- Expected non-empty results (if specified) ---
    if (options.expectNonEmpty) {
      for (const queryName of options.expectNonEmpty) {
        const qr = data.aggregated_data[queryName];
        if (qr && qr.rowCount === 0) {
          return fail(`Query "${queryName}" returned 0 rows (expected non-empty)`);
        }
      }
    }

    // Build summary
    const rowCounts = data.metadata.raw_row_counts;
    const tables = Object.entries(rowCounts).map(([t, c]) => `${t}:${c}`).join(', ');
    const warnings = data.metadata.warnings;

    let msg = `${data.metadata.queries_executed} queries, rows: {${tables}}`;
    if (warnings && warnings.length > 0) {
      msg += ` (${warnings.length} warnings)`;
    }

    // Append query result counts
    const resultSummary = queryNames.map(n => `${n}:${data.aggregated_data[n]?.rowCount ?? 0}r`).join(', ');
    msg += ` | results: {${resultSummary}}`;

    return pass(msg);
  } catch (error) {
    return fail(`Invalid response: ${error.message}`);
  }
}

function pass(message) { return { valid: true, message }; }
function fail(message) { return { valid: false, message }; }

// ============================================================================
// TEST SCENARIOS — ordered by dependency
// ============================================================================

function getRecentDates() {
  const to = new Date();
  to.setDate(to.getDate() - 1); // yesterday
  const from = new Date(to);
  from.setDate(from.getDate() - 1); // day before yesterday
  const fmt = d => d.toISOString().split('T')[0];
  return { from: fmt(from), to: fmt(to) };
}
const recentDates = getRecentDates();

// Phase 1: Independent tools (no ID dependencies)
// Phase 2: Dependent tools (use captured IDs from Phase 1)
const TEST_EXECUTION_ORDER = [
  // Phase 1
  'tomtom-junction-search',
  'tomtom-route-search',
  'tomtom-traffic-flow-segment',
  'tomtom-traffic-incidents',
  'tomtom-area-analytics-stats',
  // Phase 2
  'tomtom-junction-live-data',
  'tomtom-junction-archive',
  'tomtom-route-monitoring-details',
];

const COMPREHENSIVE_TEST_SCENARIOS = {
  "tomtom-junction-search": [
    {
      name: 'Search junction definitions with SQL',
      params: {
        sql_queries: {
          all_junctions: "SELECT junction_id, name, status FROM junctions LIMIT 5"
        }
      },
      captureId: 'junctionId',
      validateOptions: {
        expectedColumns: { all_junctions: ['junction_id', 'name', 'status'] },
        expectNonEmpty: ['all_junctions'],
      },
    }
  ],

  "tomtom-route-search": [
    {
      name: 'Search all monitored routes with SQL',
      params: {
        sql_queries: {
          all_routes: "SELECT route_id, route_name, route_status, delay_time FROM routes"
        }
      },
      captureId: 'routeId',
      validateOptions: {
        expectedColumns: { all_routes: ['route_id', 'route_name', 'route_status'] },
        expectNonEmpty: ['all_routes'],
      },
    }
  ],

  "tomtom-traffic-flow-segment": [
    {
      name: 'Get traffic flow for Amsterdam point',
      params: {
        point: { latitude: 52.3740, longitude: 4.8897 },
        style: 'absolute',
        zoom: 12,
        sql_queries: {
          segment_info: "SELECT frc, current_speed, free_flow_speed, confidence FROM flow_segment"
        }
      },
      validateOptions: {
        expectedColumns: { segment_info: ['frc', 'current_speed', 'free_flow_speed', 'confidence'] },
        expectNonEmpty: ['segment_info'],
      },
    }
  ],

  "tomtom-traffic-incidents": [
    {
      name: 'Get traffic incidents in Amsterdam area',
      params: {
        bboxes: [{ name: 'Amsterdam', bbox: '4.85,52.35,4.95,52.40' }],
        language: 'en-US',
        maxResults: 10,
        sql_queries: {
          summary: "SELECT iconCategory, COUNT(*) as count FROM incidents GROUP BY iconCategory ORDER BY count DESC",
          all_incidents: "SELECT id, iconCategory, delay FROM incidents LIMIT 5"
        }
      },
      validateOptions: {
        expectedColumns: {
          summary: ['iconCategory', 'count'],
          all_incidents: ['id', 'iconCategory', 'delay'],
        },
      },
    }
  ],

  "tomtom-area-analytics-stats": [
    {
      name: 'Get area analytics stats for Amsterdam polygon',
      params: {
        name: "Test Amsterdam Stats",
        startDate: "2024-08-01",
        endDate: "2024-08-07",
        hours: [7, 8, 9, 17, 18, 19],
        frcs: [0, 1, 2, 3, 4, 5],
        dataTypes: ["CONGESTION_LEVEL", "SPEED"],
        features: [
          {
            type: "Feature",
            geometry: {
              type: "Polygon",
              coordinates: [[[4.896128, 52.382402], [4.875701, 52.368459], [4.923611, 52.36341], [4.896128, 52.382402]]]
            },
            properties: {
              name: "Amsterdam",
              timezone: "Europe/Amsterdam"
            }
          }
        ],
        sql_queries: {
          daily_trend: "SELECT time::DATE as day, ROUND(AVG(congestion_level), 2) as avg_congestion FROM timed_data WHERE aggregation_type = 'daily' GROUP BY day ORDER BY day"
        }
      },
      validateOptions: {
        expectedColumns: { daily_trend: ['day', 'avg_congestion'] },
        expectNonEmpty: ['daily_trend'],
      },
    }
  ],

  // Phase 2 — Dependent tools

  "tomtom-junction-live-data": [
    {
      name: 'Get junction live data',
      params: {
        junctionIds: ['{{capturedJunctionId}}'],
        includeGeometry: false,
        sql_queries: {
          approach_summary: "SELECT approach_id, delay_sec, travel_time_sec, queue_length_meters FROM approaches ORDER BY delay_sec DESC"
        }
      },
      dependsOn: 'junctionId',
      validateOptions: {
        expectedColumns: { approach_summary: ['approach_id', 'delay_sec', 'travel_time_sec'] },
      },
    }
  ],

  "tomtom-junction-archive": [
    {
      name: 'Get junction archive data',
      params: {
        junctionIds: ['{{capturedJunctionId}}'],
        from: recentDates.from,
        to: recentDates.to,
        sql_queries: {
          avg_delay: "SELECT approach_id, ROUND(AVG(delay_sec), 2) as avg_delay FROM approaches GROUP BY approach_id ORDER BY avg_delay DESC"
        }
      },
      dependsOn: 'junctionId',
      validateOptions: {
        expectedColumns: { avg_delay: ['approach_id', 'avg_delay'] },
      },
    }
  ],

  "tomtom-route-monitoring-details": [
    {
      name: 'Get detailed route analysis with SQL',
      params: {
        routeIds: ['{{capturedRouteId}}'],
        sql_queries: {
          route_summary: "SELECT route_name, travel_time, delay_time, ROUND(route_confidence, 2) as confidence FROM route_info",
          slow_segments: "SELECT segment_id, current_speed, typical_speed FROM segments WHERE current_speed < typical_speed * 0.7 ORDER BY current_speed LIMIT 10"
        }
      },
      dependsOn: 'routeId',
      validateOptions: {
        expectedColumns: { route_summary: ['route_name', 'travel_time', 'delay_time', 'confidence'] },
        expectNonEmpty: ['route_summary'],
      },
    }
  ],

};

// ============================================================================
// VALIDATORS — Tool-specific post-processing + ID capture
// ============================================================================

const validators = {
  "tomtom-junction-search": (result, scenario, captured) => {
    const validation = validateSqlFilteredResponse(result, 'tomtom-junction-search', scenario.validateOptions);
    if (validation.valid) {
      captureIdFromResult(result, 'junction_id', 'junctionId', captured);
    }
    return validation;
  },

  "tomtom-route-search": (result, scenario, captured) => {
    const validation = validateSqlFilteredResponse(result, 'tomtom-route-search', scenario.validateOptions);
    if (validation.valid) {
      captureIdFromResult(result, 'route_id', 'routeId', captured);
    }
    return validation;
  },

  "tomtom-traffic-flow-segment": (result, scenario) => {
    return validateSqlFilteredResponse(result, 'tomtom-traffic-flow-segment', scenario.validateOptions);
  },

  "tomtom-traffic-incidents": (result, scenario) => {
    return validateSqlFilteredResponse(result, 'tomtom-traffic-incidents', scenario.validateOptions);
  },

  "tomtom-area-analytics-stats": (result, scenario) => {
    return validateSqlFilteredResponse(result, 'tomtom-area-analytics-stats', scenario.validateOptions);
  },

  "tomtom-junction-live-data": (result, scenario) => {
    return validateSqlFilteredResponse(result, 'tomtom-junction-live-data', scenario.validateOptions);
  },

  "tomtom-junction-archive": (result, scenario) => {
    return validateSqlFilteredResponse(result, 'tomtom-junction-archive', scenario.validateOptions);
  },

  "tomtom-route-monitoring-details": (result, scenario) => {
    return validateSqlFilteredResponse(result, 'tomtom-route-monitoring-details', scenario.validateOptions);
  },

};

/**
 * Extract an ID from the first query result to use in Phase 2 tests
 */
function captureIdFromResult(result, columnName, captureKey, captured) {
  try {
    const data = parseResponse(result);
    for (const [, queryResult] of Object.entries(data.aggregated_data || {})) {
      if (queryResult && queryResult.columns && queryResult.rows) {
        const idIdx = queryResult.columns.indexOf(columnName);
        if (idIdx >= 0 && queryResult.rows.length > 0 && queryResult.rows[0][idIdx]) {
          captured[captureKey] = String(queryResult.rows[0][idIdx]);
          return;
        }
      }
    }
  } catch { /* ignore capture errors */ }
}

// ============================================================================
// TEST RESULTS TRACKER
// ============================================================================

class TestResults {
  constructor() {
    this.results = [];
    this.passed = 0;
    this.failed = 0;
    this.skipped = 0;
  }

  addResult(toolName, name, status, message, duration = null) {
    this.results.push({ toolName, name, status, message, duration });

    const icon = status === 'PASS' ? '  PASS' : status === 'FAIL' ? '  FAIL' : '  SKIP';
    const durStr = duration ? ` (${duration}ms)` : '';
    console.log(`${icon} ${name} - ${message}${durStr}`);

    if (status === 'PASS') this.passed++;
    else if (status === 'FAIL') this.failed++;
    else this.skipped++;
  }

  printSummary() {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`TEST SUMMARY: ${this.passed + this.failed + this.skipped} tests`);
    console.log(`${'='.repeat(60)}`);
    console.log(`  Passed:  ${this.passed}`);
    console.log(`  Failed:  ${this.failed}`);
    console.log(`  Skipped: ${this.skipped}`);
    console.log(`${'='.repeat(60)}`);

    if (this.failed > 0) {
      console.log('\nFailed tests:');
      this.results
        .filter(r => r.status === 'FAIL')
        .forEach(r => console.log(`  - ${r.toolName}: ${r.message}`));
    }
  }
}

// ============================================================================
// MAIN
// ============================================================================

async function main() {
  const startTime = Date.now();

  console.log(`Found server at: ${serverPath}`);
  console.log('Starting MCP server and connecting...');

  const client = new McpClient({
    name: "tomtom-traffic-analytics-mcp-test",
    version: "1.0.0"
  });

  const transport = new StdioClientTransport({
    command: 'node',
    args: [serverPath],
    env: { ...process.env }
  });

  await client.connect(transport);
  console.log('Connected to MCP server\n');

  // Get available tools and print metrics
  const toolsResponse = await client.listTools();
  const availableTools = toolsResponse.tools.map(t => t.name);
  console.log(`Available tools (${availableTools.length}): ${availableTools.join(', ')}\n`);

  // Always print token metrics
  printToolMetrics(toolsResponse);

  // If --metrics-only, exit here
  if (METRICS_ONLY) {
    console.log('--metrics-only mode: skipping tests');
    await client.close();
    process.exit(0);
  }

  // Captured IDs from Phase 1 for use in Phase 2
  const captured = {
    junctionId: null,
    routeId: null,
    segmentId: null,
  };

  const results = new TestResults();

  // Determine which tools to test
  let toolsToTest = TEST_TOOL ? [TEST_TOOL] : TEST_EXECUTION_ORDER;

  for (const toolName of toolsToTest) {
    const scenarios = COMPREHENSIVE_TEST_SCENARIOS[toolName];
    if (!scenarios) {
      results.addResult(toolName, 'setup', 'SKIP', `No test scenarios defined`);
      continue;
    }

    console.log(`\n${toolName.toUpperCase()}`);
    console.log('-'.repeat(40));

    if (!availableTools.includes(toolName)) {
      results.addResult(toolName, 'availability', 'FAIL', `Tool not available on server`);
      continue;
    }

    for (const scenario of scenarios) {
      // Check dependencies
      if (scenario.dependsOn) {
        const depValue = captured[scenario.dependsOn];
        if (!depValue) {
          results.addResult(toolName, scenario.name, 'SKIP', `No ${scenario.dependsOn} captured from Phase 1`);
          continue;
        }
      }

      const t0 = Date.now();

      try {
        // Substitute captured IDs into params
        let testParams = JSON.parse(JSON.stringify(scenario.params));
        testParams = substituteParams(testParams, captured);

        if (VERBOSE) {
          console.log(`    Params: ${JSON.stringify(testParams, null, 2)}`);
        }

        const result = await client.callTool({
          name: toolName,
          arguments: testParams
        });

        const duration = Date.now() - t0;

        if (VERBOSE) {
          try {
            const text = result.content?.[0]?.text;
            if (text) {
              const parsed = JSON.parse(text);
              console.log(`    Response: ${JSON.stringify(parsed, null, 2).substring(0, 500)}...`);
            }
          } catch { /* ignore */ }
        }

        // Validate
        const validator = validators[toolName];
        if (validator) {
          const validation = validator(result, scenario, captured);
          results.addResult(toolName, scenario.name, validation.valid ? 'PASS' : 'FAIL', validation.message, duration);
        } else {
          results.addResult(toolName, scenario.name, 'PASS', 'No validator (response received)', duration);
        }
      } catch (error) {
        const duration = Date.now() - t0;
        results.addResult(toolName, scenario.name, 'FAIL', `Error: ${error.message}`, duration);
      }
    }
  }

  // Summary
  results.printSummary();

  const totalTime = Date.now() - startTime;
  console.log(`\nTotal execution time: ${(totalTime / 1000).toFixed(1)}s`);

  // Print token metrics at the end too
  printToolMetrics(toolsResponse);

  // Clean shutdown
  await client.close();
  process.exit(results.failed > 0 ? 1 : 0);
}

/**
 * Replace {{capturedXxx}} placeholders in params with actual captured values
 */
function substituteParams(params, captured) {
  const json = JSON.stringify(params);
  const substituted = json
    .replace(/"\{\{capturedJunctionId\}\}"/g, captured.junctionId ? `"${captured.junctionId}"` : '"MISSING_JUNCTION_ID"')
    .replace(/"\{\{capturedRouteId\}\}"/g, captured.routeId ? `"${captured.routeId}"` : '"MISSING_ROUTE_ID"')
    .replace(/"\{\{capturedSegmentId\}\}"/g, captured.segmentId ? `"${captured.segmentId}"` : '"MISSING_SEGMENT_ID"');
  return JSON.parse(substituted);
}

// Handle signals
process.on('SIGINT', () => { console.log('\nInterrupted'); process.exit(1); });
process.on('SIGTERM', () => { console.log('\nTerminated'); process.exit(1); });

main().catch(err => {
  console.error(`Unhandled error: ${err.message}`);
  if (VERBOSE) console.error(err.stack);
  process.exit(1);
});
