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
import { flattenJunctionDefinitions } from "./junctionDefinitionFlattener";
import { JunctionDefinition } from "../../services/junction-analytics/types";

const mockJunction: JunctionDefinition = {
  id: "junction-1",
  name: "First Street - Second Street",
  status: "ACTIVE",
  rawJunction: {
    type: "Feature",
    geometry: { type: "Point", coordinates: [19.447, 51.727] },
    properties: {},
  },
  detectionConfig: { autodetectName: false },
  junctionModel: {
    name: "First Street - Second Street",
    countryCode: "DEU",
    driveOnLeft: false,
    trafficLights: true,
    approaches: [
      {
        id: 1001,
        name: "First Street West Bound",
        roadName: "First Street",
        direction: "WEST",
        frc: 7,
        length: 192.77,
        oneWayRoad: false,
        excluded: false,
        drivable: true,
        segmentedGeometry: { type: "MultiLineString", coordinates: [[[19.45, 51.77]]] },
        userPoints: [{ type: "Point", coordinates: [19.45, 51.77] }],
        openlr: "abc",
        dataNotAvailable: false,
      },
      {
        id: 1002,
        name: "Second Street North Bound",
        roadName: "Second Street",
        direction: "NORTH",
        frc: 4,
        length: 236.16,
        oneWayRoad: true,
        excluded: false,
        drivable: true,
        segmentedGeometry: { type: "MultiLineString", coordinates: [[[19.45, 51.77]]] },
        userPoints: [{ type: "Point", coordinates: [19.45, 51.77] }],
        openlr: "def",
        dataNotAvailable: false,
      },
    ],
    exits: [
      {
        id: 2001,
        name: "First Street North Bound",
        roadName: "First Street",
        direction: "NORTH",
        frc: 4,
        oneWayRoad: false,
        drivable: true,
        segmentedGeometry: { type: "MultiLineString", coordinates: [[[19.45, 51.77]]] },
        openlr: "ghi",
      },
    ],
  },
  createdAt: "2024-12-12T10:23:39.386Z",
  lastModifiedAt: "2024-12-12T10:25:49.843Z",
  lastUserUpdatedAt: "2024-12-12T10:23:39.386Z",
  timeZone: "Europe/Berlin",
};

const mockJunctionNoModel: JunctionDefinition = {
  id: "junction-2",
  name: "Pending Junction",
  status: "PENDING_UPDATE",
  rawJunction: {
    type: "Feature",
    geometry: { type: "Point", coordinates: [19.0, 51.0] },
    properties: {},
  },
  detectionConfig: { autodetectName: true },
  createdAt: "2024-12-13T08:00:00Z",
  lastModifiedAt: "2024-12-13T08:00:00Z",
  lastUserUpdatedAt: "2024-12-13T08:00:00Z",
  timeZone: "Europe/Warsaw",
};

describe("flattenJunctionDefinitions", () => {
  describe("compact view", () => {
    it("should produce only the junctions table", () => {
      const result = flattenJunctionDefinitions([mockJunction], "compact");
      expect(result.tables.has("junctions")).toBe(true);
      expect(result.tables.has("approaches")).toBe(false);
      expect(result.tables.has("exits")).toBe(false);
    });

    it("should default to compact view", () => {
      const result = flattenJunctionDefinitions([mockJunction]);
      expect(result.tables.size).toBe(1);
      expect(result.tables.has("junctions")).toBe(true);
    });

    it("should flatten junction summary fields correctly", () => {
      const result = flattenJunctionDefinitions([mockJunction], "compact");
      const rows = result.tables.get("junctions")!;
      expect(rows).toHaveLength(1);

      const row = rows[0];
      expect(row.junction_id).toBe("junction-1");
      expect(row.name).toBe("First Street - Second Street");
      expect(row.status).toBe("ACTIVE");
      expect(row.country_code).toBe("DEU");
      expect(row.drive_on_left).toBe(0);
      expect(row.traffic_lights).toBe(1);
      expect(row.num_approaches).toBe(2);
      expect(row.num_exits).toBe(1);
      expect(row.created_at).toBe("2024-12-12T10:23:39.386Z");
      expect(row.time_zone).toBe("Europe/Berlin");
    });

    it("should handle junctions without junctionModel", () => {
      const result = flattenJunctionDefinitions([mockJunctionNoModel], "compact");
      const rows = result.tables.get("junctions")!;
      expect(rows).toHaveLength(1);

      const row = rows[0];
      expect(row.junction_id).toBe("junction-2");
      expect(row.name).toBe("Pending Junction");
      expect(row.status).toBe("PENDING_UPDATE");
      expect(row.country_code).toBeNull();
      expect(row.drive_on_left).toBeNull();
      expect(row.traffic_lights).toBeNull();
      expect(row.num_approaches).toBe(0);
      expect(row.num_exits).toBe(0);
    });

    it("should handle empty input", () => {
      const result = flattenJunctionDefinitions([], "compact");
      const rows = result.tables.get("junctions")!;
      expect(rows).toHaveLength(0);
    });
  });

  describe("full view", () => {
    it("should produce junctions, approaches, and exits tables", () => {
      const result = flattenJunctionDefinitions([mockJunction], "full");
      expect(result.tables.has("junctions")).toBe(true);
      expect(result.tables.has("approaches")).toBe(true);
      expect(result.tables.has("exits")).toBe(true);
    });

    it("should flatten approach details correctly", () => {
      const result = flattenJunctionDefinitions([mockJunction], "full");
      const approaches = result.tables.get("approaches")!;
      expect(approaches).toHaveLength(2);

      const first = approaches[0];
      expect(first.junction_id).toBe("junction-1");
      expect(first.approach_id).toBe(1001);
      expect(first.name).toBe("First Street West Bound");
      expect(first.road_name).toBe("First Street");
      expect(first.direction).toBe("WEST");
      expect(first.frc).toBe(7);
      expect(first.length).toBe(192.77);
      expect(first.one_way_road).toBe(0);
      expect(first.excluded).toBe(0);
      expect(first.drivable).toBe(1);

      const second = approaches[1];
      expect(second.one_way_road).toBe(1);
    });

    it("should flatten exit details correctly", () => {
      const result = flattenJunctionDefinitions([mockJunction], "full");
      const exits = result.tables.get("exits")!;
      expect(exits).toHaveLength(1);

      const exit = exits[0];
      expect(exit.junction_id).toBe("junction-1");
      expect(exit.exit_id).toBe(2001);
      expect(exit.name).toBe("First Street North Bound");
      expect(exit.road_name).toBe("First Street");
      expect(exit.direction).toBe("NORTH");
      expect(exit.frc).toBe(4);
      expect(exit.one_way_road).toBe(0);
      expect(exit.drivable).toBe(1);
    });

    it("should produce empty approach/exit tables for junctions without model", () => {
      const result = flattenJunctionDefinitions([mockJunctionNoModel], "full");
      const approaches = result.tables.get("approaches")!;
      const exits = result.tables.get("exits")!;
      expect(approaches).toHaveLength(0);
      expect(exits).toHaveLength(0);
    });

    it("should handle multiple junctions", () => {
      const result = flattenJunctionDefinitions([mockJunction, mockJunctionNoModel], "full");
      const junctions = result.tables.get("junctions")!;
      const approaches = result.tables.get("approaches")!;
      const exits = result.tables.get("exits")!;

      expect(junctions).toHaveLength(2);
      expect(approaches).toHaveLength(2); // only from mockJunction
      expect(exits).toHaveLength(1); // only from mockJunction
    });
  });
});
