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
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

const mockGetEffectiveApiKey = vi.fn();
const mockGetEffectiveMovePortalKey = vi.fn();
const mockGetVizData = vi.fn();
const mockGetJunctionLiveData = vi.fn();

type ToolResponse = {
  content: { type: string; text: string }[];
  isError: boolean;
};
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const registeredHandlers: Record<string, (...args: any[]) => Promise<ToolResponse> | ToolResponse> =
  {};
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const registeredCalls: any[] = [];
const mockRegisterAppTool = vi.fn(
  (
    _server: unknown,
    name: string,
    opts: unknown,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    handler: (...args: any[]) => Promise<ToolResponse> | ToolResponse
  ) => {
    registeredHandlers[name] = handler;
    registeredCalls.push({ name, opts });
  }
);

vi.mock("@modelcontextprotocol/ext-apps/server", () => ({
  registerAppTool: mockRegisterAppTool,
}));

vi.mock("../services/base/tomtomClient", () => ({
  getEffectiveApiKey: mockGetEffectiveApiKey,
  getEffectiveMovePortalKey: mockGetEffectiveMovePortalKey,
}));

vi.mock("../services/cache/vizCache", () => ({
  getVizData: mockGetVizData,
}));

vi.mock("../services/junction-analytics/junctionAnalyticsService", () => ({
  getJunctionLiveData: mockGetJunctionLiveData,
}));

const { createAppTools } = await import("./appTools");

describe("createAppTools", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.keys(registeredHandlers).forEach((k) => delete registeredHandlers[k]);
    registeredCalls.length = 0;
  });

  it("should register exactly 3 app tools with app-only visibility metadata", () => {
    const mockServer = {} as McpServer;
    createAppTools(mockServer);

    expect(mockRegisterAppTool).toHaveBeenCalledTimes(3);
    expect(registeredHandlers["tomtom-get-api-key"]).toBeDefined();
    expect(registeredHandlers["tomtom-get-viz-data"]).toBeDefined();
    expect(registeredHandlers["tomtom-get-junction-live"]).toBeDefined();

    for (const call of mockRegisterAppTool.mock.calls) {
      const options = call[2] as Record<string, unknown>;
      expect(options).toHaveProperty("title");
      expect(options).toHaveProperty("description");
      expect(options).toHaveProperty("inputSchema");
      expect((options._meta as Record<string, unknown>).ui).toEqual({ visibility: ["app"] });
    }
  });

  it("declares tomtom-get-viz-data inputSchema with a viz_id string field", () => {
    const mockServer = {} as McpServer;
    createAppTools(mockServer);

    const call = registeredCalls.find((c) => c.name === "tomtom-get-viz-data");
    expect(call).toBeDefined();
    const inputSchema = call.opts.inputSchema as Record<string, unknown>;
    expect(inputSchema).toHaveProperty("viz_id");
  });

  describe("tomtom-get-api-key handler", () => {
    it("returns the API key when available and never touches the Move Portal key", async () => {
      const mockServer = {} as McpServer;
      createAppTools(mockServer);
      mockGetEffectiveApiKey.mockReturnValue("test-api-key-123");

      const response = await registeredHandlers["tomtom-get-api-key"]();

      expect(response.isError).toBe(false);
      expect(response.content[0].text).toBe("test-api-key-123");
      expect(mockGetEffectiveMovePortalKey).not.toHaveBeenCalled();
    });

    it("returns an isError result when the API key is not available", async () => {
      const mockServer = {} as McpServer;
      createAppTools(mockServer);
      mockGetEffectiveApiKey.mockReturnValue(undefined);

      const response = await registeredHandlers["tomtom-get-api-key"]();

      expect(response.isError).toBe(true);
      expect(response.content[0].text).toContain("not available");
      expect(mockGetEffectiveMovePortalKey).not.toHaveBeenCalled();
    });
  });

  describe("tomtom-get-viz-data handler", () => {
    it("returns cached visualization data for a known id", async () => {
      const mockServer = {} as McpServer;
      createAppTools(mockServer);
      const fakeData = { geojson: { type: "FeatureCollection", features: [] } };
      mockGetVizData.mockReturnValue(fakeData);

      const response = await registeredHandlers["tomtom-get-viz-data"]({ viz_id: "abc-123" });

      expect(response.isError).toBe(false);
      expect(JSON.parse(response.content[0].text)).toEqual(fakeData);
    });

    it("returns an isError result for an unknown/expired id", async () => {
      const mockServer = {} as McpServer;
      createAppTools(mockServer);
      mockGetVizData.mockReturnValue(undefined);

      const response = await registeredHandlers["tomtom-get-viz-data"]({ viz_id: "expired-id" });

      expect(response.isError).toBe(true);
      expect(response.content[0].text).toContain("not found");
    });
  });

  describe("tomtom-get-junction-live handler", () => {
    it("fetches live data for each junction id and returns the raw JSON", async () => {
      const mockServer = {} as McpServer;
      createAppTools(mockServer);
      mockGetJunctionLiveData.mockImplementation((id: string) =>
        Promise.resolve({ id, approachesLiveData: [] })
      );

      const response = await registeredHandlers["tomtom-get-junction-live"]({
        junctionIds: ["j1", "j2"],
      });

      expect(mockGetJunctionLiveData).toHaveBeenCalledTimes(2);
      expect(mockGetJunctionLiveData).toHaveBeenCalledWith("j1");
      expect(response.isError).toBe(false);
      expect(JSON.parse(response.content[0].text)).toEqual({
        junctions: [
          { id: "j1", approachesLiveData: [] },
          { id: "j2", approachesLiveData: [] },
        ],
      });
    });

    it("returns isError when the service throws (e.g. missing Move Portal key)", async () => {
      const mockServer = {} as McpServer;
      createAppTools(mockServer);
      mockGetJunctionLiveData.mockRejectedValue(new Error("TOMTOM_MOVE_PORTAL_KEY is not set"));

      const response = await registeredHandlers["tomtom-get-junction-live"]({
        junctionIds: ["j1"],
      });

      expect(response.isError).toBe(true);
      expect(response.content[0].text).toContain("TOMTOM_MOVE_PORTAL_KEY");
    });
  });
});
