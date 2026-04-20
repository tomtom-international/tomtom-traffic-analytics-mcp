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

import { describe, it, expect, vi, beforeEach } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createRouteMonitoringTools } from "./routeMonitoring";

// Mock the handler module
vi.mock("../handlers/routeMonitoringHandler", () => ({
  createRouteMonitoringHandlers: () => ({
    searchRoutes: vi.fn(),
    getRouteDetails: vi.fn(),
  }),
}));

describe("Route Monitoring Tools", () => {
  let mockServer: McpServer;

  beforeEach(() => {
    mockServer = {
      registerTool: vi.fn(),
    } as any;
  });

  it("should register 2 route monitoring tools", () => {
    createRouteMonitoringTools(mockServer);

    expect(mockServer.registerTool).toHaveBeenCalledTimes(2);

    const toolCalls = (mockServer.registerTool as any).mock.calls;
    const toolNames = toolCalls.map((call: any) => call[0]);

    expect(toolNames).toContain("tomtom-route-search");
    expect(toolNames).toContain("tomtom-route-monitoring-details");
  });

  it("should register tools with correct descriptions", () => {
    createRouteMonitoringTools(mockServer);

    const toolCalls = (mockServer.registerTool as any).mock.calls;

    const searchToolCall = toolCalls.find((call: any) => call[0] === "tomtom-route-search");
    expect(searchToolCall[1].description).toContain("Search and filter");

    const detailsToolCall = toolCalls.find(
      (call: any) => call[0] === "tomtom-route-monitoring-details"
    );
    expect(detailsToolCall[1].description).toContain("detailed segment-level");
  });

  it("should register tools with correct schemas and handlers", () => {
    createRouteMonitoringTools(mockServer);

    const toolCalls = (mockServer.registerTool as any).mock.calls;

    toolCalls.forEach((call: any) => {
      expect(typeof call[1].description).toBe("string"); // description
      expect(typeof call[1].inputSchema).toBe("object"); // schema
      expect(typeof call[2]).toBe("function"); // handler
    });
  });
});
