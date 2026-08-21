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

type Incident = NonNullable<TrafficIncidentsResult["incidents"]>[number];

/**
 * Flattened incident row
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
  roadNumbers: string[] | null;
  timeValidity: string | null;
  probabilityOfOccurrence: string | null;
  numberOfReports: number | null;
  lastReportTime: string | null;
  /** Live array of {description, code, iconCategory} — no JSON parsing needed. */
  events: Incident["properties"]["events"] | null;
  geometry_type: string;
  /** GeoJSON geometry, ready to hand straight to turf. */
  geom: Incident["geometry"] | null;
}

/**
 * Flatten TrafficIncidentsResult into a queryable dataset
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
    roadNumbers: incident.properties.roadNumbers ? incident.properties.roadNumbers : null,
    timeValidity:
      typeof incident.properties.timeValidity === "string"
        ? incident.properties.timeValidity
        : null,
    probabilityOfOccurrence: incident.properties.probabilityOfOccurrence ?? null,
    numberOfReports: incident.properties.numberOfReports ?? null,
    lastReportTime: incident.properties.lastReportTime ?? null,
    events: incident.properties.events ?? null,
    geometry_type: incident.geometry.type,
    geom: incident.geometry, // GeoJSON object — turf.booleanPointInPolygon(row.geom, area)
  }));

  tables.set("incidents", incidentRows as unknown as Record<string, unknown>[]);

  return { tables };
}
