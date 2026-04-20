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
import { flattenJunctionArchive } from "./junctionArchiveFlattener";
import { JunctionArchiveJsonResponse } from "../../services/junction-analytics/types";

const mockResponse: JunctionArchiveJsonResponse = {
  approaches: [
    {
      time: "2025-01-01T08:00:00Z",
      junctionId: "j-1",
      approachId: "a-1",
      travelTimeSec: 30,
      freeFlowTravelTimeSec: 20,
      delaySec: 10,
      usualDelaySec: 5,
      stops: 2,
      queueLengthMeters: 50,
      volumePerHour: 800,
      isClosed: false,
      stopsHistogram: "{}",
    },
  ],
  turnRatios: [
    {
      time: "2025-01-01T08:00:00Z",
      junctionId: "j-1",
      approachId: "a-1",
      exitId: "e-1",
      exitIndex: 0,
      ratioPercent: 65.5,
      probesCount: 42,
    },
  ],
};

describe("flattenJunctionArchive", () => {
  it("should produce approaches and turn_ratios tables", () => {
    const result = flattenJunctionArchive(mockResponse);
    expect(result.tables.has("approaches")).toBe(true);
    expect(result.tables.has("turn_ratios")).toBe(true);
    expect(result.tables.size).toBe(2);
  });

  it("should flatten approach fields correctly", () => {
    const result = flattenJunctionArchive(mockResponse);
    const rows = result.tables.get("approaches")!;
    expect(rows).toHaveLength(1);

    const row = rows[0];
    expect(row.time).toBe("2025-01-01T08:00:00Z");
    expect(row.junction_id).toBe("j-1");
    expect(row.approach_id).toBe("a-1");
    expect(row.travel_time_sec).toBe(30);
    expect(row.free_flow_travel_time_sec).toBe(20);
    expect(row.delay_sec).toBe(10);
    expect(row.usual_delay_sec).toBe(5);
    expect(row.stops).toBe(2);
    expect(row.queue_length_meters).toBe(50);
    expect(row.volume_per_hour).toBe(800);
    expect(row.is_closed).toBe(0);
  });

  it("should flatten turn ratio fields correctly", () => {
    const result = flattenJunctionArchive(mockResponse);
    const rows = result.tables.get("turn_ratios")!;
    expect(rows).toHaveLength(1);

    const row = rows[0];
    expect(row.junction_id).toBe("j-1");
    expect(row.approach_id).toBe("a-1");
    expect(row.exit_id).toBe("e-1");
    expect(row.exit_index).toBe(0);
    expect(row.ratio_percent).toBe(65.5);
    expect(row.probes_count).toBe(42);
  });

  it("should convert isClosed boolean to 1", () => {
    const closed: JunctionArchiveJsonResponse = {
      approaches: [{ ...mockResponse.approaches[0], isClosed: true }],
      turnRatios: [],
    };
    const result = flattenJunctionArchive(closed);
    expect(result.tables.get("approaches")![0].is_closed).toBe(1);
  });

  it("should handle empty arrays", () => {
    const result = flattenJunctionArchive({ approaches: [], turnRatios: [] });
    expect(result.tables.get("approaches")!).toHaveLength(0);
    expect(result.tables.get("turn_ratios")!).toHaveLength(0);
  });
});
