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
import { trafficFlowDataSchema, trafficIncidentsSchema } from "./liveTrafficSchema";

// Default sql_queries for tests
const defaultSqlQueries = { test: "SELECT * FROM flow_segment" };
const incidentsSqlQueries = { test: "SELECT * FROM incidents" };

describe("Live Traffic Schema Validation", () => {
  describe("trafficFlowDataSchema", () => {
    it("should validate correct live traffic request", () => {
      const validRequest = {
        point: {
          latitude: 52.41072,
          longitude: 4.84239,
        },
        style: "absolute",
        zoom: 10,
        sql_queries: defaultSqlQueries,
      };

      const schema = z.object(trafficFlowDataSchema);
      const result = schema.safeParse(validRequest);
      expect(result.success).toBe(true);
    });

    it("should validate request with all optional parameters", () => {
      const validRequest = {
        point: {
          latitude: 37.7749,
          longitude: -122.4194,
        },
        style: "relative",
        zoom: 15,
        format: "json",
        unit: "mph",
        thickness: 15,
        openLr: true,
        sql_queries: defaultSqlQueries,
      };

      const schema = z.object(trafficFlowDataSchema);
      const result = schema.safeParse(validRequest);
      expect(result.success).toBe(true);
    });

    it("should reject invalid latitude", () => {
      const invalidRequest = {
        point: {
          latitude: 91, // Invalid: > 90
          longitude: 4.84239,
        },
        style: "absolute",
        zoom: 10,
        sql_queries: defaultSqlQueries,
      };

      const schema = z.object(trafficFlowDataSchema);
      const result = schema.safeParse(invalidRequest);
      expect(result.success).toBe(false);
    });

    it("should reject invalid longitude", () => {
      const invalidRequest = {
        point: {
          latitude: 52.41072,
          longitude: 181, // Invalid: > 180
        },
        style: "absolute",
        zoom: 10,
        sql_queries: defaultSqlQueries,
      };

      const schema = z.object(trafficFlowDataSchema);
      const result = schema.safeParse(invalidRequest);
      expect(result.success).toBe(false);
    });

    it("should reject invalid style", () => {
      const invalidRequest = {
        point: {
          latitude: 52.41072,
          longitude: 4.84239,
        },
        style: "invalid-style",
        zoom: 10,
        sql_queries: defaultSqlQueries,
      };

      const schema = z.object(trafficFlowDataSchema);
      const result = schema.safeParse(invalidRequest);
      expect(result.success).toBe(false);
    });

    it("should reject invalid zoom level", () => {
      const invalidRequest = {
        point: {
          latitude: 52.41072,
          longitude: 4.84239,
        },
        style: "absolute",
        zoom: 25, // Invalid: > 22
        sql_queries: defaultSqlQueries,
      };

      const schema = z.object(trafficFlowDataSchema);
      const result = schema.safeParse(invalidRequest);
      expect(result.success).toBe(false);
    });

    it("should reject invalid thickness", () => {
      const invalidRequest = {
        point: {
          latitude: 52.41072,
          longitude: 4.84239,
        },
        style: "absolute",
        zoom: 10,
        thickness: 25, // Invalid: > 20
        sql_queries: defaultSqlQueries,
      };

      const schema = z.object(trafficFlowDataSchema);
      const result = schema.safeParse(invalidRequest);
      expect(result.success).toBe(false);
    });

    it("should apply default values for optional parameters", () => {
      const validRequest = {
        point: {
          latitude: 52.41072,
          longitude: 4.84239,
        },
        style: "absolute",
        zoom: 10,
        sql_queries: defaultSqlQueries,
      };

      const schema = z.object(trafficFlowDataSchema);
      const result = schema.safeParse(validRequest);

      if (result.success) {
        expect(result.data.format).toBe("json");
        expect(result.data.unit).toBe("kmph");
        expect(result.data.thickness).toBe(10);
        expect(result.data.openLr).toBe(false);
      }
    });

    it("should accept all valid style options", () => {
      const styles = [
        "absolute",
        "relative",
        "relative0",
        "relative0-dark",
        "relative-delay",
        "reduced-sensitivity",
      ];

      const schema = z.object(trafficFlowDataSchema);

      styles.forEach((style) => {
        const request = {
          point: { latitude: 52.41072, longitude: 4.84239 },
          style,
          zoom: 10,
          sql_queries: defaultSqlQueries,
        };
        const result = schema.safeParse(request);
        expect(result.success).toBe(true);
      });
    });

    it("should accept valid zoom range", () => {
      const schema = z.object(trafficFlowDataSchema);

      // Test boundary values
      [0, 10, 22].forEach((zoom) => {
        const request = {
          point: { latitude: 52.41072, longitude: 4.84239 },
          style: "absolute",
          zoom,
          sql_queries: defaultSqlQueries,
        };
        const result = schema.safeParse(request);
        expect(result.success).toBe(true);
      });
    });

    it("should accept valid thickness range", () => {
      const schema = z.object(trafficFlowDataSchema);

      // Test boundary values
      [1, 10, 20].forEach((thickness) => {
        const request = {
          point: { latitude: 52.41072, longitude: 4.84239 },
          style: "absolute",
          zoom: 10,
          thickness,
          sql_queries: defaultSqlQueries,
        };
        const result = schema.safeParse(request);
        expect(result.success).toBe(true);
      });
    });

    it("should reject missing sql_queries", () => {
      const invalidRequest = {
        point: {
          latitude: 52.41072,
          longitude: 4.84239,
        },
        style: "absolute",
        zoom: 10,
      };

      const schema = z.object(trafficFlowDataSchema);
      const result = schema.safeParse(invalidRequest);
      expect(result.success).toBe(false);
    });

    it("should reject empty sql_queries", () => {
      const invalidRequest = {
        point: {
          latitude: 52.41072,
          longitude: 4.84239,
        },
        style: "absolute",
        zoom: 10,
        sql_queries: {},
      };

      const schema = z.object(trafficFlowDataSchema);
      const result = schema.safeParse(invalidRequest);
      expect(result.success).toBe(false);
    });
  });

  describe("trafficIncidentsSchema", () => {
    const schema = z.object(trafficIncidentsSchema);

    it("should parse a valid traffic input with bboxes", () => {
      const input = {
        bboxes: [{ name: "test", bbox: "-74.02,40.70,-73.96,40.80" }],
        sql_queries: incidentsSqlQueries,
      };
      expect(schema.parse(input)).toMatchObject(input);
    });

    it("should parse with all optional fields", () => {
      const input = {
        bboxes: [{ name: "test", bbox: "-74.02,40.70,-73.96,40.80" }],
        language: "en-US",
        maxResults: 50,
        categoryFilter: "0,1,2",
        timeValidityFilter: "present",
        sql_queries: incidentsSqlQueries,
      };
      expect(schema.parse(input)).toMatchObject(input);
    });

    it("should fail if maxResults is less than 1", () => {
      expect(() => schema.parse({ maxResults: 0, sql_queries: incidentsSqlQueries })).toThrow();
    });

    it("should fail if maxResults is more than 1000", () => {
      expect(() => schema.parse({ maxResults: 1001, sql_queries: incidentsSqlQueries })).toThrow();
    });

    it("should fail if timeValidityFilter is invalid", () => {
      expect(() =>
        schema.parse({ timeValidityFilter: "past", sql_queries: incidentsSqlQueries })
      ).toThrow();
    });

    it("should fail if sql_queries is missing", () => {
      expect(() =>
        schema.parse({ bboxes: [{ name: "test", bbox: "-74.02,40.70,-73.96,40.80" }] })
      ).toThrow();
    });

    it("should fail if sql_queries is empty", () => {
      expect(() =>
        schema.parse({
          bboxes: [{ name: "test", bbox: "-74.02,40.70,-73.96,40.80" }],
          sql_queries: {},
        })
      ).toThrow();
    });
  });
});
