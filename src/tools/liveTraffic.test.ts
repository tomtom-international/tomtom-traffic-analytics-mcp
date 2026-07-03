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

// Mock the handler modules
vi.mock("../handlers/liveTrafficHandler", () => ({
  getFlowSegmentDataHandler: vi.fn(() => vi.fn()),
  createTrafficIncidentsHandler: vi.fn(() => vi.fn()),
}));

// Mock the service functions
vi.mock("../services/live-traffic/liveTrafficService", () => ({
  getFlowSegmentData: vi.fn(),
  getTrafficIncidents: vi.fn(),
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

const { createLiveTrafficTools } = await import("./liveTraffic");

describe("Live Traffic Tools", () => {
  let mockServer: McpServer;
  let mockRegisterTool: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockRegisterTool = vi.fn();
    mockServer = {
      registerTool: mockRegisterTool,
    } as any;
  });

  it("should register traffic tools", () => {
    createLiveTrafficTools(mockServer);

    // Flow segment and incidents are both bound to MCP apps via registerAppTool
    expect(mockRegisterTool).toHaveBeenCalledTimes(0);
    expect(mockRegisterAppTool).toHaveBeenCalledTimes(2);

    const toolNames = [
      ...mockRegisterTool.mock.calls.map((call) => call[0]),
      ...mockRegisterAppTool.mock.calls.map((call) => call[1]),
    ];
    expect(toolNames).toContain("tomtom-traffic-flow-segment");
    expect(toolNames).toContain("tomtom-traffic-incidents");
  });

  it("should register traffic-flow-segment tool via registerAppTool bound to the app resource", () => {
    createLiveTrafficTools(mockServer);

    const call = mockRegisterAppTool.mock.calls.find((c) => c[1] === "tomtom-traffic-flow-segment");
    expect(call).toBeDefined();
    if (!call) return;

    const [server, name, config, handler] = call;
    expect(server).toBe(mockServer);
    expect(name).toBe("tomtom-traffic-flow-segment");
    expect(config.inputSchema).toBeDefined();
    expect(typeof handler).toBe("function");

    expect(config._meta["ui/resourceUri"]).toBe(
      "ui://tomtom-traffic-analytics/traffic-flow/app.html"
    );

    // Should never be registered via the plain server.registerTool
    expect(mockRegisterTool.mock.calls.some((c) => c[0] === "tomtom-traffic-flow-segment")).toBe(
      false
    );
  });

  it("should register the traffic-flow app resource once", () => {
    createLiveTrafficTools(mockServer);

    expect(mockRegisterAppResourceFromPath).toHaveBeenCalledWith(
      mockServer,
      "ui://tomtom-traffic-analytics/traffic-flow/app.html",
      "traffic-analytics",
      "traffic-flow"
    );
  });

  it("should register traffic incidents tool via registerAppTool bound to the app resource", () => {
    createLiveTrafficTools(mockServer);

    const call = mockRegisterAppTool.mock.calls.find((c) => c[1] === "tomtom-traffic-incidents");
    expect(call).toBeDefined();
    if (!call) return;

    const [server, name, config, handler] = call;
    expect(server).toBe(mockServer);
    expect(name).toBe("tomtom-traffic-incidents");
    expect(config.description).toContain("incidents");
    expect(config.description).toContain("traffic");

    expect(config.inputSchema).toBeDefined();
    expect(config.inputSchema.bboxes).toBeDefined();
    expect(config.inputSchema.categoryFilter).toBeDefined();
    expect(config.inputSchema.show_ui).toBeDefined();

    expect(config._meta["ui/resourceUri"]).toBe(
      "ui://tomtom-traffic-analytics/traffic-incidents/app.html"
    );

    expect(handler).toBeDefined();
    expect(typeof handler).toBe("function");

    // Never registered via the plain server.registerTool
    expect(mockRegisterTool.mock.calls.some((c) => c[0] === "tomtom-traffic-incidents")).toBe(
      false
    );
  });

  it("should register the traffic-incidents app resource once", () => {
    createLiveTrafficTools(mockServer);

    expect(mockRegisterAppResourceFromPath).toHaveBeenCalledTimes(2);
    expect(mockRegisterAppResourceFromPath).toHaveBeenCalledWith(
      mockServer,
      "ui://tomtom-traffic-analytics/traffic-incidents/app.html",
      "traffic-analytics",
      "traffic-incidents"
    );
  });

  describe("Tool Naming Convention", () => {
    it("should follow consistent naming pattern", () => {
      createLiveTrafficTools(mockServer);

      const allNames = [
        ...mockRegisterTool.mock.calls.map((call) => call[0]),
        ...mockRegisterAppTool.mock.calls.map((call) => call[1]),
      ];
      allNames.forEach((toolName) => {
        expect(toolName).toMatch(/^tomtom-traffic-/);
      });
    });
  });
});
