/*
 * Copyright (C) 2025 TomTom NV
 * Licensed under the Apache License, Version 2.0
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../../utils/logger", () => ({
  logger: { debug: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

import { storeVizData, getVizData, deleteVizData, clearVizCache, getCacheStats } from "./vizCache";

describe("vizCache", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearVizCache();
  });

  afterEach(() => {
    clearVizCache();
  });

  describe("storeVizData", () => {
    it("stores data and returns a UUID viz_id", () => {
      const data = { test: "data", value: 123 };
      const vizId = storeVizData(data);

      expect(vizId).toBeDefined();
      expect(typeof vizId).toBe("string");
      // UUID format check (basic)
      expect(vizId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
      );
    });

    it("stores different data with distinct viz_ids", () => {
      const data1 = { test: "data1" };
      const data2 = { test: "data2" };

      const vizId1 = storeVizData(data1);
      const vizId2 = storeVizData(data2);

      expect(vizId1).not.toBe(vizId2);
    });

    it("stores and retrieves data correctly (roundtrip)", () => {
      const data = { test: "data", nested: { value: 42 } };
      const vizId = storeVizData(data);

      const retrieved = getVizData(vizId);
      expect(retrieved).toEqual(data);
    });

    it("stores complex objects", () => {
      const complexData = {
        array: [1, 2, 3],
        nested: { deep: { value: "test" } },
        null: null,
        bool: true,
      };

      const vizId = storeVizData(complexData);
      const retrieved = getVizData(vizId);

      expect(retrieved).toEqual(complexData);
    });
  });

  describe("getVizData", () => {
    it("returns undefined for unknown viz_id", () => {
      const result = getVizData("unknown-id");
      expect(result).toBeUndefined();
    });

    it("returns stored data for valid viz_id", () => {
      const data = { key: "value" };
      const vizId = storeVizData(data);

      const retrieved = getVizData(vizId);
      expect(retrieved).toEqual(data);
    });
  });

  describe("deleteVizData", () => {
    it("deletes stored data", () => {
      const data = { test: "data" };
      const vizId = storeVizData(data);

      expect(getVizData(vizId)).toBeDefined();
      deleteVizData(vizId);
      expect(getVizData(vizId)).toBeUndefined();
    });

    it("silently handles deleting non-existent data", () => {
      expect(() => deleteVizData("unknown-id")).not.toThrow();
    });
  });

  describe("clearVizCache", () => {
    it("clears all cached data", () => {
      const vizId1 = storeVizData({ data: 1 });
      const vizId2 = storeVizData({ data: 2 });

      expect(getVizData(vizId1)).toBeDefined();
      expect(getVizData(vizId2)).toBeDefined();

      clearVizCache();

      expect(getVizData(vizId1)).toBeUndefined();
      expect(getVizData(vizId2)).toBeUndefined();
    });
  });

  describe("getCacheStats", () => {
    it("returns cache statistics", () => {
      storeVizData({ data: 1 });
      const stats = getCacheStats();

      expect(stats).toBeDefined();
      expect(typeof stats).toBe("object");
      expect(stats.keys).toBeGreaterThan(0);
    });

    it("shows correct count after store/delete", () => {
      const vizId1 = storeVizData({ data: 1 });
      const vizId2 = storeVizData({ data: 2 });

      let stats = getCacheStats();
      const countAfterStore = stats.keys;

      deleteVizData(vizId1);
      stats = getCacheStats();

      expect(stats.keys).toBe(countAfterStore - 1);
    });
  });

  describe("TTL expiry", () => {
    it("expires data after TTL (300s) with fake timers", () => {
      vi.useFakeTimers();
      try {
        const data = { test: "data" };
        const vizId = storeVizData(data);

        // Data should be available immediately
        expect(getVizData(vizId)).toEqual(data);

        // Advance time past TTL (300s + 1s buffer)
        vi.advanceTimersByTime(301000);

        // Data should be expired and undefined
        // Note: node-cache checks lazily on get, so the data is expired after TTL
        expect(getVizData(vizId)).toBeUndefined();
      } finally {
        vi.useRealTimers();
      }
    });

    it("does not expire data before TTL", () => {
      vi.useFakeTimers();
      try {
        const data = { test: "data" };
        const vizId = storeVizData(data);

        // Advance time slightly less than TTL
        vi.advanceTimersByTime(250000);

        // Data should still be available
        expect(getVizData(vizId)).toEqual(data);
      } finally {
        vi.useRealTimers();
      }
    });
  });
});
