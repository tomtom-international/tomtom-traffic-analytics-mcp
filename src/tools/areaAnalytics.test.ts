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
vi.mock("../handlers/areaAnalyticsHandler", () => ({
  getAreaAnalyticsStatsHandler: vi.fn(() => vi.fn()),
}));

// Mock the service functions
vi.mock("../services/area-analytics/areaAnalyticsService", () => ({
  getAreaAnalyticsStats: vi.fn(),
}));

const mockRegisterAppTool = vi.fn();
vi.mock("@modelcontextprotocol/ext-apps/server", () => ({
  registerAppTool: mockRegisterAppTool,
  RESOURCE_URI_META_KEY: "ui/resourceUri",
}));

const mockRegisterTrafficAnalyticsApp = vi.fn(
  (_server: unknown, appName: string) => `ui://tomtom-traffic-analytics/${appName}/app.html`
);
vi.mock("./helpers/resourceRegistry", () => ({
  registerTrafficAnalyticsApp: mockRegisterTrafficAnalyticsApp,
}));

const { createAreaAnalyticsTools } = await import("./areaAnalytics");

describe("Area Analytics Tools", () => {
  let mockServer: McpServer;
  let mockRegisterTool: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockRegisterTool = vi.fn();
    mockServer = {
      registerTool: mockRegisterTool,
    } as any;
  });

  it("should register the stats tool via registerAppTool bound to the app resource", () => {
    createAreaAnalyticsTools(mockServer);

    expect(mockRegisterTool).not.toHaveBeenCalled();
    expect(mockRegisterAppTool).toHaveBeenCalledTimes(1);

    const call = mockRegisterAppTool.mock.calls.find((c) => c[1] === "tomtom-area-analytics-stats");
    expect(call).toBeDefined();
  });

  it("should register stats tool with appropriate description", () => {
    createAreaAnalyticsTools(mockServer);

    const call = mockRegisterAppTool.mock.calls.find((c) => c[1] === "tomtom-area-analytics-stats");
    expect(call).toBeDefined();
    if (!call) return;

    const [, , config] = call;
    expect(config.description).toContain("historical traffic patterns");
    expect(config.description).toContain("timed_data");
    expect(config.description).toContain("tiled_data");
  });

  it("should register stats tool with proper schema including show_ui", () => {
    createAreaAnalyticsTools(mockServer);

    const call = mockRegisterAppTool.mock.calls.find((c) => c[1] === "tomtom-area-analytics-stats");
    expect(call).toBeDefined();
    if (!call) return;

    const [, , config] = call;
    expect(config.inputSchema).toBeDefined();
    expect(typeof config.inputSchema).toBe("object");
    expect(config.inputSchema.show_ui).toBeDefined();
  });

  it("should register stats tool with handler function", () => {
    createAreaAnalyticsTools(mockServer);

    const call = mockRegisterAppTool.mock.calls.find((c) => c[1] === "tomtom-area-analytics-stats");
    expect(call).toBeDefined();
    if (!call) return;

    const [, , , handler] = call;
    expect(handler).toBeDefined();
    expect(typeof handler).toBe("function");
  });

  it("should bind the tool to the area-analytics app resource URI", () => {
    createAreaAnalyticsTools(mockServer);

    const call = mockRegisterAppTool.mock.calls.find((c) => c[1] === "tomtom-area-analytics-stats");
    expect(call).toBeDefined();
    if (!call) return;

    const [server, , config] = call;
    expect(server).toBe(mockServer);
    expect(config._meta["ui/resourceUri"]).toBe(
      "ui://tomtom-traffic-analytics/area-analytics/app.html"
    );
  });

  it("should register the area-analytics app resource once", () => {
    createAreaAnalyticsTools(mockServer);

    expect(mockRegisterTrafficAnalyticsApp).toHaveBeenCalledTimes(1);
    expect(mockRegisterTrafficAnalyticsApp).toHaveBeenCalledWith(mockServer, "area-analytics");
  });

  it("should follow consistent naming pattern", () => {
    createAreaAnalyticsTools(mockServer);

    const toolNames = mockRegisterAppTool.mock.calls.map((call) => call[1]);
    toolNames.forEach((toolName) => {
      expect(toolName).toMatch(/^tomtom-area-analytics-/);
    });
  });
});
