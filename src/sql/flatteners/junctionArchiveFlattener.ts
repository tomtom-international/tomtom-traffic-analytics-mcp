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
import { JunctionArchiveJsonResponse } from "../../services/junction-analytics/types";

/**
 * Flattened approach row for SQL table
 */
interface ApproachRow {
  time: string;
  junction_id: string;
  approach_id: string;
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
interface TurnRatioRow {
  time: string;
  junction_id: string;
  approach_id: string;
  exit_id: string;
  exit_index: number | null;
  ratio_percent: number | null;
  probes_count: number | null;
}

/**
 * Flatten JunctionArchiveJsonResponse into SQL-queryable tables
 *
 * Creates two tables:
 * - approaches: One row per approach per time period
 * - turn_ratios: One row per turn ratio per time period
 *
 * @param response - Raw API response from junction archive endpoint
 * @returns FlattenResult with approaches and turn_ratios tables
 */
export function flattenJunctionArchive(response: JunctionArchiveJsonResponse): FlattenResult {
  const tables = new Map<string, Record<string, unknown>[]>();

  // Flatten approaches - already flat in the response
  const approachRows: ApproachRow[] = response.approaches.map((a) => ({
    time: a.time,
    junction_id: a.junctionId,
    approach_id: a.approachId,
    travel_time_sec: a.travelTimeSec ?? null,
    free_flow_travel_time_sec: a.freeFlowTravelTimeSec ?? null,
    delay_sec: a.delaySec ?? null,
    usual_delay_sec: a.usualDelaySec ?? null,
    stops: a.stops ?? null,
    queue_length_meters: a.queueLengthMeters ?? null,
    volume_per_hour: a.volumePerHour ?? null,
    is_closed: a.isClosed ? 1 : 0,
  }));

  // Flatten turn ratios - already flat in the response
  const turnRatioRows: TurnRatioRow[] = response.turnRatios.map((tr) => ({
    time: tr.time,
    junction_id: tr.junctionId,
    approach_id: tr.approachId,
    exit_id: tr.exitId,
    exit_index: tr.exitIndex ?? null,
    ratio_percent: tr.ratioPercent ?? null,
    probes_count: tr.probesCount ?? null,
  }));

  tables.set("approaches", approachRows as unknown as Record<string, unknown>[]);
  tables.set("turn_ratios", turnRatioRows as unknown as Record<string, unknown>[]);

  return { tables };
}
