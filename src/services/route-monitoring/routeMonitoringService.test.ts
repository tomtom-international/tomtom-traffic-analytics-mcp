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
import { movePortalAPIClient } from "../base/tomtomClient";
import { getRoutes, getRouteDetails } from "./routeMonitoringService";

// Mock the movePortalAPIClient
vi.mock("../base/tomtomClient", () => ({
  movePortalAPIClient: {
    get: vi.fn(),
  },
  validateMovePortalApiKey: vi.fn(),
}));

// Mock the logger
vi.mock("../../utils/logger", () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
  },
}));

// Mock the error handler
vi.mock("../../utils/errorHandler", () => ({
  handleApiError: vi.fn((error) => error),
}));

describe("Route Monitoring Service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("getRoutes", () => {
    it("should fetch all routes successfully", async () => {
      const mockResponse = {
        data: [
          {
            routeId: 123,
            routeName: "Test Route",
            routeStatus: "ACTIVE",
            routeLength: 161,
            routePathPoints: [
              { latitude: 51.76041, longitude: 19.4721 },
              { latitude: 51.75959, longitude: 19.47312 },
            ],
            travelTime: 19,
            delayTime: 2,
            completeness: 89,
          },
        ],
      };

      (movePortalAPIClient.get as any).mockResolvedValue(mockResponse);

      const result = await getRoutes();

      expect(movePortalAPIClient.get).toHaveBeenCalledWith("/routemonitoring/3/routes");
      expect(result).toEqual(mockResponse.data);
    });
  });

  describe("getRouteDetails", () => {
    it("should fetch detailed route information successfully", async () => {
      const mockResponse = {
        data: {
          routeId: 123,
          routeName: "Test Route",
          routeStatus: "ACTIVE",
          routeLength: 151,
          routePathPoints: [
            { latitude: 51.76041, longitude: 19.4721 },
            { latitude: 51.75959, longitude: 19.47312 },
          ],
          travelTime: 21,
          delayTime: 5,
          routeConfidence: 82,
          detailedSegments: [
            {
              segmentId: 1186178914586853376,
              segmentIdStr: "1186178914586853376",
              averageSpeed: 55,
              currentSpeed: 57,
              segmentLength: 26,
              confidence: 100,
            },
          ],
        },
      };

      (movePortalAPIClient.get as any).mockResolvedValue(mockResponse);

      const result = await getRouteDetails("123");

      expect(movePortalAPIClient.get).toHaveBeenCalledWith("/routemonitoring/3/routes/123/details");
      expect(result).toEqual(mockResponse.data);
    });
  });
});
