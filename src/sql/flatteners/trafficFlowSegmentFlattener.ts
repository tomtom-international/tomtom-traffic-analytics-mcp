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
import { TrafficFlowSegmentResponse } from "../../services/live-traffic/types";

/**
 * Flattened flow segment row for SQL table
 */
interface FlowSegmentRow {
  frc: string | null;
  current_speed: number | null;
  free_flow_speed: number | null;
  current_travel_time: number | null;
  free_flow_travel_time: number | null;
  confidence: number | null;
  road_closure: number | null;
  coordinates: string | null;
  openlr: string | null;
  geom_geojson: string | null; // Full GeoJSON geometry for ST_GeomFromGeoJSON
  geom: null; // Placeholder for native GEOMETRY (populated by engine)
}

/**
 * Flatten TrafficFlowSegmentResponse into SQL-queryable table
 *
 * Creates one table:
 * - flow_segment: Single row with flow data for the queried segment
 *
 * @param response - Raw API response from flow segment endpoint
 * @returns FlattenResult with flow_segment table
 */
export function flattenTrafficFlowSegment(response: TrafficFlowSegmentResponse): FlattenResult {
  const tables = new Map<string, Record<string, unknown>[]>();

  // Build a valid RFC 7946 GeoJSON LineString. The TomTom Flow Segment API
  // returns each point as a { latitude, longitude } object, but GeoJSON
  // requires coordinates as flat [longitude, latitude] arrays — without this
  // mapping, ST_GeomFromGeoJSON(geom_geojson) cannot parse the value.
  const geojsonGeometry = response.coordinates
    ? {
        type: "LineString",
        coordinates: response.coordinates.map((c) => [c.longitude, c.latitude]),
      }
    : null;

  const flowRow: FlowSegmentRow = {
    frc: response.frc ?? null,
    current_speed: response.currentSpeed ?? null,
    free_flow_speed: response.freeFlowSpeed ?? null,
    current_travel_time: response.currentTravelTime ?? null,
    free_flow_travel_time: response.freeFlowTravelTime ?? null,
    confidence: response.confidence ?? null,
    road_closure: response.roadClosure != null ? (response.roadClosure ? 1 : 0) : null,
    coordinates: response.coordinates ? JSON.stringify(response.coordinates) : null,
    openlr: response.openlr ?? null,
    geom_geojson: geojsonGeometry ? JSON.stringify(geojsonGeometry) : null, // Full GeoJSON for spatial queries
    geom: null, // Populated by SqlFilterEngine
  };

  tables.set("flow_segment", [flowRow] as unknown as Record<string, unknown>[]);

  return { tables };
}
