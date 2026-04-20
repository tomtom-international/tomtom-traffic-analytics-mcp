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
import { flattenTrafficIncidents } from "./trafficIncidentsFlattener";
import { TrafficIncidentsResult } from "../../services/live-traffic/types";

const mockResponse: TrafficIncidentsResult = {
  incidents: [
    {
      type: "Feature",
      geometry: { type: "LineString", coordinates: [[19.47, 51.76]] },
      properties: {
        id: "inc-1",
        iconCategory: 0,
        magnitudeOfDelay: 2,
        events: [{ description: "Accident", code: 401, iconCategory: 0 }],
        startTime: "2025-01-01T08:00:00Z",
        endTime: "2025-01-01T10:00:00Z",
        from: "Main St",
        to: "Oak Ave",
        length: 500,
        delay: 120,
        roadNumbers: ["A10"],
        timeValidity: "present",
        probabilityOfOccurrence: "certain",
        numberOfReports: 3,
        lastReportTime: "2025-01-01T09:00:00Z",
      },
    },
  ],
};

describe("flattenTrafficIncidents", () => {
  it("should produce an incidents table", () => {
    const result = flattenTrafficIncidents(mockResponse);
    expect(result.tables.has("incidents")).toBe(true);
    expect(result.tables.size).toBe(1);
  });

  it("should flatten incident fields correctly", () => {
    const result = flattenTrafficIncidents(mockResponse);
    const rows = result.tables.get("incidents")!;
    expect(rows).toHaveLength(1);

    const row = rows[0];
    expect(row.id).toBe("inc-1");
    expect(row.iconCategory).toBe("Accident");
    expect(row.magnitudeOfDelay).toBe("Moderate");
    expect(row.from).toBe("Main St");
    expect(row.to).toBe("Oak Ave");
    expect(row.length).toBe(500);
    expect(row.delay).toBe(120);
    expect(row.numberOfReports).toBe(3);
    expect(row.geometry_type).toBe("LineString");
  });

  it("should set area_name when provided", () => {
    const result = flattenTrafficIncidents(mockResponse, "downtown");
    const row = result.tables.get("incidents")![0];
    expect(row.area_name).toBe("downtown");
  });

  it("should set area_name to null when not provided", () => {
    const result = flattenTrafficIncidents(mockResponse);
    const row = result.tables.get("incidents")![0];
    expect(row.area_name).toBeNull();
  });

  it("should handle empty incidents array", () => {
    const result = flattenTrafficIncidents({ incidents: [] });
    expect(result.tables.get("incidents")!).toHaveLength(0);
  });

  it("should handle undefined incidents", () => {
    const result = flattenTrafficIncidents({});
    expect(result.tables.get("incidents")!).toHaveLength(0);
  });

  it("should handle missing optional properties", () => {
    const minimal: TrafficIncidentsResult = {
      incidents: [
        {
          type: "Feature",
          geometry: { type: "Point", coordinates: [[19.47, 51.76]] },
          properties: {
            id: "inc-2",
            iconCategory: 7,
            magnitudeOfDelay: 0,
            events: [],
          },
        },
      ],
    };
    const result = flattenTrafficIncidents(minimal);
    const row = result.tables.get("incidents")![0];
    expect(row.id).toBe("inc-2");
    expect(row.iconCategory).toBe("RoadClosure");
    expect(row.from).toBeNull();
    expect(row.to).toBeNull();
    expect(row.length).toBeNull();
    expect(row.delay).toBeNull();
    expect(row.roadNumbers).toBeNull();
  });
});
