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
import { flattenJunctionLiveData } from "./junctionLiveDataFlattener";
import { JunctionLiveData } from "../../services/junction-analytics/types";

const mockResponse: JunctionLiveData = {
  id: "j-1",
  approachesLiveData: [
    {
      id: 100,
      travelTimeSec: 25,
      freeFlowTravelTimeSec: 15,
      delaySec: 10,
      usualDelaySec: 5,
      stops: 1,
      queueLengthMeters: 30,
      isClosed: false,
      volumePerHour: 600,
      turnRatios: [{ exitId: 200, exitIndex: 0, ratioPercent: 70, probesCount: 20 }],
      stopsHistogram: { entries: [{ numberOfStops: 1, numberOfVehicles: 15 }] },
    },
  ],
  junctionModel: {
    name: "Main Junction",
    countryCode: "NLD",
    driveOnLeft: false,
    trafficLights: true,
    approaches: [
      {
        id: 100,
        name: "North Approach",
        roadName: "Main St",
        direction: "NORTH",
        frc: 3,
        length: 150,
        oneWayRoad: false,
        excluded: false,
        drivable: true,
        segmentedGeometry: { type: "MultiLineString", coordinates: [[[19.0, 51.0]]] },
        userPoints: [{ type: "Point", coordinates: [19.0, 51.0] }],
        openlr: "abc",
        dataNotAvailable: false,
      },
    ],
    exits: [
      {
        id: 200,
        name: "East Exit",
        roadName: "Oak Ave",
        direction: "EAST",
        frc: 4,
        oneWayRoad: true,
        drivable: true,
        segmentedGeometry: { type: "MultiLineString", coordinates: [[[19.0, 51.0]]] },
        openlr: "def",
      },
    ],
  },
};

describe("flattenJunctionLiveData", () => {
  it("should produce all 6 tables when junctionModel is present", () => {
    const result = flattenJunctionLiveData(mockResponse);
    const expectedTables = [
      "approaches",
      "turn_ratios",
      "stops_histogram",
      "junction_metadata",
      "approach_metadata",
      "exit_metadata",
    ];
    for (const name of expectedTables) {
      expect(result.tables.has(name)).toBe(true);
    }
    expect(result.tables.size).toBe(6);
  });

  it("should flatten approach live data correctly", () => {
    const result = flattenJunctionLiveData(mockResponse);
    const rows = result.tables.get("approaches")!;
    expect(rows).toHaveLength(1);

    const row = rows[0];
    expect(row.junction_id).toBe("j-1");
    expect(row.approach_id).toBe(100);
    expect(row.travel_time_sec).toBe(25);
    expect(row.delay_sec).toBe(10);
    expect(row.is_closed).toBe(0);
  });

  it("should flatten turn ratios correctly", () => {
    const result = flattenJunctionLiveData(mockResponse);
    const rows = result.tables.get("turn_ratios")!;
    expect(rows).toHaveLength(1);
    expect(rows[0].exit_id).toBe(200);
    expect(rows[0].ratio_percent).toBe(70);
  });

  it("should flatten stops histogram correctly", () => {
    const result = flattenJunctionLiveData(mockResponse);
    const rows = result.tables.get("stops_histogram")!;
    expect(rows).toHaveLength(1);
    expect(rows[0].number_of_stops).toBe(1);
    expect(rows[0].number_of_vehicles).toBe(15);
  });

  it("should flatten junction metadata correctly", () => {
    const result = flattenJunctionLiveData(mockResponse);
    const rows = result.tables.get("junction_metadata")!;
    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe("Main Junction");
    expect(rows[0].country_code).toBe("NLD");
    expect(rows[0].traffic_lights).toBe(1);
  });

  it("should produce empty metadata tables when junctionModel is absent", () => {
    const noModel: JunctionLiveData = {
      id: "j-2",
      approachesLiveData: [],
    };
    const result = flattenJunctionLiveData(noModel);
    expect(result.tables.get("junction_metadata")!).toHaveLength(0);
    expect(result.tables.get("approach_metadata")!).toHaveLength(0);
    expect(result.tables.get("exit_metadata")!).toHaveLength(0);
  });

  it("should handle approaches with no turnRatios or stopsHistogram", () => {
    const minimal: JunctionLiveData = {
      id: "j-3",
      approachesLiveData: [
        {
          id: 300,
          travelTimeSec: 10,
          freeFlowTravelTimeSec: 8,
          delaySec: 2,
          usualDelaySec: 1,
          stops: 0,
          queueLengthMeters: 0,
          isClosed: false,
          turnRatios: [],
          stopsHistogram: { entries: [] },
        },
      ],
    };
    const result = flattenJunctionLiveData(minimal);
    expect(result.tables.get("turn_ratios")!).toHaveLength(0);
    expect(result.tables.get("stops_histogram")!).toHaveLength(0);
  });
});
