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
vi.mock("../handlers/junctionAnalyticsHandler", () => ({
  getJunctionSearchHandler: vi.fn(() => vi.fn()),
  getJunctionLiveDataDetailsHandler: vi.fn(() => vi.fn()),
  getJunctionArchiveHandler: vi.fn(() => vi.fn()),
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

const { createJunctionAnalyticsTools } = await import("./junctionAnalytics");

describe("Junction Analytics Tools", () => {
  let mockServer: McpServer;
  let mockRegisterTool: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockRegisterTool = vi.fn();
    mockServer = {
      registerTool: mockRegisterTool,
    } as any;
  });

  it("should register 3 Junction Analytics tools", () => {
    createJunctionAnalyticsTools(mockServer);

    // Search is bound to an MCP app via registerAppTool; live-data and archive stay plain
    expect(mockRegisterTool).toHaveBeenCalledTimes(2);
    expect(mockRegisterAppTool).toHaveBeenCalledTimes(1);

    const toolNames = [
      ...mockRegisterTool.mock.calls.map((call) => call[0]),
      ...mockRegisterAppTool.mock.calls.map((call) => call[1]),
    ];

    expect(toolNames).toContain("tomtom-junction-search");
    expect(toolNames).toContain("tomtom-junction-live-data");
    expect(toolNames).toContain("tomtom-junction-archive");
  });

  it("should register junction-search tool via registerAppTool bound to the app resource", () => {
    createJunctionAnalyticsTools(mockServer);

    const call = mockRegisterAppTool.mock.calls.find((c) => c[1] === "tomtom-junction-search");
    expect(call).toBeDefined();
    if (!call) return;

    const [server, name, config, handler] = call;
    expect(server).toBe(mockServer);
    expect(name).toBe("tomtom-junction-search");
    expect(config.inputSchema).toBeDefined();
    expect(typeof handler).toBe("function");

    expect(config._meta["ui/resourceUri"]).toBe(
      "ui://tomtom-traffic-analytics/junction-live/app.html"
    );

    // Should never be registered via the plain server.registerTool
    expect(mockRegisterTool.mock.calls.some((c) => c[0] === "tomtom-junction-search")).toBe(false);
  });

  it("should register the junction-live app resource exactly once", () => {
    createJunctionAnalyticsTools(mockServer);

    expect(mockRegisterAppResourceFromPath).toHaveBeenCalledTimes(1);
    expect(mockRegisterAppResourceFromPath).toHaveBeenCalledWith(
      mockServer,
      "ui://tomtom-traffic-analytics/junction-live/app.html",
      "traffic-analytics",
      "junction-live"
    );
  });

  it("should register tools with correct schemas", () => {
    createJunctionAnalyticsTools(mockServer);

    const plainToolCalls = mockRegisterTool.mock.calls;
    plainToolCalls.forEach((call: any) => {
      expect(typeof call[1].description).toBe("string"); // description
      expect(typeof call[1].inputSchema).toBe("object"); // schema
      expect(typeof call[2]).toBe("function"); // handler
    });

    const appToolCall = mockRegisterAppTool.mock.calls.find(
      (c: any) => c[1] === "tomtom-junction-search"
    );
    expect(appToolCall).toBeDefined();
    expect(typeof appToolCall[2].description).toBe("string");
    expect(typeof appToolCall[2].inputSchema).toBe("object");
    expect(typeof appToolCall[3]).toBe("function");
  });

  it("should register tools with proper descriptions", () => {
    createJunctionAnalyticsTools(mockServer);

    const plainToolCalls = mockRegisterTool.mock.calls;
    plainToolCalls.forEach((call: any) => {
      expect(typeof call[1].description).toBe("string");
      expect(call[1].description.length).toBeGreaterThan(10);
    });

    const searchToolCall = mockRegisterAppTool.mock.calls.find(
      (c: any) => c[1] === "tomtom-junction-search"
    );
    expect(searchToolCall[2].description).toContain("Search and filter");

    const liveDataToolCall = plainToolCalls.find(
      (call: any) => call[0] === "tomtom-junction-live-data"
    );
    expect(liveDataToolCall[1].description.toLowerCase()).toContain("real-time traffic");

    const archiveToolCall = plainToolCalls.find(
      (call: any) => call[0] === "tomtom-junction-archive"
    );
    expect(archiveToolCall[1].description).toContain("historical");
  });

  it("should keep tomtom-junction-archive on the plain server.registerTool", () => {
    createJunctionAnalyticsTools(mockServer);

    const toolNames = mockRegisterTool.mock.calls.map((call: any) => call[0]);
    expect(toolNames).toContain("tomtom-junction-archive");
    expect(
      mockRegisterAppTool.mock.calls.some((c: any) => c[1] === "tomtom-junction-archive")
    ).toBe(false);
  });

  it("should keep tomtom-junction-live-data on the plain server.registerTool", () => {
    createJunctionAnalyticsTools(mockServer);

    const toolNames = mockRegisterTool.mock.calls.map((call: any) => call[0]);
    expect(toolNames).toContain("tomtom-junction-live-data");
    expect(
      mockRegisterAppTool.mock.calls.some((c: any) => c[1] === "tomtom-junction-live-data")
    ).toBe(false);
  });

  it("should categorize tools correctly", () => {
    createJunctionAnalyticsTools(mockServer);

    const toolNames = [
      ...mockRegisterTool.mock.calls.map((call: any) => call[0]),
      ...mockRegisterAppTool.mock.calls.map((call: any) => call[1]),
    ];

    // Live data tools
    const liveDataTools = toolNames.filter((name: string) => name.includes("live-data"));
    expect(liveDataTools).toHaveLength(1);

    // Archive tools
    const archiveTools = toolNames.filter((name: string) => name.includes("archive"));
    expect(archiveTools).toHaveLength(1);

    // Search tool
    const searchTools = toolNames.filter((name: string) => name.includes("junction-search"));
    expect(searchTools).toHaveLength(1);
  });
});
