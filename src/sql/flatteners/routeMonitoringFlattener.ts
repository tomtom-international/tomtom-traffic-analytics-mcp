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
import { RouteDetailedInfo } from "../../services/route-monitoring/types";

/**
 * Flattened route info row for SQL table
 */
interface RouteInfoRow {
  route_id: number;
  route_name: string | null;
  route_status: string | null;
  travel_time: number | null;
  typical_travel_time: number | null;
  delay_time: number | null;
  passable: number | null; // 0, 1, or null if unknown
  route_length: number | null;
  completeness: number | null;
  typical_travel_time_coverage: number | null;
  route_confidence: number | null;
}

/**
 * Flattened segment row for SQL table
 */
interface SegmentRow {
  route_id: number;
  segment_id: number;
  segment_id_str: string | null;
  average_speed: number | null;
  typical_speed: number | null;
  segment_length: number | null;
  open_lr_id: string | null;
  current_speed: number | null;
  relative_speed: number | null;
  confidence: number | null;
  open_lr_length: number | null;
}

/**
 * Flatten RouteDetailedInfo into SQL-queryable tables
 *
 * Creates two tables:
 * - route_info: Single row with route-level information
 * - segments: One row per segment in the route
 *
 * @param response - Raw API response from route monitoring details endpoint
 * @returns FlattenResult with route_info and segments tables
 */
export function flattenRouteMonitoringDetails(response: RouteDetailedInfo): FlattenResult {
  const tables = new Map<string, Record<string, unknown>[]>();

  // Create single row for route_info table
  const routeInfoRow: RouteInfoRow = {
    route_id: response.routeId,
    route_name: response.routeName ?? null,
    route_status: response.routeStatus ?? null,
    travel_time: response.travelTime ?? null,
    typical_travel_time: response.typicalTravelTime ?? null,
    delay_time: response.delayTime ?? null,
    passable: response.passable != null ? (response.passable ? 1 : 0) : null,
    route_length: response.routeLength ?? null,
    completeness: response.completeness ?? null,
    typical_travel_time_coverage: response.typicalTravelTimeCoverage ?? null,
    route_confidence: response.routeConfidence ?? null,
  };

  // Flatten segments array
  const segmentRows: SegmentRow[] = (response.detailedSegments ?? []).map((seg) => ({
    route_id: response.routeId,
    segment_id: seg.segmentId,
    segment_id_str: seg.segmentIdStr ?? null,
    average_speed: seg.averageSpeed ?? null,
    typical_speed: seg.typicalSpeed ?? null,
    segment_length: seg.segmentLength ?? null,
    open_lr_id: seg.openLrId ?? null,
    current_speed: seg.currentSpeed ?? null,
    relative_speed: seg.relativeSpeed ?? null,
    confidence: seg.confidence ?? null,
    open_lr_length: seg.openLrLength ?? null,
  }));

  tables.set("route_info", [routeInfoRow] as unknown as Record<string, unknown>[]);
  tables.set("segments", segmentRows as unknown as Record<string, unknown>[]);

  return { tables };
}
