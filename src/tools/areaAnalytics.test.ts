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
import { createAreaAnalyticsTools } from "./areaAnalytics";

describe("Area Analytics Tools", () => {
  let mockServer: McpServer;
  let mockRegisterTool: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockRegisterTool = vi.fn();
    mockServer = {
      registerTool: mockRegisterTool,
    } as any;
  });

  it("should register only the stats tool", () => {
    createAreaAnalyticsTools(mockServer);

    expect(mockRegisterTool).toHaveBeenCalledTimes(1);

    const toolCalls = mockRegisterTool.mock.calls;
    expect(toolCalls[0][0]).toBe("tomtom-area-analytics-stats");
  });

  it("should register stats tool with appropriate description", () => {
    createAreaAnalyticsTools(mockServer);

    const toolCalls = mockRegisterTool.mock.calls;
    expect(toolCalls[0][1].description).toContain("historical traffic patterns");
    expect(toolCalls[0][1].description).toContain("sql_queries");
  });

  it("should register stats tool with proper schema", () => {
    createAreaAnalyticsTools(mockServer);

    const toolCalls = mockRegisterTool.mock.calls;
    expect(toolCalls[0][1].inputSchema).toBeDefined();
    expect(typeof toolCalls[0][1].inputSchema).toBe("object");
  });

  it("should register stats tool with handler function", () => {
    createAreaAnalyticsTools(mockServer);

    const toolCalls = mockRegisterTool.mock.calls;
    expect(toolCalls[0][2]).toBeDefined();
    expect(typeof toolCalls[0][2]).toBe("function");
  });

  it("should follow consistent naming pattern", () => {
    createAreaAnalyticsTools(mockServer);

    const toolCalls = mockRegisterTool.mock.calls;
    expect(toolCalls[0][0]).toMatch(/^tomtom-area-analytics-/);
  });
});
