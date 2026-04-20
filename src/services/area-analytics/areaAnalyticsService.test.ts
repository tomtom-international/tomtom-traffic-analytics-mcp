/*
 * Copyright (C) 2025 TomTom NV
 * Licensed under the Apache License, Version 2.0
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the movePortalAPIClient
vi.mock("../base/tomtomClient", () => ({
  movePortalAPIClient: {
    post: vi.fn(),
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
import { getAreaAnalyticsStats } from "./areaAnalyticsService";

describe("Area Analytics Service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const sampleRequest = {
    name: "Test Region",
    startDate: "2024-08-01",
    endDate: "2024-08-07",
    hours: [8, 9, 17, 18] as any,
    frcs: [0, 1, 2] as any,
    dataTypes: ["CONGESTION_LEVEL"] as any,
    features: [
      {
        type: "Feature" as const,
        geometry: {
          type: "Polygon" as const,
          coordinates: [
            [
              [-122.4, 37.7],
              [-122.3, 37.7],
              [-122.3, 37.8],
              [-122.4, 37.7],
            ],
          ],
        },
      },
    ] as any,
  };

  it("posts request to area analytics lite endpoint", async () => {
    const mockResponse = {
      data: {
        type: "FeatureCollection",
        features: [{ type: "Feature", properties: {} }],
        properties: {},
      },
    };
    vi.mocked(movePortalAPIClient.post).mockResolvedValueOnce(mockResponse);

    const result = await getAreaAnalyticsStats(sampleRequest);

    expect(movePortalAPIClient.post).toHaveBeenCalledWith(
      "/areaanalytics/reports/lite",
      sampleRequest,
      expect.objectContaining({ headers: { "Content-Type": "application/json" } })
    );
    expect(result.type).toBe("FeatureCollection");
    expect(result.features).toHaveLength(1);
  });

  it("passes the full request body to the API", async () => {
    vi.mocked(movePortalAPIClient.post).mockResolvedValueOnce({
      data: { type: "FeatureCollection", features: [], properties: {} },
    });

    await getAreaAnalyticsStats(sampleRequest);

    const calledBody = vi.mocked(movePortalAPIClient.post).mock.calls[0][1];
    expect(calledBody.name).toBe("Test Region");
    expect(calledBody.startDate).toBe("2024-08-01");
    expect(calledBody.endDate).toBe("2024-08-07");
    expect(calledBody.hours).toEqual([8, 9, 17, 18]);
    expect(calledBody.dataTypes).toEqual(["CONGESTION_LEVEL"]);
  });

  it("returns the API response data", async () => {
    const mockData = {
      type: "FeatureCollection",
      features: [
        { type: "Feature", properties: { congestion_level: 42 } },
        { type: "Feature", properties: { congestion_level: 78 } },
      ],
      properties: { name: "Test" },
    };
    vi.mocked(movePortalAPIClient.post).mockResolvedValueOnce({ data: mockData });

    const result = await getAreaAnalyticsStats(sampleRequest);

    expect(result.features).toHaveLength(2);
    expect(result.properties).toBeDefined();
  });

  it("propagates errors via handleApiError", async () => {
    const error = new Error("API timeout");
    vi.mocked(movePortalAPIClient.post).mockRejectedValueOnce(error);

    await expect(getAreaAnalyticsStats(sampleRequest)).rejects.toBe(error);
  });

  it("exports getAreaAnalyticsStats function", () => {
    expect(getAreaAnalyticsStats).toBeDefined();
    expect(typeof getAreaAnalyticsStats).toBe("function");
  });
});
