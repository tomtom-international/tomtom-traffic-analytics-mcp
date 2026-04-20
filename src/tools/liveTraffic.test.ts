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
import { createLiveTrafficTools } from "./liveTraffic";

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

describe("Live Traffic Tools", () => {
  let mockServer: McpServer;
  let mockRegisterTool: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockRegisterTool = vi.fn();
    mockServer = {
      registerTool: mockRegisterTool,
    } as any;
  });

  it("should register traffic tools", () => {
    createLiveTrafficTools(mockServer);

    // Expect 2 tools to be registered
    expect(mockRegisterTool).toHaveBeenCalledTimes(2);

    const toolNames = mockRegisterTool.mock.calls.map((call) => call[0]);
    expect(toolNames).toContain("tomtom-traffic-flow-segment");
    expect(toolNames).toContain("tomtom-traffic-incidents");
  });

  it("should register traffic incidents tool with correct configuration", () => {
    createLiveTrafficTools(mockServer);

    const call = mockRegisterTool.mock.calls.find((c) => c[0] === "tomtom-traffic-incidents");
    expect(call).toBeDefined();
    if (!call) return;

    const [name, config, handler] = call;

    expect(name).toBe("tomtom-traffic-incidents");
    expect(config.description).toContain("incidents");
    expect(config.description).toContain("traffic");

    expect(config.inputSchema).toBeDefined();
    expect(config.inputSchema.bboxes).toBeDefined();
    expect(config.inputSchema.categoryFilter).toBeDefined();

    expect(handler).toBeDefined();
    expect(typeof handler).toBe("function");
  });

  describe("Tool Naming Convention", () => {
    it("should follow consistent naming pattern", () => {
      createLiveTrafficTools(mockServer);

      mockRegisterTool.mock.calls.forEach((call) => {
        const toolName = call[0];
        expect(toolName).toMatch(/^tomtom-traffic-/);
      });
    });
  });
});
