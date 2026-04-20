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
import { JunctionLiveData } from "../../services/junction-analytics/types";

/**
 * Flattened live approach row for SQL table
 */
interface LiveApproachRow {
  junction_id: string;
  approach_id: number;
  travel_time_sec: number | null;
  free_flow_travel_time_sec: number | null;
  delay_sec: number | null;
  usual_delay_sec: number | null;
  stops: number | null;
  queue_length_meters: number | null;
  volume_per_hour: number | null;
  is_closed: number; // 0 or 1
}

/**
 * Flattened turn ratio row for SQL table
 */
interface LiveTurnRatioRow {
  junction_id: string;
  approach_id: number;
  exit_id: number;
  exit_index: number | null;
  ratio_percent: number | null;
  probes_count: number | null;
}

/**
 * Flattened stops histogram row for SQL table
 */
interface StopsHistogramRow {
  junction_id: string;
  approach_id: number;
  number_of_stops: number;
  number_of_vehicles: number | null;
}

/**
 * Flattened junction metadata row for SQL table
 */
interface JunctionMetadataRow {
  junction_id: string;
  name: string | null;
  country_code: string | null;
  drive_on_left: number | null; // 0 or 1
  traffic_lights: number | null; // 0 or 1
}

/**
 * Flattened approach metadata row for SQL table
 */
interface ApproachMetadataRow {
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
 * Flattened exit metadata row for SQL table
 */
interface ExitMetadataRow {
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
 * Flatten JunctionLiveData into SQL-queryable tables
 *
 * Creates up to 6 tables:
 * - approaches: One row per approach with live metrics
 * - turn_ratios: One row per turn ratio (nested within each approach)
 * - stops_histogram: One row per histogram entry (nested within each approach)
 * - junction_metadata: One row with junction info (only if junctionModel present)
 * - approach_metadata: One row per approach with metadata (only if junctionModel present)
 * - exit_metadata: One row per exit with metadata (only if junctionModel present)
 *
 * @param response - Raw API response from junction live data endpoint
 * @returns FlattenResult with all tables
 */
export function flattenJunctionLiveData(response: JunctionLiveData): FlattenResult {
  const tables = new Map<string, Record<string, unknown>[]>();
  const junctionId = response.id;

  // Table 1: approaches (live metrics)
  const approachRows: LiveApproachRow[] = response.approachesLiveData.map((a) => ({
    junction_id: junctionId,
    approach_id: a.id,
    travel_time_sec: a.travelTimeSec ?? null,
    free_flow_travel_time_sec: a.freeFlowTravelTimeSec ?? null,
    delay_sec: a.delaySec ?? null,
    usual_delay_sec: a.usualDelaySec ?? null,
    stops: a.stops ?? null,
    queue_length_meters: a.queueLengthMeters ?? null,
    volume_per_hour: a.volumePerHour ?? null,
    is_closed: a.isClosed ? 1 : 0,
  }));
  tables.set("approaches", approachRows as unknown as Record<string, unknown>[]);

  // Table 2: turn_ratios (nested within each approach)
  const turnRatioRows: LiveTurnRatioRow[] = [];
  for (const approach of response.approachesLiveData) {
    if (approach.turnRatios) {
      for (const tr of approach.turnRatios) {
        turnRatioRows.push({
          junction_id: junctionId,
          approach_id: approach.id,
          exit_id: tr.exitId,
          exit_index: tr.exitIndex ?? null,
          ratio_percent: tr.ratioPercent ?? null,
          probes_count: tr.probesCount ?? null,
        });
      }
    }
  }
  tables.set("turn_ratios", turnRatioRows as unknown as Record<string, unknown>[]);

  // Table 3: stops_histogram (nested within each approach)
  const histogramRows: StopsHistogramRow[] = [];
  for (const approach of response.approachesLiveData) {
    if (approach.stopsHistogram?.entries) {
      for (const entry of approach.stopsHistogram.entries) {
        histogramRows.push({
          junction_id: junctionId,
          approach_id: approach.id,
          number_of_stops: entry.numberOfStops,
          number_of_vehicles: entry.numberOfVehicles ?? null,
        });
      }
    }
  }
  tables.set("stops_histogram", histogramRows as unknown as Record<string, unknown>[]);

  // Tables 4-6: Metadata (only if junctionModel exists - requires include_geometry=true)
  if (response.junctionModel) {
    const model = response.junctionModel;

    // Table 4: junction_metadata (single row)
    const junctionMetadataRows: JunctionMetadataRow[] = [
      {
        junction_id: junctionId,
        name: model.name ?? null,
        country_code: model.countryCode ?? null,
        drive_on_left: model.driveOnLeft !== undefined ? (model.driveOnLeft ? 1 : 0) : null,
        traffic_lights: model.trafficLights !== undefined ? (model.trafficLights ? 1 : 0) : null,
      },
    ];
    tables.set("junction_metadata", junctionMetadataRows as unknown as Record<string, unknown>[]);

    // Table 5: approach_metadata
    const approachMetadataRows: ApproachMetadataRow[] = model.approaches.map((a) => ({
      junction_id: junctionId,
      approach_id: a.id,
      name: a.name ?? null,
      road_name: a.roadName ?? null,
      direction: a.direction ?? null,
      frc: a.frc ?? null,
      length: a.length ?? null,
      one_way_road: a.oneWayRoad !== undefined ? (a.oneWayRoad ? 1 : 0) : null,
      excluded: a.excluded !== undefined ? (a.excluded ? 1 : 0) : null,
      drivable: a.drivable !== undefined ? (a.drivable ? 1 : 0) : null,
    }));
    tables.set("approach_metadata", approachMetadataRows as unknown as Record<string, unknown>[]);

    // Table 6: exit_metadata
    const exitMetadataRows: ExitMetadataRow[] = model.exits.map((e) => ({
      junction_id: junctionId,
      exit_id: e.id,
      name: e.name ?? null,
      road_name: e.roadName ?? null,
      direction: e.direction ?? null,
      frc: e.frc ?? null,
      one_way_road: e.oneWayRoad !== undefined ? (e.oneWayRoad ? 1 : 0) : null,
      drivable: e.drivable !== undefined ? (e.drivable ? 1 : 0) : null,
    }));
    tables.set("exit_metadata", exitMetadataRows as unknown as Record<string, unknown>[]);
  } else {
    // Create empty tables for consistent schema
    tables.set("junction_metadata", []);
    tables.set("approach_metadata", []);
    tables.set("exit_metadata", []);
  }

  return { tables };
}
