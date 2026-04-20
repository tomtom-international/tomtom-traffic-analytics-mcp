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
import {
  junctionSearchSchema,
  junctionLiveDataDetailsSchema,
  junctionArchiveSchema,
} from "./junctionAnalyticsSchema";

describe("Junction Analytics Schema Validation", () => {
  describe("Junction Search Schema", () => {
    it("should validate search request with sql_queries", () => {
      const validRequest = {
        sql_queries: { active: "SELECT * FROM junctions WHERE status = 'ACTIVE'" },
      };

      const schema = z.object(junctionSearchSchema);
      const result = schema.safeParse(validRequest);
      expect(result.success).toBe(true);
    });

    it("should default view to compact", () => {
      const validRequest = {
        sql_queries: { all: "SELECT * FROM junctions" },
      };

      const schema = z.object(junctionSearchSchema);
      const result = schema.safeParse(validRequest);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.view).toBe("compact");
      }
    });

    it("should accept view full", () => {
      const validRequest = {
        view: "full",
        sql_queries: { roads: "SELECT * FROM approaches" },
      };

      const schema = z.object(junctionSearchSchema);
      const result = schema.safeParse(validRequest);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.view).toBe("full");
      }
    });

    it("should reject empty sql_queries", () => {
      const invalidRequest = {
        sql_queries: {},
      };

      const schema = z.object(junctionSearchSchema);
      const result = schema.safeParse(invalidRequest);
      expect(result.success).toBe(false);
    });

    it("should reject invalid view value", () => {
      const invalidRequest = {
        view: "invalid",
        sql_queries: { test: "SELECT 1" },
      };

      const schema = z.object(junctionSearchSchema);
      const result = schema.safeParse(invalidRequest);
      expect(result.success).toBe(false);
    });
  });

  describe("Junction Live Data Schema", () => {
    it("should validate live data request", () => {
      const validRequest = {
        junctionIds: ["test-junction-id"],
        includeGeometry: true,
        sql_queries: { approaches: "SELECT * FROM approaches" },
      };

      const schema = z.object(junctionLiveDataDetailsSchema);
      const result = schema.safeParse(validRequest);
      expect(result.success).toBe(true);
    });
  });

  describe("Junction Archive Schema", () => {
    it("should validate archive request with date range", () => {
      const validRequest = {
        junctionIds: ["test-junction-id"],
        from: "2024-01-01",
        to: "2024-01-31",
        sql_queries: { avg_delay: "SELECT AVG(delay_sec) FROM approaches" },
      };

      const schema = z.object(junctionArchiveSchema);
      const result = schema.safeParse(validRequest);
      expect(result.success).toBe(true);
    });

    it("should validate archive request without end date", () => {
      const validRequest = {
        junctionIds: ["test-junction-id"],
        from: "2024-01-01",
        sql_queries: { summary: "SELECT COUNT(*) FROM approaches" },
      };

      const schema = z.object(junctionArchiveSchema);
      const result = schema.safeParse(validRequest);
      expect(result.success).toBe(true);
    });

    it("should reject invalid date format", () => {
      const invalidRequest = {
        junctionIds: ["test-junction-id"],
        from: "2024/01/01", // Wrong format
        sql_queries: { test: "SELECT 1" },
      };

      const schema = z.object(junctionArchiveSchema);
      const result = schema.safeParse(invalidRequest);
      expect(result.success).toBe(false);
    });
  });
});
