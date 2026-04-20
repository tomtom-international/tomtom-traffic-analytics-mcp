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
import { flattenRouteList } from "./routeListFlattener";
import { RouteBasicInfo } from "../../services/route-monitoring/types";

const mockRoute: RouteBasicInfo = {
  routeId: 123,
  routeName: "Test Route A10",
  routeStatus: "ACTIVE",
  routePathPoints: [
    { latitude: 51.76041, longitude: 19.4721 },
    { latitude: 51.75959, longitude: 19.47312 },
  ],
  travelTime: 120,
  typicalTravelTime: 100,
  delayTime: 20,
  passable: true,
  routeLength: 1500,
  completeness: 95,
  typicalTravelTimeCoverage: 89,
};

const mockRouteMinimal: RouteBasicInfo = {
  routeId: 456,
  routeName: "Minimal Route",
  routeStatus: "NEW",
  routePathPoints: [],
  routeLength: 500,
};

describe("flattenRouteList", () => {
  it("should produce a routes table", () => {
    const result = flattenRouteList([mockRoute]);
    expect(result.tables.has("routes")).toBe(true);
    expect(result.tables.size).toBe(1);
  });

  it("should flatten route fields correctly", () => {
    const result = flattenRouteList([mockRoute]);
    const rows = result.tables.get("routes")!;
    expect(rows).toHaveLength(1);

    const row = rows[0];
    expect(row.route_id).toBe(123);
    expect(row.route_name).toBe("Test Route A10");
    expect(row.route_status).toBe("ACTIVE");
    expect(row.travel_time).toBe(120);
    expect(row.typical_travel_time).toBe(100);
    expect(row.delay_time).toBe(20);
    expect(row.passable).toBe(1);
    expect(row.route_length).toBe(1500);
    expect(row.completeness).toBe(95);
    expect(row.typical_travel_time_coverage).toBe(89);
  });

  it("should convert passable boolean to 0/1", () => {
    const routePassable = { ...mockRoute, passable: true };
    const routeNotPassable = { ...mockRoute, routeId: 789, passable: false };

    const result = flattenRouteList([routePassable, routeNotPassable]);
    const rows = result.tables.get("routes")!;

    expect(rows[0].passable).toBe(1);
    expect(rows[1].passable).toBe(0);
  });

  it("should handle null/undefined optional fields", () => {
    const result = flattenRouteList([mockRouteMinimal]);
    const rows = result.tables.get("routes")!;
    const row = rows[0];

    expect(row.route_id).toBe(456);
    expect(row.route_name).toBe("Minimal Route");
    expect(row.travel_time).toBeNull();
    expect(row.typical_travel_time).toBeNull();
    expect(row.delay_time).toBeNull();
    expect(row.passable).toBeNull();
    expect(row.completeness).toBeNull();
    expect(row.typical_travel_time_coverage).toBeNull();
  });

  it("should handle empty input", () => {
    const result = flattenRouteList([]);
    const rows = result.tables.get("routes")!;
    expect(rows).toHaveLength(0);
  });

  it("should handle multiple routes", () => {
    const result = flattenRouteList([mockRoute, mockRouteMinimal]);
    const rows = result.tables.get("routes")!;
    expect(rows).toHaveLength(2);
    expect(rows[0].route_id).toBe(123);
    expect(rows[1].route_id).toBe(456);
  });
});
