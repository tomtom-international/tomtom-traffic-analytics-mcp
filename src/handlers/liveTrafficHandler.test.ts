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
  getTableRowCounts: vi.fn().mockReturnValue({ flow_segment: 1 }),
  close: vi.fn(),
};

vi.mock("../sql", () => ({
  SqlFilterEngine: vi.fn(() => mockSqlEngine),
  flattenTrafficFlowSegment: vi
    .fn()
    .mockReturnValue({ tables: new Map([["flow_segment", [{ frc: "FRC1" }]]]) }),
  flattenTrafficIncidents: vi
    .fn()
    .mockReturnValue({ tables: new Map([["incidents", [{ id: "1" }]]]) }),
  TRAFFIC_FLOW_SEGMENT_SCHEMA: [{ name: "flow_segment", columns: [] }],
  TRAFFIC_INCIDENTS_SCHEMA: [{ name: "incidents", columns: [] }],
}));

vi.mock("../services/live-traffic/liveTrafficService", () => ({
  getFlowSegmentData: vi.fn().mockResolvedValue({ flowSegmentData: {} }),
  getTrafficIncidents: vi.fn().mockResolvedValue({ incidents: [{ id: "1" }] }),
}));

vi.mock("../utils/logger", () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

import { getFlowSegmentDataHandler, createTrafficIncidentsHandler } from "./liveTrafficHandler";
import {
  getFlowSegmentData,
  getTrafficIncidents,
} from "../services/live-traffic/liveTrafficService";

describe("liveTrafficHandler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSqlEngine.initialize.mockResolvedValue([]);
    mockSqlEngine.executeQueries.mockResolvedValue({
      test_query: { columns: ["col1"], rows: [["val1"]], rowCount: 1 },
    });
    mockSqlEngine.getTableRowCounts.mockReturnValue({ flow_segment: 1 });
  });

  describe("getFlowSegmentDataHandler", () => {
    const handler = getFlowSegmentDataHandler();
    const validParams = {
      point: { latitude: 52.37, longitude: 4.89 },
      style: "absolute",
      zoom: 10,
      sql_queries: { test_query: "SELECT * FROM flow_segment" },
    };

    it("returns error when sql_queries is missing", async () => {
      const result = await handler({
        point: { latitude: 52, longitude: 4 },
        style: "absolute",
        zoom: 10,
      });
      const parsed = JSON.parse(result.content[0].text);
      expect(result.isError).toBe(true);
      expect(parsed.error).toContain("sql_queries parameter is REQUIRED");
    });

    it("returns error when sql_queries is empty object", async () => {
      const result = await handler({ ...validParams, sql_queries: {} });
      expect(result.isError).toBe(true);
    });

    it("returns successful response with correct metadata shape", async () => {
      const result = await handler(validParams);
      expect(result.isError).toBeUndefined();
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.metadata.tool).toBe("tomtom-traffic-flow-segment");
      expect(parsed.metadata.parameters).toEqual({
        point: validParams.point,
        style: "absolute",
        zoom: 10,
      });
      expect(parsed.metadata.raw_row_counts).toEqual({ flow_segment: 1 });
      expect(parsed.metadata.queries_executed).toBe(1);
      expect(parsed.aggregated_data).toBeDefined();
    });

    it("returns isError when service throws", async () => {
      vi.mocked(getFlowSegmentData).mockRejectedValueOnce(new Error("API down"));
      const result = await handler(validParams);
      expect(result.isError).toBe(true);
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.error).toBe("API down");
    });

    it("always calls sqlEngine.close()", async () => {
      await handler(validParams);
      expect(mockSqlEngine.close).toHaveBeenCalled();
    });

    it("calls sqlEngine.close() even on error", async () => {
      vi.mocked(getFlowSegmentData).mockRejectedValueOnce(new Error("fail"));
      await handler(validParams);
      expect(mockSqlEngine.close).toHaveBeenCalled();
    });

    it("includes warnings in metadata when present", async () => {
      mockSqlEngine.initialize.mockResolvedValueOnce(["Schema warning: extra columns"]);
      const result = await handler(validParams);
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.metadata.warnings).toEqual(["Schema warning: extra columns"]);
    });
  });

  describe("createTrafficIncidentsHandler", () => {
    const handler = createTrafficIncidentsHandler();
    const validParams = {
      bboxes: [{ name: "Downtown", bbox: "-122.42,37.77,-122.40,37.79" }],
      sql_queries: { test_query: "SELECT * FROM incidents" },
    };

    it("returns error when bboxes exceed 10", async () => {
      const tooManyBboxes = Array.from({ length: 11 }, (_, i) => ({
        name: `area${i}`,
        bbox: "0,0,1,1",
      }));
      const result = await handler({ bboxes: tooManyBboxes, sql_queries: { q: "SELECT 1" } });
      expect(result.isError).toBe(true);
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.error).toContain("Maximum 10");
    });

    it("returns error when sql_queries is missing", async () => {
      const result = await handler({ bboxes: [{ name: "a", bbox: "0,0,1,1" }] });
      expect(result.isError).toBe(true);
    });

    it("calls getTrafficIncidents for each bbox area", async () => {
      const params = {
        bboxes: [
          { name: "Area1", bbox: "0,0,1,1" },
          { name: "Area2", bbox: "2,2,3,3" },
        ],
        sql_queries: { q: "SELECT * FROM incidents" },
      };
      await handler(params);
      expect(getTrafficIncidents).toHaveBeenCalledTimes(2);
    });

    it("returns successful response with multi-area metadata", async () => {
      mockSqlEngine.getTableRowCounts.mockReturnValue({ incidents: 2 });
      const result = await handler(validParams);
      expect(result.isError).toBeUndefined();
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.metadata.tool).toBe("tomtom-traffic-incidents");
      expect(parsed.metadata.parameters.areas).toEqual(["Downtown"]);
      expect(parsed.metadata.parameters.areaCount).toBe(1);
    });

    it("returns isError when service throws", async () => {
      vi.mocked(getTrafficIncidents).mockRejectedValueOnce(new Error("network error"));
      const result = await handler(validParams);
      expect(result.isError).toBe(true);
    });

    it("always calls sqlEngine.close()", async () => {
      await handler(validParams);
      expect(mockSqlEngine.close).toHaveBeenCalled();
    });
  });
});
