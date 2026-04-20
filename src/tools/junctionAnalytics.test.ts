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
import { createJunctionAnalyticsTools } from "./junctionAnalytics";

// Mock the MCP server
const mockServer = {
  registerTool: vi.fn(),
} as unknown as McpServer;

describe("Junction Analytics Tools", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should register 3 Junction Analytics tools", () => {
    createJunctionAnalyticsTools(mockServer);

    expect(mockServer.registerTool).toHaveBeenCalledTimes(3);

    const toolCalls = (mockServer.registerTool as any).mock.calls;
    const toolNames = toolCalls.map((call: any) => call[0]);

    expect(toolNames).toContain("tomtom-junction-search");
    expect(toolNames).toContain("tomtom-junction-live-data");
    expect(toolNames).toContain("tomtom-junction-archive");
  });

  it("should register tools with correct schemas", () => {
    createJunctionAnalyticsTools(mockServer);

    const toolCalls = (mockServer.registerTool as any).mock.calls;

    toolCalls.forEach((call: any) => {
      expect(typeof call[1].description).toBe("string"); // description
      expect(typeof call[1].inputSchema).toBe("object"); // schema
      expect(typeof call[2]).toBe("function"); // handler
    });
  });

  it("should register tools with proper descriptions", () => {
    createJunctionAnalyticsTools(mockServer);

    const toolCalls = (mockServer.registerTool as any).mock.calls;

    toolCalls.forEach((call: any) => {
      expect(typeof call[1].description).toBe("string");
      expect(call[1].description.length).toBeGreaterThan(10);
    });

    const searchToolCall = toolCalls.find((call: any) => call[0] === "tomtom-junction-search");
    expect(searchToolCall[1].description).toContain("Search and filter");

    const liveDataToolCall = toolCalls.find((call: any) => call[0] === "tomtom-junction-live-data");
    expect(liveDataToolCall[1].description).toContain("real-time traffic");

    const archiveToolCall = toolCalls.find((call: any) => call[0] === "tomtom-junction-archive");
    expect(archiveToolCall[1].description).toContain("historical");
  });

  it("should categorize tools correctly", () => {
    createJunctionAnalyticsTools(mockServer);

    const toolCalls = (mockServer.registerTool as any).mock.calls;
    const toolNames = toolCalls.map((call: any) => call[0]);

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
