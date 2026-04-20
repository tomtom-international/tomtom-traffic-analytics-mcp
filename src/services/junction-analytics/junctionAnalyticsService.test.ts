/*
 * Copyright (C) 2025 TomTom NV
 * Licensed under the Apache License, Version 2.0
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the movePortalAPIClient
vi.mock("../base/tomtomClient", () => ({
  movePortalAPIClient: {
    get: vi.fn(),
    defaults: { baseURL: "https://api.tomtom.com", params: { key: "test-key" } },
  },
  validateMovePortalApiKey: vi.fn(),
}));

vi.mock("../../utils/logger", () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

vi.mock("../../utils/errorHandler", () => ({
  handleApiError: vi.fn((error) => error),
}));

import { movePortalAPIClient } from "../base/tomtomClient";
import {
  getJunctionDefinitionList,
  getJunctionLiveData,
  getJunctionArchive,
  getAllJunctionDefinitions,
} from "./junctionAnalyticsService";

describe("Junction Analytics Service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("getJunctionDefinitionList", () => {
    it("fetches junction definitions with pagination params", async () => {
      const mockResponse = {
        data: {
          content: [{ id: "j1", name: "Junction 1" }],
          numberOfElements: 1,
          totalElements: 1,
          totalPages: 1,
          pageable: { pageNumber: 0, pageSize: 20 },
        },
      };
      vi.mocked(movePortalAPIClient.get).mockResolvedValueOnce(mockResponse);

      const result = await getJunctionDefinitionList({ page: 0, size: 20 });

      expect(movePortalAPIClient.get).toHaveBeenCalledWith(
        expect.stringContaining("/junction-analytics/junctions/"),
        expect.objectContaining({ params: { page: 0, size: 20 } })
      );
      expect(result.content).toHaveLength(1);
      expect(result.totalElements).toBe(1);
    });

    it("propagates errors via handleApiError", async () => {
      const error = new Error("Network error");
      vi.mocked(movePortalAPIClient.get).mockRejectedValueOnce(error);

      await expect(getJunctionDefinitionList()).rejects.toBe(error);
    });
  });

  describe("getJunctionLiveData", () => {
    it("fetches live data for a junction ID", async () => {
      const mockResponse = {
        data: { approachesLiveData: [{ approachId: 1, delaySeconds: 30 }] },
      };
      vi.mocked(movePortalAPIClient.get).mockResolvedValueOnce(mockResponse);

      const result = await getJunctionLiveData("junction-123", {});

      expect(movePortalAPIClient.get).toHaveBeenCalledWith(
        expect.stringContaining("junction-123"),
        expect.anything()
      );
      expect(result.approachesLiveData).toHaveLength(1);
    });

    it("passes includeGeometry option", async () => {
      vi.mocked(movePortalAPIClient.get).mockResolvedValueOnce({
        data: { approachesLiveData: [] },
      });

      await getJunctionLiveData("j1", { includeGeometry: true });

      expect(movePortalAPIClient.get).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ params: expect.objectContaining({ includeGeometry: true }) })
      );
    });

    it("propagates errors", async () => {
      vi.mocked(movePortalAPIClient.get).mockRejectedValueOnce(new Error("404 Not Found"));

      await expect(getJunctionLiveData("bad-id", {})).rejects.toThrow();
    });
  });

  describe("getJunctionArchive", () => {
    it("fetches archive data with date range", async () => {
      const mockResponse = {
        data: { approaches: [{ time: "2024-01-01T08:00:00Z" }], turnRatios: [] },
      };
      vi.mocked(movePortalAPIClient.get).mockResolvedValueOnce(mockResponse);

      const result = await getJunctionArchive("j1", { from: "2024-01-01", to: "2024-01-02" });

      expect(movePortalAPIClient.get).toHaveBeenCalledWith(
        expect.stringContaining("j1"),
        expect.objectContaining({
          params: expect.objectContaining({ from: "2024-01-01", to: "2024-01-02" }),
        })
      );
      expect(result.approaches).toHaveLength(1);
    });

    it("propagates errors", async () => {
      vi.mocked(movePortalAPIClient.get).mockRejectedValueOnce(new Error("Server error"));

      await expect(getJunctionArchive("j1", { from: "2024-01-01" })).rejects.toThrow();
    });
  });

  describe("getAllJunctionDefinitions", () => {
    it("auto-paginates and merges all pages", async () => {
      // First page
      vi.mocked(movePortalAPIClient.get).mockResolvedValueOnce({
        data: {
          content: [{ id: "j1" }, { id: "j2" }],
          numberOfElements: 2,
          totalElements: 4,
          totalPages: 2,
          pageable: { pageNumber: 0, pageSize: 1000 },
        },
      });
      // Second page
      vi.mocked(movePortalAPIClient.get).mockResolvedValueOnce({
        data: {
          content: [{ id: "j3" }, { id: "j4" }],
          numberOfElements: 2,
          totalElements: 4,
          totalPages: 2,
          pageable: { pageNumber: 1, pageSize: 1000 },
        },
      });

      const result = await getAllJunctionDefinitions();

      expect(result).toHaveLength(4);
      expect(movePortalAPIClient.get).toHaveBeenCalledTimes(2);
    });

    it("handles single page result", async () => {
      vi.mocked(movePortalAPIClient.get).mockResolvedValueOnce({
        data: {
          content: [{ id: "j1" }],
          numberOfElements: 1,
          totalElements: 1,
          totalPages: 1,
          pageable: { pageNumber: 0, pageSize: 1000 },
        },
      });

      const result = await getAllJunctionDefinitions();

      expect(result).toHaveLength(1);
      expect(movePortalAPIClient.get).toHaveBeenCalledTimes(1);
    });
  });
});
