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
import { RouteBasicInfo } from "../../services/route-monitoring/types";

/**
 * Flattened route list row for SQL table
 */
interface RouteListRow {
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
}

/**
 * Flatten route list into a SQL-queryable table
 *
 * Creates a single routes table with summary info for all routes.
 * Route data is already compact so no view parameter is needed.
 *
 * @param routes - Array of route basic info from the API
 * @returns FlattenResult with routes table
 */
export function flattenRouteList(routes: RouteBasicInfo[]): FlattenResult {
  const tables = new Map<string, Record<string, unknown>[]>();

  const routeRows: RouteListRow[] = routes.map((r) => ({
    route_id: r.routeId,
    route_name: r.routeName ?? null,
    route_status: r.routeStatus ?? null,
    travel_time: r.travelTime ?? null,
    typical_travel_time: r.typicalTravelTime ?? null,
    delay_time: r.delayTime ?? null,
    passable: r.passable != null ? (r.passable ? 1 : 0) : null,
    route_length: r.routeLength ?? null,
    completeness: r.completeness ?? null,
    typical_travel_time_coverage: r.typicalTravelTimeCoverage ?? null,
  }));
  tables.set("routes", routeRows as unknown as Record<string, unknown>[]);

  return { tables };
}
