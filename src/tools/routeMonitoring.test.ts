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

// Mock the handler module
vi.mock("../handlers/routeMonitoringHandler", () => ({
  createRouteMonitoringHandlers: () => ({
    searchRoutes: vi.fn(),
    getRouteDetails: vi.fn(),
  }),
}));

const mockRegisterAppTool = vi.fn();
vi.mock("@modelcontextprotocol/ext-apps/server", () => ({
  registerAppTool: mockRegisterAppTool,
  RESOURCE_URI_META_KEY: "ui/resourceUri",
}));

const mockRegisterAppResourceFromPath = vi.fn();
vi.mock("./helpers/resourceRegistry", () => ({
  registerAppResourceFromPath: mockRegisterAppResourceFromPath,
}));

const { createRouteMonitoringTools } = await import("./routeMonitoring");

describe("Route Monitoring Tools", () => {
  let mockServer: McpServer;

  beforeEach(() => {
    vi.clearAllMocks();
    mockServer = {
      registerTool: vi.fn(),
    } as any;
  });

  it("should register 2 route monitoring tools", () => {
    createRouteMonitoringTools(mockServer);

    // Both tools are bound to the MCP app via registerAppTool
    expect(mockServer.registerTool).not.toHaveBeenCalled();
    expect(mockRegisterAppTool).toHaveBeenCalledTimes(2);

    const toolNames = mockRegisterAppTool.mock.calls.map((call: any) => call[1]);

    expect(toolNames).toContain("tomtom-route-search");
    expect(toolNames).toContain("tomtom-route-monitoring-details");
  });

  it("should register tools with correct descriptions", () => {
    createRouteMonitoringTools(mockServer);

    const searchToolCall = mockRegisterAppTool.mock.calls.find(
      (call: any) => call[1] === "tomtom-route-search"
    );
    expect(searchToolCall[2].description).toContain("Search and filter");

    const detailsToolCall = mockRegisterAppTool.mock.calls.find(
      (call: any) => call[1] === "tomtom-route-monitoring-details"
    );
    expect(detailsToolCall[2].description).toContain("detailed segment-level");
  });

  it("should register tools with correct schemas and handlers", () => {
    createRouteMonitoringTools(mockServer);

    mockRegisterAppTool.mock.calls.forEach((call: any) => {
      expect(typeof call[2].description).toBe("string");
      expect(typeof call[2].inputSchema).toBe("object");
      expect(typeof call[3]).toBe("function");
    });
  });

  it("should register route-search tool via registerAppTool bound to the app resource", () => {
    createRouteMonitoringTools(mockServer);

    const call = mockRegisterAppTool.mock.calls.find((c: any) => c[1] === "tomtom-route-search");
    expect(call).toBeDefined();
    if (!call) return;

    const [server, name, config, handler] = call;
    expect(server).toBe(mockServer);
    expect(name).toBe("tomtom-route-search");
    expect(config.inputSchema).toBeDefined();
    expect(typeof handler).toBe("function");

    expect(config._meta["ui/resourceUri"]).toBe(
      "ui://tomtom-traffic-analytics/route-details/app.html"
    );

    // Should never be registered via the plain server.registerTool
    expect(
      (mockServer.registerTool as any).mock.calls.some((c: any) => c[0] === "tomtom-route-search")
    ).toBe(false);
  });

  it("should register the route-details app resource exactly once", () => {
    createRouteMonitoringTools(mockServer);

    expect(mockRegisterAppResourceFromPath).toHaveBeenCalledTimes(1);
    expect(mockRegisterAppResourceFromPath).toHaveBeenCalledWith(
      mockServer,
      "ui://tomtom-traffic-analytics/route-details/app.html",
      "traffic-analytics",
      "route-details"
    );
  });

  it("should register tomtom-route-monitoring-details via registerAppTool bound to the same app resource", () => {
    createRouteMonitoringTools(mockServer);

    const call = mockRegisterAppTool.mock.calls.find(
      (c: any) => c[1] === "tomtom-route-monitoring-details"
    );
    expect(call).toBeDefined();
    if (!call) return;

    const [server, name, config, handler] = call;
    expect(server).toBe(mockServer);
    expect(name).toBe("tomtom-route-monitoring-details");
    expect(config.inputSchema).toBeDefined();
    expect(typeof handler).toBe("function");

    expect(config._meta["ui/resourceUri"]).toBe(
      "ui://tomtom-traffic-analytics/route-details/app.html"
    );

    // Should never be registered via the plain server.registerTool
    expect(
      (mockServer.registerTool as any).mock.calls.some(
        (c: any) => c[0] === "tomtom-route-monitoring-details"
      )
    ).toBe(false);
  });
});
