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
import { API_VERSION, trafficAPIClient } from "../base/tomtomClient";
import { getFlowSegmentData, getTrafficIncidents } from "./liveTrafficService";
import { TrafficFlowSegmentRequest } from "./types";

// Mock the trafficAPIClient
vi.mock("../base/tomtomClient", () => ({
  trafficAPIClient: {
    get: vi.fn(),
    defaults: {
      baseURL: "https://api.tomtom.com",
      params: { key: "test-key" },
    },
  },
  validateTomTomApiKey: vi.fn(),
  API_VERSION: { TRAFFIC: 5 },
}));

// Mock the logger
vi.mock("../../utils/logger", () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

// Mock the error handler
vi.mock("../../utils/errorHandler", () => ({
  handleApiError: vi.fn((error) => error),
}));

describe("Live Traffic Service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("getFlowSegmentData", () => {
    it("should fetch live traffic data successfully", async () => {
      const mockResponse = {
        data: {
          flowSegmentData: {
            frc: "FRC2",
            currentSpeed: 41,
            freeFlowSpeed: 70,
            currentTravelTime: 153,
            freeFlowTravelTime: 90,
            confidence: 0.59,
            roadClosure: false,
            coordinates: [
              { latitude: 52.40476, longitude: 4.844318 },
              { latitude: 52.411312, longitude: 4.8299975 },
            ],
          },
        },
      };

      (trafficAPIClient.get as any).mockResolvedValue(mockResponse);

      const request: TrafficFlowSegmentRequest = {
        point: { latitude: 52.41072, longitude: 4.84239 },
        style: "absolute",
        zoom: 10,
      };

      const result = await getFlowSegmentData(request);

      expect(trafficAPIClient.get).toHaveBeenCalledWith(
        `/traffic/services/${API_VERSION.TRAFFIC_FLOW}/flowSegmentData/absolute/10/json`,
        {
          params: {
            point: "52.41072,4.84239",
          },
        }
      );
      // Service now unwraps response.data.flowSegmentData so the flattener
      // can read fields off the top level (matches TrafficFlowSegmentResponse).
      expect(result).toEqual(mockResponse.data.flowSegmentData);
    });

    it("should include optional parameters when provided", async () => {
      const mockResponse = {
        data: {
          frc: "FRC2",
          currentSpeed: 25,
          freeFlowSpeed: 43,
          currentTravelTime: 153,
          freeFlowTravelTime: 90,
          confidence: 0.59,
          roadClosure: false,
          coordinates: [],
          openlr: "test-openlr-code",
        },
      };

      (trafficAPIClient.get as any).mockResolvedValue(mockResponse);

      const request: TrafficFlowSegmentRequest = {
        point: { latitude: 52.41072, longitude: 4.84239 },
        style: "relative",
        zoom: 15,
        unit: "mph",
        thickness: 15,
        openLr: true,
      };

      const result = await getFlowSegmentData(request);

      expect(trafficAPIClient.get).toHaveBeenCalledWith(
        `/traffic/services/${API_VERSION.TRAFFIC_FLOW}/flowSegmentData/relative/15/json`,
        {
          params: {
            point: "52.41072,4.84239",
            unit: "mph",
            thickness: 15,
            openLr: true,
          },
        }
      );
      expect(result).toEqual(mockResponse.data);
    });

    it("should handle response without flowSegmentData wrapper", async () => {
      const mockResponse = {
        data: {
          frc: "FRC3",
          currentSpeed: 30,
          freeFlowSpeed: 50,
          currentTravelTime: 100,
          freeFlowTravelTime: 60,
          confidence: 0.75,
          roadClosure: false,
          coordinates: [],
        },
      };

      (trafficAPIClient.get as any).mockResolvedValue(mockResponse);

      const request: TrafficFlowSegmentRequest = {
        point: { latitude: 37.7749, longitude: -122.4194 },
        style: "absolute",
        zoom: 12,
      };

      const result = await getFlowSegmentData(request);

      expect(result).toEqual(mockResponse.data);
    });
  });

  describe("getTrafficIncidents", () => {
    const amsterdamBBox = "4.8,52.3,5.0,52.4";

    it("should retrieve traffic incidents from Amsterdam", async () => {
      const mockResponse = {
        data: {
          incidents: [
            {
              type: "Feature",
              geometry: { type: "Point", coordinates: [4.9, 52.35] },
              properties: { id: "123", iconCategory: 6 },
            },
          ],
        },
      };

      (trafficAPIClient.get as any).mockResolvedValue(mockResponse);

      const result = await getTrafficIncidents(amsterdamBBox);

      expect(trafficAPIClient.get).toHaveBeenCalledWith(
        expect.stringContaining(`/traffic/services/${API_VERSION.TRAFFIC}/incidentDetails`),
        expect.objectContaining({
          params: expect.objectContaining({
            bbox: amsterdamBBox,
          }),
        })
      );
      expect(result).toEqual(mockResponse.data);
    });

    it("should accept and apply language parameter", async () => {
      const mockResponse = { data: {} };
      (trafficAPIClient.get as any).mockResolvedValue(mockResponse);

      const options = {
        language: "nl-NL",
      };

      await getTrafficIncidents(amsterdamBBox, options);

      expect(trafficAPIClient.get).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          params: expect.objectContaining({
            language: "nl-NL",
          }),
        })
      );
    });

    it("should validate bounding box format", async () => {
      await expect(getTrafficIncidents("invalid-bbox")).rejects.toThrow(
        'Bounding box must be in format "minLon,minLat,maxLon,maxLat"'
      );
    });
  });
});
