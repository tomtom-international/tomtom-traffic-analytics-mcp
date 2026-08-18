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
import { flattenRouteMonitoringDetails } from "./routeMonitoringFlattener";
import { RouteDetailedInfo } from "../../services/route-monitoring/types";

const mockResponse: RouteDetailedInfo = {
  routeId: 101,
  routeName: "Highway A10",
  routeStatus: "ACTIVE",
  routePathPoints: [{ latitude: 51.76, longitude: 19.47 }],
  travelTime: 300,
  typicalTravelTime: 250,
  delayTime: 50,
  passable: true,
  routeLength: 5000,
  completeness: 98,
  typicalTravelTimeCoverage: 92,
  routeConfidence: 0.87,
  detailedSegments: [
    {
      segmentId: 1,
      segmentIdStr: "seg-001",
      averageSpeed: 80,
      typicalSpeed: 90,
      segmentLength: 2500,
      openLrId: "olr-1",
      currentSpeed: 75,
      relativeSpeed: 0.83,
      confidence: 0.95,
      openLrLength: 2490,
    },
  ],
};

describe("flattenRouteMonitoringDetails", () => {
  it("should produce route_info and segments tables", () => {
    const result = flattenRouteMonitoringDetails(mockResponse);
    expect(result.tables.has("route_info")).toBe(true);
    expect(result.tables.has("segments")).toBe(true);
    expect(result.tables.size).toBe(2);
  });

  it("should flatten route info fields correctly", () => {
    const result = flattenRouteMonitoringDetails(mockResponse);
    const rows = result.tables.get("route_info")!;
    expect(rows).toHaveLength(1);

    const row = rows[0];
    expect(row.route_id).toBe(101);
    expect(row.route_name).toBe("Highway A10");
    expect(row.route_status).toBe("ACTIVE");
    expect(row.travel_time).toBe(300);
    expect(row.typical_travel_time).toBe(250);
    expect(row.delay_time).toBe(50);
    expect(row.passable).toBe(1);
    expect(row.route_length).toBe(5000);
    expect(row.route_confidence).toBe(0.87);
  });

  it("should flatten segment fields correctly", () => {
    const result = flattenRouteMonitoringDetails(mockResponse);
    const rows = result.tables.get("segments")!;
    expect(rows).toHaveLength(1);

    const row = rows[0];
    expect(row.route_id).toBe(101);
    expect(row.segment_id).toBe(1);
    expect(row.segment_id_str).toBe("seg-001");
    expect(row.average_speed).toBe(80);
    expect(row.typical_speed).toBe(90);
    expect(row.current_speed).toBe(75);
    expect(row.confidence).toBe(0.95);
  });

  it("should convert passable boolean to 0/1", () => {
    const notPassable = { ...mockResponse, passable: false };
    const result = flattenRouteMonitoringDetails(notPassable);
    expect(result.tables.get("route_info")![0].passable).toBe(0);
  });

  it("should handle missing optional fields", () => {
    const minimal: RouteDetailedInfo = {
      routeId: 202,
      routeName: "Minimal Route",
      routeStatus: "NEW",
      routePathPoints: [],
      routeLength: 1000,
    };
    const result = flattenRouteMonitoringDetails(minimal);
    const row = result.tables.get("route_info")![0];
    expect(row.travel_time).toBeNull();
    expect(row.passable).toBeNull();
    expect(row.route_confidence).toBeNull();
    expect(result.tables.get("segments")!).toHaveLength(0);
  });
});
