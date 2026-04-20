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

import { describe, it, expect } from "vitest";
import { z } from "zod";
import { areaAnalyticsStatsSchema } from "./areaAnalyticsSchema";

describe("Area Analytics Schema Validation", () => {
  describe("Stats Schema", () => {
    // Valid stats data (lite version constraints)
    const validStatsData = {
      name: "Test Downtown Stats",
      startDate: "2024-08-01",
      endDate: "2024-08-07", // Within 31 days
      hours: [7, 8, 9],
      frcs: [0, 1, 2],
      dataTypes: ["CONGESTION_LEVEL"], // Exactly one data type
      features: [
        {
          type: "Feature",
          geometry: {
            type: "Polygon",
            coordinates: [
              [
                [-122.4194, 37.7749],
                [-122.4094, 37.7749],
                [-122.4094, 37.7849],
                [-122.4194, 37.7849],
                [-122.4194, 37.7749],
              ],
            ],
          },
          properties: {
            name: "Downtown District",
            timezone: "America/Los_Angeles",
          },
        },
      ],
      sql_queries: {
        avg_congestion: "SELECT AVG(congestion_level) as avg FROM timed_data",
      },
    };

    it("should validate correct stats data", () => {
      const schema = z.object(areaAnalyticsStatsSchema);
      const result = schema.safeParse(validStatsData);
      expect(result.success).toBe(true);
    });

    it("should reject multiple data types exceeding max", () => {
      const schema = z.object(areaAnalyticsStatsSchema);
      const invalidData = {
        ...validStatsData,
        dataTypes: [
          "CONGESTION_LEVEL",
          "SPEED",
          "TRAVEL_TIME",
          "FREE_FLOW_SPEED",
          "NETWORK_LENGTH",
          "EXTRA",
        ], // Too many (max 5)
      };
      const result = schema.safeParse(invalidData);
      expect(result.success).toBe(false);
    });

    it("should reject multiple features", () => {
      const schema = z.object(areaAnalyticsStatsSchema);
      const invalidData = {
        ...validStatsData,
        features: [
          validStatsData.features[0],
          validStatsData.features[0], // Must be exactly one
        ],
      };
      const result = schema.safeParse(invalidData);
      expect(result.success).toBe(false);
    });

    it("should reject empty data types array", () => {
      const schema = z.object(areaAnalyticsStatsSchema);
      const invalidData = {
        ...validStatsData,
        dataTypes: [], // Must have at least one
      };
      const result = schema.safeParse(invalidData);
      expect(result.success).toBe(false);
    });

    it("should reject empty features array", () => {
      const schema = z.object(areaAnalyticsStatsSchema);
      const invalidData = {
        ...validStatsData,
        features: [], // Must have exactly one
      };
      const result = schema.safeParse(invalidData);
      expect(result.success).toBe(false);
    });

    it("should validate with single data type and feature", () => {
      const schema = z.object(areaAnalyticsStatsSchema);
      const singleData = {
        ...validStatsData,
        dataTypes: ["SPEED"],
        features: [validStatsData.features[0]],
      };
      const result = schema.safeParse(singleData);
      expect(result.success).toBe(true);
    });

    it("should validate with multiple data types and single feature", () => {
      const schema = z.object(areaAnalyticsStatsSchema);
      const multipleDataTypes = {
        ...validStatsData,
        dataTypes: ["SPEED", "CONGESTION_LEVEL", "TRAVEL_TIME"],
        features: [validStatsData.features[0]],
      };
      const result = schema.safeParse(multipleDataTypes);
      expect(result.success).toBe(true);
    });

    it("should reject invalid date format", () => {
      const schema = z.object(areaAnalyticsStatsSchema);
      const invalidData = {
        ...validStatsData,
        startDate: "2024/08/01", // Wrong format
      };
      const result = schema.safeParse(invalidData);
      expect(result.success).toBe(false);
    });

    it("should reject invalid hours", () => {
      const schema = z.object(areaAnalyticsStatsSchema);
      const invalidData = {
        ...validStatsData,
        hours: [7, 8, 25], // 25 is invalid hour
      };
      const result = schema.safeParse(invalidData);
      expect(result.success).toBe(false);
    });

    it("should reject invalid FRCs", () => {
      const schema = z.object(areaAnalyticsStatsSchema);
      const invalidData = {
        ...validStatsData,
        frcs: [0, 1, 9], // 9 is invalid FRC
      };
      const result = schema.safeParse(invalidData);
      expect(result.success).toBe(false);
    });

    it("should reject invalid data types", () => {
      const schema = z.object(areaAnalyticsStatsSchema);
      const invalidData = {
        ...validStatsData,
        dataTypes: ["INVALID_TYPE"],
      };
      const result = schema.safeParse(invalidData);
      expect(result.success).toBe(false);
    });

    it("should accept MultiPolygon geometry", () => {
      const schema = z.object(areaAnalyticsStatsSchema);
      const multiPolygonData = {
        ...validStatsData,
        features: [
          {
            type: "Feature",
            geometry: {
              type: "MultiPolygon",
              coordinates: [
                [
                  [
                    [-122.4194, 37.7749],
                    [-122.4094, 37.7749],
                    [-122.4094, 37.7849],
                    [-122.4194, 37.7849],
                    [-122.4194, 37.7749],
                  ],
                ],
              ],
            },
            properties: {
              name: "Multi-District",
              timezone: "America/Los_Angeles",
            },
          },
        ],
      };
      const result = schema.safeParse(multiPolygonData);
      expect(result.success).toBe(true);
    });

    it("should reject name exceeding max length", () => {
      const schema = z.object(areaAnalyticsStatsSchema);
      const invalidData = {
        ...validStatsData,
        name: "A".repeat(251), // Too long
      };
      const result = schema.safeParse(invalidData);
      expect(result.success).toBe(false);
    });
  });
});
