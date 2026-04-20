/*
 * Copyright (C) 2025 TomTom NV
 * Licensed under the Apache License, Version 2.0
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createHttpServer, type HttpServerResult } from "./indexHttp";
import { VERSION } from "./version";

/** Small delay to ensure SSE responses complete before shutdown */
// eslint-disable-next-line no-undef
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const TEST_API_KEY = "test-api-key";
const TEST_MOVE_PORTAL_KEY = "test-move-portal-key";

interface ToolsListResponse {
  jsonrpc: string;
  id: number;
  result?: {
    tools: Array<{ name: string }>;
  };
}

interface HealthResponse {
  status: string;
  version: string;
}

/** Helper to parse SSE response */
function parseSSEResponse<T>(text: string): T {
  const dataLine = text.split("\n").find((line) => line.startsWith("data: "));
  if (!dataLine) {
    throw new Error(`No data line in SSE response: ${text}`);
  }
  return JSON.parse(dataLine.slice(6));
}

/** Helper to POST MCP tools/list request */
async function postMcpListTools(port: number, headers?: Record<string, string>) {
  const defaultHeaders: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json,text/event-stream",
    Connection: "close",
    "tomtom-api-key": TEST_API_KEY,
    "tomtom-move-portal-key": TEST_MOVE_PORTAL_KEY,
  };

  return await fetch(`http://localhost:${port}/mcp`, {
    method: "POST",
    headers: { ...defaultHeaders, ...headers },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }),
  });
}

/** Helper to call health endpoint */
async function getHealth(port: number): Promise<HealthResponse> {
  const response = await fetch(`http://localhost:${port}/health`);
  return response.json();
}

describe("HTTP Server Integration", () => {
  let serverResult: HttpServerResult;
  const TEST_PORT = 3991;

  // Save and set env vars for integration tests
  const originalEnv = { ...process.env };

  beforeAll(async () => {
    process.env.TOMTOM_MOVE_PORTAL_KEY = TEST_MOVE_PORTAL_KEY;
    process.env.TOMTOM_API_KEY = TEST_API_KEY;
    serverResult = await createHttpServer({
      port: TEST_PORT,
    });
  });

  afterAll(async () => {
    await delay(50);
    await serverResult.shutdown();
    process.env = { ...originalEnv };
  });

  beforeEach(async () => {
    await delay(100);
  });

  describe("health endpoint", () => {
    it("returns status ok with correct shape", async () => {
      const health = await getHealth(TEST_PORT);

      expect(health.status).toBe("ok");
      expect(health.version).toBe(VERSION);
    });
  });

  describe("tools/list via MCP protocol", () => {
    it("returns expected tool names", async () => {
      const response = await postMcpListTools(TEST_PORT);
      const result = parseSSEResponse<ToolsListResponse>(await response.text());

      expect(result.result?.tools).toBeDefined();
      expect(result.result!.tools.length).toBeGreaterThan(0);

      const toolNames = result.result!.tools.map((t) => t.name);
      expect(toolNames).toContain("tomtom-area-analytics-stats");
      expect(toolNames).toContain("tomtom-junction-search");
      expect(toolNames).toContain("tomtom-junction-live-data");
      expect(toolNames).toContain("tomtom-junction-archive");
      expect(toolNames).toContain("tomtom-route-search");
      expect(toolNames).toContain("tomtom-route-monitoring-details");
      expect(toolNames).toContain("tomtom-traffic-flow-segment");
      expect(toolNames).toContain("tomtom-traffic-incidents");
    });
  });

  describe("auth", () => {
    it("succeeds with env var fallback (no headers)", async () => {
      const response = await fetch(`http://localhost:${TEST_PORT}/mcp`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json,text/event-stream",
          Connection: "close",
        },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }),
      });

      // Should succeed because env vars are set
      expect(response.status).toBe(200);
    });
  });

  describe("error handling", () => {
    it("GET /mcp returns 405", async () => {
      const response = await fetch(`http://localhost:${TEST_PORT}/mcp`);
      expect(response.status).toBe(405);
    });
  });
});
