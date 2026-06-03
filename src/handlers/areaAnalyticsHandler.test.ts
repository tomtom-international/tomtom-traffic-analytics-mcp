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
  getTableRowCounts: vi.fn().mockReturnValue({ timed_data: 10 }),
  close: vi.fn(),
};

vi.mock("../sql", () => ({
  SqlFilterEngine: vi.fn(function () { return mockSqlEngine; }),
  flattenAreaAnalyticsResults: vi
    .fn()
    .mockReturnValue({ tables: new Map([["timed_data", [{ time: "2024-01-01" }]]]) }),
  AREA_ANALYTICS_SCHEMA: [{ name: "timed_data", columns: [] }],
}));

vi.mock("../services/area-analytics/areaAnalyticsService", () => ({
  getAreaAnalyticsStats: vi.fn().mockResolvedValue({ features: [{ type: "Feature" }] }),
}));

vi.mock("../utils/logger", () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

import { getAreaAnalyticsStatsHandler } from "./areaAnalyticsHandler";
import { getAreaAnalyticsStats } from "../services/area-analytics/areaAnalyticsService";

describe("areaAnalyticsHandler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSqlEngine.initialize.mockResolvedValue([]);
    mockSqlEngine.executeQueries.mockResolvedValue({
      test_query: { columns: ["col1"], rows: [["val1"]], rowCount: 1 },
    });
    mockSqlEngine.getTableRowCounts.mockReturnValue({ timed_data: 10 });
  });

  const handler = getAreaAnalyticsStatsHandler();
  const validParams = {
    name: "Test Region",
    startDate: "2024-01-01",
    endDate: "2024-01-15",
    hours: [8, 9, 10],
    frcs: [0, 1, 2],
    dataTypes: ["CONGESTION_LEVEL"],
    features: [
      {
        type: "Feature",
        geometry: {
          type: "Polygon",
          coordinates: [
            [
              [0, 0],
              [1, 0],
              [1, 1],
              [0, 0],
            ],
          ],
        },
      },
    ],
    sql_queries: { test_query: "SELECT * FROM timed_data" },
  };

  it("returns error when sql_queries is missing", async () => {
    const { sql_queries, ...paramsWithout } = validParams;
    const result = await handler(paramsWithout);
    expect(result.isError).toBe(true);
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.error).toContain("sql_queries parameter is REQUIRED");
  });

  it("returns error when sql_queries is empty object", async () => {
    const result = await handler({ ...validParams, sql_queries: {} });
    expect(result.isError).toBe(true);
  });

  it("returns successful response with correct metadata", async () => {
    const result = await handler(validParams);
    expect(result.isError).toBeUndefined();
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.metadata.tool).toBe("tomtom-area-analytics-stats");
    expect(parsed.metadata.parameters).toEqual({
      name: "Test Region",
      startDate: "2024-01-01",
      endDate: "2024-01-15",
    });
    expect(parsed.metadata.raw_row_counts).toEqual({ timed_data: 10 });
    expect(parsed.metadata.queries_executed).toBe(1);
    expect(parsed.aggregated_data).toBeDefined();
  });

  it("returns isError when service throws", async () => {
    vi.mocked(getAreaAnalyticsStats).mockRejectedValueOnce(new Error("API failure"));
    const result = await handler(validParams);
    expect(result.isError).toBe(true);
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.error).toBe("API failure");
  });

  it("always calls sqlEngine.close()", async () => {
    await handler(validParams);
    expect(mockSqlEngine.close).toHaveBeenCalled();
  });

  it("calls sqlEngine.close() even on error", async () => {
    vi.mocked(getAreaAnalyticsStats).mockRejectedValueOnce(new Error("fail"));
    await handler(validParams);
    expect(mockSqlEngine.close).toHaveBeenCalled();
  });
});
