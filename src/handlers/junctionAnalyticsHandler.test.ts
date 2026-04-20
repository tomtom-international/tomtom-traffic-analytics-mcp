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
  getTableRowCounts: vi.fn().mockReturnValue({ junctions: 5 }),
  close: vi.fn(),
};

vi.mock("../sql", () => ({
  SqlFilterEngine: vi.fn(() => mockSqlEngine),
  flattenJunctionDefinitions: vi
    .fn()
    .mockReturnValue({ tables: new Map([["junctions", [{ junction_id: "j1" }]]]) }),
  flattenJunctionLiveData: vi
    .fn()
    .mockReturnValue({ tables: new Map([["approaches", [{ approach_id: 1 }]]]) }),
  flattenJunctionArchive: vi
    .fn()
    .mockReturnValue({ tables: new Map([["approaches", [{ time: "2024-01-01" }]]]) }),
  JUNCTION_DEFINITION_COMPACT_SCHEMA: [{ name: "junctions", columns: [] }],
  JUNCTION_DEFINITION_FULL_SCHEMA: [
    { name: "junctions", columns: [] },
    { name: "approaches", columns: [] },
  ],
  JUNCTION_LIVE_DATA_SCHEMA: [{ name: "approaches", columns: [] }],
  JUNCTION_ARCHIVE_SCHEMA: [{ name: "approaches", columns: [] }],
}));

vi.mock("../services/junction-analytics/junctionAnalyticsService", () => ({
  getAllJunctionDefinitions: vi.fn().mockResolvedValue([{ id: "j1" }, { id: "j2" }]),
  getJunctionLiveData: vi.fn().mockResolvedValue({ approachesLiveData: [{ approach_id: 1 }] }),
  getJunctionArchive: vi
    .fn()
    .mockResolvedValue({ approaches: [{ time: "2024-01-01" }], turnRatios: [] }),
}));

vi.mock("../utils/logger", () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

import {
  getJunctionSearchHandler,
  getJunctionLiveDataDetailsHandler,
  getJunctionArchiveHandler,
} from "./junctionAnalyticsHandler";
import {
  getAllJunctionDefinitions,
  getJunctionLiveData,
  getJunctionArchive,
} from "../services/junction-analytics/junctionAnalyticsService";
import { flattenJunctionDefinitions } from "../sql";

describe("junctionAnalyticsHandler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSqlEngine.initialize.mockResolvedValue([]);
    mockSqlEngine.executeQueries.mockResolvedValue({
      test_query: { columns: ["col1"], rows: [["val1"]], rowCount: 1 },
    });
    mockSqlEngine.getTableRowCounts.mockReturnValue({ junctions: 5 });
  });

  describe("getJunctionSearchHandler", () => {
    const handler = getJunctionSearchHandler();

    it("returns error when sql_queries is missing", async () => {
      const result = await handler({ view: "compact" });
      expect(result.isError).toBe(true);
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.error).toContain("sql_queries parameter is REQUIRED");
    });

    it("returns successful response with metadata", async () => {
      const result = await handler({ sql_queries: { q: "SELECT * FROM junctions" } });
      expect(result.isError).toBeUndefined();
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.metadata.tool).toBe("tomtom-junction-search");
      expect(parsed.metadata.parameters.view).toBe("compact");
      expect(parsed.metadata.parameters.totalJunctions).toBe(2);
      expect(parsed.metadata.queries_executed).toBe(1);
    });

    it("defaults view to compact", async () => {
      await handler({ sql_queries: { q: "SELECT 1" } });
      expect(flattenJunctionDefinitions).toHaveBeenCalledWith(expect.anything(), "compact");
    });

    it("passes full view to flattener", async () => {
      await handler({ view: "full", sql_queries: { q: "SELECT 1" } });
      expect(flattenJunctionDefinitions).toHaveBeenCalledWith(expect.anything(), "full");
    });

    it("returns isError when service throws", async () => {
      vi.mocked(getAllJunctionDefinitions).mockRejectedValueOnce(new Error("fetch failed"));
      const result = await handler({ sql_queries: { q: "SELECT 1" } });
      expect(result.isError).toBe(true);
    });

    it("always calls sqlEngine.close()", async () => {
      await handler({ sql_queries: { q: "SELECT 1" } });
      expect(mockSqlEngine.close).toHaveBeenCalled();
    });
  });

  describe("getJunctionLiveDataDetailsHandler", () => {
    const handler = getJunctionLiveDataDetailsHandler();
    const validParams = {
      junctionIds: ["j1"],
      sql_queries: { q: "SELECT * FROM approaches" },
    };

    it("returns error when junctionIds exceed 20", async () => {
      const ids = Array.from({ length: 21 }, (_, i) => `j${i}`);
      const result = await handler({ junctionIds: ids, sql_queries: { q: "SELECT 1" } });
      expect(result.isError).toBe(true);
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.error).toContain("Maximum 20");
    });

    it("returns error when sql_queries is missing", async () => {
      const result = await handler({ junctionIds: ["j1"] });
      expect(result.isError).toBe(true);
    });

    it("calls getJunctionLiveData for each junction ID in parallel", async () => {
      const params = { junctionIds: ["j1", "j2", "j3"], sql_queries: { q: "SELECT 1" } };
      await handler(params);
      expect(getJunctionLiveData).toHaveBeenCalledTimes(3);
      expect(getJunctionLiveData).toHaveBeenCalledWith("j1", expect.anything());
      expect(getJunctionLiveData).toHaveBeenCalledWith("j2", expect.anything());
      expect(getJunctionLiveData).toHaveBeenCalledWith("j3", expect.anything());
    });

    it("returns correct metadata with junction count", async () => {
      const result = await handler(validParams);
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.metadata.tool).toBe("tomtom-junction-live-data");
      expect(parsed.metadata.parameters.junctionIds).toEqual(["j1"]);
      expect(parsed.metadata.parameters.junctionCount).toBe(1);
    });

    it("always calls sqlEngine.close()", async () => {
      vi.mocked(getJunctionLiveData).mockRejectedValueOnce(new Error("fail"));
      await handler(validParams);
      expect(mockSqlEngine.close).toHaveBeenCalled();
    });
  });

  describe("getJunctionArchiveHandler", () => {
    const handler = getJunctionArchiveHandler();
    const validParams = {
      junctionIds: ["j1"],
      from: "2024-01-01",
      to: "2024-01-02",
      sql_queries: { q: "SELECT * FROM approaches" },
    };

    it("returns error when junctionIds exceed 20", async () => {
      const ids = Array.from({ length: 21 }, (_, i) => `j${i}`);
      const result = await handler({
        junctionIds: ids,
        from: "2024-01-01",
        sql_queries: { q: "SELECT 1" },
      });
      expect(result.isError).toBe(true);
    });

    it("returns error when sql_queries is missing", async () => {
      const result = await handler({ junctionIds: ["j1"], from: "2024-01-01" });
      expect(result.isError).toBe(true);
    });

    it("calls getJunctionArchive for each junction ID", async () => {
      await handler({ ...validParams, junctionIds: ["j1", "j2"] });
      expect(getJunctionArchive).toHaveBeenCalledTimes(2);
    });

    it("returns correct metadata with date range", async () => {
      const result = await handler(validParams);
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.metadata.tool).toBe("tomtom-junction-archive");
      expect(parsed.metadata.parameters.from).toBe("2024-01-01");
      expect(parsed.metadata.parameters.to).toBe("2024-01-02");
    });

    it("always calls sqlEngine.close()", async () => {
      await handler(validParams);
      expect(mockSqlEngine.close).toHaveBeenCalled();
    });
  });
});
