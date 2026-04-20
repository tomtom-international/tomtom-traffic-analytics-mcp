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

import { FlattenResult } from "../types";
import { JunctionDefinition } from "../../services/junction-analytics/types";

/**
 * View mode for junction definition flattening
 */
export type JunctionViewMode = "compact" | "full";

/**
 * Flattened junction summary row for SQL table
 */
interface JunctionRow {
  junction_id: string;
  name: string | null;
  status: string | null;
  country_code: string | null;
  drive_on_left: number | null; // 0 or 1
  traffic_lights: number | null; // 0 or 1
  num_approaches: number;
  num_exits: number;
  created_at: string | null;
  last_modified_at: string | null;
  time_zone: string | null;
}

/**
 * Flattened approach row for SQL table (full view only)
 */
interface ApproachRow {
  junction_id: string;
  approach_id: number;
  name: string | null;
  road_name: string | null;
  direction: string | null;
  frc: number | null;
  length: number | null;
  one_way_road: number | null; // 0 or 1
  excluded: number | null; // 0 or 1
  drivable: number | null; // 0 or 1
}

/**
 * Flattened exit row for SQL table (full view only)
 */
interface ExitRow {
  junction_id: string;
  exit_id: number;
  name: string | null;
  road_name: string | null;
  direction: string | null;
  frc: number | null;
  one_way_road: number | null; // 0 or 1
  drivable: number | null; // 0 or 1
}

/**
 * Flatten junction definitions into SQL-queryable tables
 *
 * Compact view (default): junctions table only — summary info for ID discovery
 * Full view: adds approaches and exits tables for structural search
 *
 * @param junctions - Array of junction definitions from the API
 * @param view - "compact" (default) or "full"
 * @returns FlattenResult with tables based on view mode
 */
export function flattenJunctionDefinitions(
  junctions: JunctionDefinition[],
  view: JunctionViewMode = "compact"
): FlattenResult {
  const tables = new Map<string, Record<string, unknown>[]>();

  // Always produce the junctions summary table
  const junctionRows: JunctionRow[] = junctions.map((j) => ({
    junction_id: j.id,
    name: j.name ?? null,
    status: j.status ?? null,
    country_code: j.junctionModel?.countryCode ?? null,
    drive_on_left:
      j.junctionModel?.driveOnLeft !== undefined ? (j.junctionModel.driveOnLeft ? 1 : 0) : null,
    traffic_lights:
      j.junctionModel?.trafficLights !== undefined ? (j.junctionModel.trafficLights ? 1 : 0) : null,
    num_approaches: j.junctionModel?.approaches?.length ?? 0,
    num_exits: j.junctionModel?.exits?.length ?? 0,
    created_at: j.createdAt ?? null,
    last_modified_at: j.lastModifiedAt ?? null,
    time_zone: j.timeZone ?? null,
  }));
  tables.set("junctions", junctionRows as unknown as Record<string, unknown>[]);

  // Full view adds approaches and exits tables
  if (view === "full") {
    const approachRows: ApproachRow[] = [];
    const exitRows: ExitRow[] = [];

    for (const j of junctions) {
      if (j.junctionModel) {
        for (const a of j.junctionModel.approaches) {
          approachRows.push({
            junction_id: j.id,
            approach_id: a.id,
            name: a.name ?? null,
            road_name: a.roadName ?? null,
            direction: a.direction ?? null,
            frc: a.frc ?? null,
            length: a.length ?? null,
            one_way_road: a.oneWayRoad !== undefined ? (a.oneWayRoad ? 1 : 0) : null,
            excluded: a.excluded !== undefined ? (a.excluded ? 1 : 0) : null,
            drivable: a.drivable !== undefined ? (a.drivable ? 1 : 0) : null,
          });
        }
        for (const e of j.junctionModel.exits) {
          exitRows.push({
            junction_id: j.id,
            exit_id: e.id,
            name: e.name ?? null,
            road_name: e.roadName ?? null,
            direction: e.direction ?? null,
            frc: e.frc ?? null,
            one_way_road: e.oneWayRoad !== undefined ? (e.oneWayRoad ? 1 : 0) : null,
            drivable: e.drivable !== undefined ? (e.drivable ? 1 : 0) : null,
          });
        }
      }
    }

    tables.set("approaches", approachRows as unknown as Record<string, unknown>[]);
    tables.set("exits", exitRows as unknown as Record<string, unknown>[]);
  }

  return { tables };
}
