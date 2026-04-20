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
import { getRouteDetailsSchema, routeSearchSchema } from "./routeMonitoringSchema";

describe("Route Monitoring Schemas", () => {
  describe("getRouteDetailsSchema", () => {
    it("should validate correct get route details data with single-element routeIds", () => {
      const validData = {
        routeIds: ["123"],
        sql_queries: { slow_segments: "SELECT segment_id FROM segments WHERE current_speed < 20" },
      };

      const result = z.object(getRouteDetailsSchema).safeParse(validData);
      expect(result.success).toBe(true);
    });

    it("should validate correct get route details data with multiple routeIds", () => {
      const validData = {
        routeIds: ["123", "456"],
        sql_queries: { compare: "SELECT route_id, delay_time FROM route_info" },
      };

      const result = z.object(getRouteDetailsSchema).safeParse(validData);
      expect(result.success).toBe(true);
    });

    it("should reject empty sql_queries", () => {
      const invalidData = {
        routeIds: ["123"],
        sql_queries: {},
      };

      const result = z.object(getRouteDetailsSchema).safeParse(invalidData);
      expect(result.success).toBe(false);
    });

    it("should reject more than 20 route IDs", () => {
      const invalidData = {
        routeIds: Array.from({ length: 21 }, (_, i) => `route-${i}`),
        sql_queries: { test: "SELECT 1" },
      };

      const result = z.object(getRouteDetailsSchema).safeParse(invalidData);
      expect(result.success).toBe(false);
    });
  });

  describe("routeSearchSchema", () => {
    it("should validate search request with sql_queries", () => {
      const validData = {
        sql_queries: { delayed: "SELECT * FROM routes WHERE delay_time > 60" },
      };

      const result = z.object(routeSearchSchema).safeParse(validData);
      expect(result.success).toBe(true);
    });

    it("should reject empty sql_queries", () => {
      const invalidData = {
        sql_queries: {},
      };

      const result = z.object(routeSearchSchema).safeParse(invalidData);
      expect(result.success).toBe(false);
    });

    it("should reject missing sql_queries", () => {
      const invalidData = {};

      const result = z.object(routeSearchSchema).safeParse(invalidData);
      expect(result.success).toBe(false);
    });
  });
});
