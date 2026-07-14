/*
 * Copyright (C) 2025 TomTom NV
 * Licensed under the Apache License, Version 2.0
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const mockSqlEngine = {
  initialize: vi.fn().mockResolvedValue([]),
  executeQueries: vi.fn().mockResolvedValue({
    test_query: { columns: ["col1"], rows: [["val1"]], rowCount: 1 },
  }),
  getTableRowCounts: vi.fn().mockReturnValue({ routes: 3 }),
  close: vi.fn(),
};

vi.mock("../sql", () => ({
  SqlFilterEngine: vi.fn(function () {
    return mockSqlEngine;
  }),
  flattenRouteList: vi
    .fn()
    .mockReturnValue({ tables: new Map([["routes", [{ route_id: "r1" }]]]) }),
  flattenRouteMonitoringDetails: vi
    .fn()
    .mockReturnValue({ tables: new Map([["segments", [{ segment_id: "s1" }]]]) }),
  ROUTE_LIST_SCHEMA: [{ name: "routes", columns: [] }],
  ROUTE_MONITORING_SCHEMA: [
    { name: "route_info", columns: [] },
    { name: "segments", columns: [] },
  ],
}));

vi.mock("../services/route-monitoring/routeMonitoringService", () => ({
  getRoutes: vi.fn().mockResolvedValue([
    { routeId: 1, routeName: "Route A" },
    { routeId: 2, routeName: "Route B" },
  ]),
  getRouteDetails: vi.fn().mockResolvedValue({ detailedSegments: [{ segmentId: "s1" }] }),
}));

vi.mock("../utils/logger", () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

const { mockStoreVizData } = vi.hoisted(() => ({
  mockStoreVizData: vi.fn(() => "test-viz-id"),
}));
vi.mock("../services/cache/vizCache", () => ({
  storeVizData: mockStoreVizData,
}));

import { createRouteMonitoringHandlers } from "./routeMonitoringHandler";
import { getRoutes, getRouteDetails } from "../services/route-monitoring/routeMonitoringService";
import { logger } from "../utils/logger";

describe("routeMonitoringHandler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSqlEngine.initialize.mockResolvedValue([]);
    mockSqlEngine.executeQueries.mockResolvedValue({
      test_query: { columns: ["col1"], rows: [["val1"]], rowCount: 1 },
    });
    mockSqlEngine.getTableRowCounts.mockReturnValue({ routes: 3 });
    mockStoreVizData.mockReturnValue("test-viz-id");
  });

  const handlers = createRouteMonitoringHandlers();

  describe("searchRoutes", () => {
    const handler = handlers.searchRoutes;

    it("returns error when sql_queries is missing", async () => {
      const result = await handler({});
      expect(result.isError).toBe(true);
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.error).toContain("sql_queries parameter is REQUIRED");
    });

    it("returns successful response with totalRoutes", async () => {
      const result = await handler({ sql_queries: { q: "SELECT * FROM routes" } });
      expect(result.isError).toBeUndefined();
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.metadata.tool).toBe("tomtom-route-search");
      expect(parsed.metadata.parameters.totalRoutes).toBe(2);
      expect(parsed.metadata.queries_executed).toBe(1);
    });

    it("returns isError when service throws", async () => {
      vi.mocked(getRoutes).mockRejectedValueOnce(new Error("API error"));
      const result = await handler({ sql_queries: { q: "SELECT 1" } });
      expect(result.isError).toBe(true);
    });

    it("always calls sqlEngine.close()", async () => {
      await handler({ sql_queries: { q: "SELECT 1" } });
      expect(mockSqlEngine.close).toHaveBeenCalled();
    });

    it("injects a route_ids directory into metadata", async () => {
      const result = await handler({ sql_queries: { q: "SELECT 1" } });
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.metadata.route_ids).toEqual([
        { route_id: 1, route_name: "Route A" },
        { route_id: 2, route_name: "Route B" },
      ]);
      expect(parsed.metadata.parameters.route_ids_note).toBeUndefined();
    });

    it("caps route_ids at 100 and notes the truncation", async () => {
      const many = Array.from({ length: 150 }, (_, i) => ({ routeId: i, routeName: `R${i}` }));
      vi.mocked(getRoutes).mockResolvedValueOnce(many as any);
      const result = await handler({ sql_queries: { q: "SELECT 1" } });
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.metadata.route_ids).toHaveLength(100);
      expect(parsed.metadata.route_ids[0]).toEqual({ route_id: 0, route_name: "R0" });
      expect(parsed.metadata.parameters.route_ids_note).toContain("150");
    });

    describe("route search viz cache (show_ui)", () => {
      it("defaults show_ui to true, stores raw viz payload, and includes viz_id", async () => {
        const result = await handler({ sql_queries: { q: "SELECT 1" } });

        expect(mockStoreVizData).toHaveBeenCalledTimes(1);
        expect(mockStoreVizData).toHaveBeenCalledWith({
          tool: "tomtom-route-search",
          routes: [
            { routeId: 1, routeName: "Route A" },
            { routeId: 2, routeName: "Route B" },
          ],
        });

        const parsed = JSON.parse(result.content[0].text);
        expect(parsed._meta).toEqual({ show_ui: true, viz_id: "test-viz-id" });
      });

      it("does not call storeVizData and sets show_ui false when show_ui: false", async () => {
        const result = await handler({ sql_queries: { q: "SELECT 1" }, show_ui: false });

        expect(mockStoreVizData).not.toHaveBeenCalled();
        const parsed = JSON.parse(result.content[0].text);
        expect(parsed._meta).toEqual({ show_ui: false });
      });

      it("degrades gracefully to show_ui:false when storeVizData throws", async () => {
        mockStoreVizData.mockImplementationOnce(() => {
          throw new Error("cache full");
        });

        const result = await handler({ sql_queries: { q: "SELECT 1" } });

        expect(result.isError).toBeUndefined();
        const parsed = JSON.parse(result.content[0].text);
        expect(parsed._meta).toEqual({ show_ui: false });
        expect(logger.error).toHaveBeenCalled();
      });

      it("does not call storeVizData on error paths (e.g. missing sql_queries)", async () => {
        const result = await handler({});
        expect(result.isError).toBe(true);
        expect(mockStoreVizData).not.toHaveBeenCalled();
      });
    });
  });

  describe("getRouteDetails", () => {
    const handler = handlers.getRouteDetails;
    const validParams = {
      routeIds: ["r1"],
      sql_queries: { q: "SELECT * FROM segments" },
    };

    it("returns error when routeIds exceed 20", async () => {
      const ids = Array.from({ length: 21 }, (_, i) => `r${i}`);
      const result = await handler({ routeIds: ids, sql_queries: { q: "SELECT 1" } });
      expect(result.isError).toBe(true);
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.error).toContain("Maximum 20");
    });

    it("returns error when sql_queries is missing", async () => {
      const result = await handler({ routeIds: ["r1"] });
      expect(result.isError).toBe(true);
    });

    it("calls getRouteDetails for each route ID", async () => {
      await handler({ routeIds: ["r1", "r2"], sql_queries: { q: "SELECT 1" } });
      expect(getRouteDetails).toHaveBeenCalledTimes(2);
      expect(getRouteDetails).toHaveBeenCalledWith("r1");
      expect(getRouteDetails).toHaveBeenCalledWith("r2");
    });

    it("returns correct metadata with route count", async () => {
      const result = await handler(validParams);
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.metadata.tool).toBe("tomtom-route-monitoring-details");
      expect(parsed.metadata.parameters.routeIds).toEqual(["r1"]);
      expect(parsed.metadata.parameters.routeCount).toBe(1);
    });

    it("always calls sqlEngine.close()", async () => {
      vi.mocked(getRouteDetails).mockRejectedValueOnce(new Error("fail"));
      await handler(validParams);
      expect(mockSqlEngine.close).toHaveBeenCalled();
    });

    describe("route details viz cache (show_ui)", () => {
      it("defaults show_ui to true, stores raw viz payload, and includes viz_id", async () => {
        const result = await handler(validParams);

        expect(mockStoreVizData).toHaveBeenCalledTimes(1);
        expect(mockStoreVizData).toHaveBeenCalledWith({
          tool: "tomtom-route-monitoring-details",
          routes: [{ detailedSegments: [{ segmentId: "s1" }] }],
        });

        const parsed = JSON.parse(result.content[0].text);
        expect(parsed._meta).toEqual({ show_ui: true, viz_id: "test-viz-id" });
      });

      it("does not call storeVizData and sets show_ui false when show_ui: false", async () => {
        const result = await handler({ ...validParams, show_ui: false });

        expect(mockStoreVizData).not.toHaveBeenCalled();
        const parsed = JSON.parse(result.content[0].text);
        expect(parsed._meta).toEqual({ show_ui: false });
      });

      it("degrades gracefully to show_ui:false when storeVizData throws", async () => {
        mockStoreVizData.mockImplementationOnce(() => {
          throw new Error("cache full");
        });

        const result = await handler(validParams);

        expect(result.isError).toBeUndefined();
        const parsed = JSON.parse(result.content[0].text);
        expect(parsed._meta).toEqual({ show_ui: false });
        expect(logger.error).toHaveBeenCalled();
      });

      it("does not call storeVizData when routeIds exceed 20", async () => {
        const ids = Array.from({ length: 21 }, (_, i) => `r${i}`);
        const result = await handler({ routeIds: ids, sql_queries: { q: "SELECT 1" } });
        expect(result.isError).toBe(true);
        expect(mockStoreVizData).not.toHaveBeenCalled();
      });

      it("does not call storeVizData on error paths (e.g. missing sql_queries)", async () => {
        const result = await handler({ routeIds: ["r1"] });
        expect(result.isError).toBe(true);
        expect(mockStoreVizData).not.toHaveBeenCalled();
      });
    });
  });
});
