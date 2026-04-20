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
import { TrafficIncidentsResult } from "../../services/live-traffic/types";
import { mapIconCategory, mapMagnitudeOfDelay } from "./mappings";

/**
 * Flattened incident row for SQL table
 */
interface IncidentRow {
  area_name: string | null; // Area identifier for multi-bbox comparison queries
  id: string;
  iconCategory: string;
  magnitudeOfDelay: string | null;
  startTime: string | null;
  endTime: string | null;
  from: string | null;
  to: string | null;
  length: number | null;
  delay: number | null;
  roadNumbers: string | null;
  timeValidity: string | null;
  probabilityOfOccurrence: string | null;
  numberOfReports: number | null;
  lastReportTime: string | null;
  geometry_type: string;
  coordinates: string;
  geom_geojson: string | null; // Full GeoJSON geometry for ST_GeomFromGeoJSON
  geom: null; // Placeholder for native GEOMETRY (populated by engine)
}

/**
 * Flatten TrafficIncidentsResult into SQL-queryable table
 *
 * Creates one table:
 * - incidents: One row per traffic incident
 *
 * @param response - Raw API response from traffic incidents endpoint
 * @param areaName - Optional area name for multi-bbox comparison queries
 * @returns FlattenResult with incidents table
 */
export function flattenTrafficIncidents(
  response: TrafficIncidentsResult,
  areaName?: string
): FlattenResult {
  const tables = new Map<string, Record<string, unknown>[]>();

  const incidentRows: IncidentRow[] = (response.incidents ?? []).map((incident) => ({
    area_name: areaName ?? null,
    id: incident.properties.id,
    iconCategory: mapIconCategory(incident.properties.iconCategory),
    magnitudeOfDelay: mapMagnitudeOfDelay(incident.properties.magnitudeOfDelay ?? null),
    startTime: incident.properties.startTime ?? null,
    endTime: incident.properties.endTime ?? null,
    from: incident.properties.from ?? null,
    to: incident.properties.to ?? null,
    length: incident.properties.length ?? null,
    delay: incident.properties.delay ?? null,
    roadNumbers: incident.properties.roadNumbers
      ? JSON.stringify(incident.properties.roadNumbers)
      : null,
    timeValidity:
      typeof incident.properties.timeValidity === "string"
        ? incident.properties.timeValidity
        : null,
    probabilityOfOccurrence: incident.properties.probabilityOfOccurrence ?? null,
    numberOfReports: incident.properties.numberOfReports ?? null,
    lastReportTime: incident.properties.lastReportTime ?? null,
    geometry_type: incident.geometry.type,
    coordinates: JSON.stringify(incident.geometry.coordinates),
    geom_geojson: JSON.stringify(incident.geometry), // Full GeoJSON for spatial queries
    geom: null, // Populated by SqlFilterEngine
  }));

  tables.set("incidents", incidentRows as unknown as Record<string, unknown>[]);

  return { tables };
}
