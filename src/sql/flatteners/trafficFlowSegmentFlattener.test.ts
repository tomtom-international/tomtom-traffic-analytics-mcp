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
import { flattenTrafficFlowSegment } from "./trafficFlowSegmentFlattener";
import { TrafficFlowSegmentResponse } from "../../services/live-traffic/types";

const mockResponse: TrafficFlowSegmentResponse = {
  frc: "FRC3",
  currentSpeed: 45,
  freeFlowSpeed: 60,
  currentTravelTime: 120,
  freeFlowTravelTime: 90,
  confidence: 0.95,
  roadClosure: false,
  coordinates: [
    { latitude: 51.76, longitude: 19.47 },
    { latitude: 51.77, longitude: 19.48 },
  ],
  openlr: "abc123",
};

describe("flattenTrafficFlowSegment", () => {
  it("should produce a flow_segment table", () => {
    const result = flattenTrafficFlowSegment(mockResponse);
    expect(result.tables.has("flow_segment")).toBe(true);
    expect(result.tables.size).toBe(1);
  });

  it("should flatten flow segment fields correctly", () => {
    const result = flattenTrafficFlowSegment(mockResponse);
    const rows = result.tables.get("flow_segment")!;
    expect(rows).toHaveLength(1);

    const row = rows[0];
    expect(row.frc).toBe("FRC3");
    expect(row.current_speed).toBe(45);
    expect(row.free_flow_speed).toBe(60);
    expect(row.current_travel_time).toBe(120);
    expect(row.free_flow_travel_time).toBe(90);
    expect(row.confidence).toBe(0.95);
    expect(row.road_closure).toBe(0);
    expect(row.openlr).toBe("abc123");
  });

  it("should serialize coordinates as JSON", () => {
    const result = flattenTrafficFlowSegment(mockResponse);
    const row = result.tables.get("flow_segment")![0];
    expect(row.coordinates).toBe(JSON.stringify(mockResponse.coordinates));
  });

  it("should build geom_geojson as RFC 7946 LineString (lon, lat arrays)", () => {
    const result = flattenTrafficFlowSegment(mockResponse);
    const row = result.tables.get("flow_segment")![0];
    const parsed = JSON.parse(row.geom_geojson as string);
    expect(parsed.type).toBe("LineString");
    // Standard GeoJSON requires [longitude, latitude] numeric arrays — not
    // { latitude, longitude } objects — so that ST_GeomFromGeoJSON can parse it.
    expect(parsed.coordinates).toEqual(
      mockResponse.coordinates.map((c) => [c.longitude, c.latitude])
    );
  });

  it("should convert roadClosure boolean to 0/1", () => {
    const closed = { ...mockResponse, roadClosure: true };
    const result = flattenTrafficFlowSegment(closed);
    expect(result.tables.get("flow_segment")![0].road_closure).toBe(1);
  });

  it("should handle missing optional fields gracefully", () => {
    const minimal: TrafficFlowSegmentResponse = {
      frc: "FRC0",
      currentSpeed: 80,
      freeFlowSpeed: 100,
      currentTravelTime: 60,
      freeFlowTravelTime: 50,
      confidence: 0.5,
      roadClosure: false,
      coordinates: [],
    };
    const result = flattenTrafficFlowSegment(minimal);
    const row = result.tables.get("flow_segment")![0];
    expect(row.openlr).toBeNull();
  });
});
