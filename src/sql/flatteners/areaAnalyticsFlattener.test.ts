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
import { flattenAreaAnalyticsResults } from "./areaAnalyticsFlattener";
import { AreaAnalyticsReportResults } from "../../services/area-analytics/types";

const mockResponse: AreaAnalyticsReportResults = {
  type: "FeatureCollection",
  features: [
    {
      type: "Feature",
      geometry: { type: "Polygon", coordinates: [[[19.0, 51.0]]] },
      properties: {
        name: "Downtown",
        timezone: "Europe/Amsterdam",
        level: 1,
        timedData: {
          all: { time: "2025-01-01", v: 45, fv: 60, c: 0.25, t: 300, l: 1500 },
          daily: [
            { time: "2025-01-01", v: 42, fv: 60, c: 0.3, t: 320, l: 1500 },
            { time: "2025-01-02", v: 48, fv: 60, c: 0.2, t: 280, l: 1500 },
          ],
        },
        tiledData: {
          tiles: [{ lat: 51.0, lon: 19.0, v: 40, fv: 55, c: 0.27, t: 310, l: 200 }],
        },
      },
    },
  ],
  properties: {
    startDate: "2025-01-01",
    endDate: "2025-01-31",
    dataTypes: ["SPEED", "CONGESTION_LEVEL"],
    heatmap: false,
    frcs: [0, 1, 2],
    hours: [8, 9, 10],
  },
};

describe("flattenAreaAnalyticsResults", () => {
  it("should produce timed_data and tiled_data tables", () => {
    const result = flattenAreaAnalyticsResults(mockResponse);
    expect(result.tables.has("timed_data")).toBe(true);
    expect(result.tables.has("tiled_data")).toBe(true);
    expect(result.tables.size).toBe(2);
  });

  it("should flatten timed data with 'all' aggregation", () => {
    const result = flattenAreaAnalyticsResults(mockResponse);
    const rows = result.tables.get("timed_data")!;
    const allRow = rows.find((r) => r.aggregation_type === "all");
    expect(allRow).toBeDefined();
    expect(allRow!.region_name).toBe("Downtown");
    expect(allRow!.timezone).toBe("Europe/Amsterdam");
    expect(allRow!.level).toBe(1);
    expect(allRow!.speed).toBe(45);
    expect(allRow!.free_flow_speed).toBe(60);
    expect(allRow!.congestion_level).toBe(0.25);
  });

  it("should flatten daily aggregation rows", () => {
    const result = flattenAreaAnalyticsResults(mockResponse);
    const rows = result.tables.get("timed_data")!;
    const dailyRows = rows.filter((r) => r.aggregation_type === "daily");
    expect(dailyRows).toHaveLength(2);
    expect(dailyRows[0].time).toBe("2025-01-01");
    expect(dailyRows[1].speed).toBe(48);
  });

  it("should flatten tiled data correctly", () => {
    const result = flattenAreaAnalyticsResults(mockResponse);
    const rows = result.tables.get("tiled_data")!;
    expect(rows).toHaveLength(1);

    const row = rows[0];
    expect(row.region_name).toBe("Downtown");
    expect(row.lat).toBe(51.0);
    expect(row.lon).toBe(19.0);
    expect(row.speed).toBe(40);
    expect(row.point_geom).toBeNull();
  });

  it("should handle empty features", () => {
    const empty: AreaAnalyticsReportResults = {
      ...mockResponse,
      features: [],
    };
    const result = flattenAreaAnalyticsResults(empty);
    expect(result.tables.get("timed_data")!).toHaveLength(0);
    expect(result.tables.get("tiled_data")!).toHaveLength(0);
  });

  it("should handle missing optional timed data fields", () => {
    const minimal: AreaAnalyticsReportResults = {
      ...mockResponse,
      features: [
        {
          type: "Feature",
          geometry: { type: "Polygon", coordinates: [[[0, 0]]] },
          properties: {
            name: "Sparse",
            timezone: "UTC",
            level: 0,
            timedData: { all: { time: "2025-01-01" } },
            tiledData: { tiles: [] },
          },
        },
      ],
    };
    const result = flattenAreaAnalyticsResults(minimal);
    const row = result.tables.get("timed_data")![0];
    expect(row.speed).toBeNull();
    expect(row.free_flow_speed).toBeNull();
    expect(row.congestion_level).toBeNull();
    expect(row.travel_time).toBeNull();
    expect(row.network_length).toBeNull();
  });
});
