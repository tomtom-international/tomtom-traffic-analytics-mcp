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
import {
  AreaAnalyticsReportResults,
  TimeAggregatedData,
} from "../../services/area-analytics/types";

/**
 * Flattened timed data row for SQL table
 */
interface TimedDataRow {
  region_name: string | null;
  timezone: string | null;
  level: number | null;
  aggregation_type: string;
  time: string | null;
  speed: number | null;
  free_flow_speed: number | null;
  congestion_level: number | null;
  travel_time: number | null;
  network_length: number | null;
}

/**
 * Flattened tiled data row for SQL table
 */
interface TiledDataRow {
  region_name: string | null;
  lat: number;
  lon: number;
  speed: number | null;
  free_flow_speed: number | null;
  congestion_level: number | null;
  travel_time: number | null;
  network_length: number | null;
  point_geom: null; // Placeholder for native GEOMETRY (populated by engine using ST_Point(lon, lat))
}

/**
 * Helper function to flatten a single TimeAggregatedData item
 */
function flattenTimedDataItem(
  regionName: string | null,
  timezone: string | null,
  level: number | null,
  aggregationType: string,
  data: TimeAggregatedData
): TimedDataRow {
  return {
    region_name: regionName,
    timezone: timezone,
    level: level,
    aggregation_type: aggregationType,
    time: data.time ?? null,
    speed: data.v ?? null,
    free_flow_speed: data.fv ?? null,
    congestion_level: data.c ?? null,
    travel_time: data.t ?? null,
    network_length: data.l ?? null,
  };
}

/**
 * Flatten AreaAnalyticsReportResults into SQL-queryable tables
 *
 * Creates two tables:
 * - timed_data: One row per time aggregation per region (flattened from nested timedData)
 * - tiled_data: One row per spatial tile per region
 *
 * @param response - Raw API response from area analytics results endpoint
 * @returns FlattenResult with timed_data and tiled_data tables
 */
export function flattenAreaAnalyticsResults(response: AreaAnalyticsReportResults): FlattenResult {
  const tables = new Map<string, Record<string, unknown>[]>();
  const timedRows: TimedDataRow[] = [];
  const tiledRows: TiledDataRow[] = [];

  // Iterate through each feature (region) in the GeoJSON
  for (const feature of response.features) {
    const props = feature.properties;
    const regionName = props.name ?? null;
    const timezone = props.timezone ?? null;
    const level = props.level ?? null;

    // Flatten timedData - handle 'all' aggregation (single object)
    if (props.timedData.all) {
      timedRows.push(flattenTimedDataItem(regionName, timezone, level, "all", props.timedData.all));
    }

    // Handle array aggregations (yearly, monthly, daily, hourly)
    const aggregationTypes = ["yearly", "monthly", "daily", "hourly"] as const;
    for (const aggType of aggregationTypes) {
      const aggData = props.timedData[aggType];
      if (aggData && Array.isArray(aggData)) {
        for (const item of aggData) {
          timedRows.push(flattenTimedDataItem(regionName, timezone, level, aggType, item));
        }
      }
    }

    // Flatten tiledData
    if (props.tiledData?.tiles) {
      for (const tile of props.tiledData.tiles) {
        tiledRows.push({
          region_name: regionName,
          lat: tile.lat,
          lon: tile.lon,
          speed: tile.v ?? null,
          free_flow_speed: tile.fv ?? null,
          congestion_level: tile.c ?? null,
          travel_time: tile.t ?? null,
          network_length: tile.l ?? null,
          point_geom: null, // Populated by SqlFilterEngine using ST_Point(lon, lat)
        });
      }
    }
  }

  tables.set("timed_data", timedRows as unknown as Record<string, unknown>[]);
  tables.set("tiled_data", tiledRows as unknown as Record<string, unknown>[]);

  return { tables };
}
