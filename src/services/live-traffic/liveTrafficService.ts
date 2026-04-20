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

import { trafficAPIClient, validateTomTomApiKey, API_VERSION } from "../base/tomtomClient";
import { handleApiError } from "../../utils/errorHandler";
import { logger } from "../../utils/logger";
import {
  TrafficFlowSegmentRequest,
  TrafficIncidentsOptions,
  TrafficIncidentsResult,
  DEFAULT_OPTIONS,
} from "./types";

// ============================================================================
// Traffic Flow Segment Data
// ============================================================================

/**
 * Get live traffic segment data for a specific point
 * @param request Live traffic request parameters
 * @returns Live traffic data including speeds, travel times, and coordinates
 */
export async function getFlowSegmentData(request: TrafficFlowSegmentRequest): Promise<any> {
  try {
    validateTomTomApiKey();

    const { point, style, zoom, format = "json", unit, thickness, openLr } = request;

    logger.info(`Fetching live traffic data for point: ${point.latitude},${point.longitude}`);
    logger.info(
      `Request URL: /traffic/services/${API_VERSION.TRAFFIC_FLOW}/flowSegmentData/${style}/${zoom}/${format}`
    );

    const params: Record<string, any> = {
      point: `${point.latitude},${point.longitude}`,
    };

    if (unit) params.unit = unit;
    if (thickness) params.thickness = thickness;
    if (openLr !== undefined) params.openLr = openLr;

    logger.info(`Request params: ${JSON.stringify(params, null, 2)}`);

    const response = await trafficAPIClient.get(
      `/traffic/services/${API_VERSION.TRAFFIC_FLOW}/flowSegmentData/${style}/${zoom}/${format}`,
      { params }
    );

    logger.info(`Flow segment data retrieved successfully`);

    // Return raw API response without modifications
    return response.data;
  } catch (error) {
    throw handleApiError(error, "getFlowSegmentData");
  }
}

/**
 * Build request parameters for traffic incidents API
 */
function buildTrafficIncidentsParams(
  bbox: string,
  options: TrafficIncidentsOptions
): Record<string, string | number> {
  const params: Record<string, string | number> = {
    bbox,
    fields: options.fields || DEFAULT_OPTIONS.fields,
    language: options.language || DEFAULT_OPTIONS.language,
    timeValidityFilter: options.timeValidityFilter || DEFAULT_OPTIONS.timeValidityFilter,
  };

  // Add optional parameters if provided
  if (options.maxResults !== undefined) {
    params.maxResults = options.maxResults;
  }

  // Handle incident type filtering
  if (options.categoryFilter) {
    params.categoryFilter = Array.isArray(options.categoryFilter)
      ? options.categoryFilter.join(",")
      : options.categoryFilter;
  }

  return params;
}

/**
 * Create debug information for the request
 */
function createDebugInfo(endpoint: string, params: Record<string, string | number>): void {
  const baseURL = trafficAPIClient.defaults.baseURL;
  const apiKey = trafficAPIClient.defaults.params?.key;

  const requestParams = { key: apiKey, ...params };
  const queryParams = new URLSearchParams(requestParams as any).toString();
  const fullURL = `${baseURL}${endpoint}?${queryParams}`;

  logger.info(`Traffic incidents request URL: ${fullURL}`);
}

/**
 * Execute the actual traffic incidents API request
 */
async function executeTrafficIncidentsRequest(
  bbox: string,
  options: TrafficIncidentsOptions
): Promise<TrafficIncidentsResult> {
  const endpoint = `/traffic/services/${API_VERSION.TRAFFIC}/incidentDetails`;
  const params = buildTrafficIncidentsParams(bbox, options);

  // Add API key to request parameters
  const apiKey = trafficAPIClient.defaults.params?.key;
  const requestParams = { key: apiKey, ...params };

  // Create debug information
  createDebugInfo(endpoint, params);

  // Make the API request
  const response = await trafficAPIClient.get(endpoint, {
    params: requestParams,
  });

  return response.data;
}

/**
 * Validate bounding box format
 */
function validateBoundingBox(bbox: string): void {
  const coords = bbox.split(",");
  if (coords.length !== 4) {
    throw new Error('Bounding box must be in format "minLon,minLat,maxLon,maxLat"');
  }

  const [minLon, minLat, maxLon, maxLat] = coords.map((coord) => parseFloat(coord.trim()));

  if (coords.some((coord) => isNaN(parseFloat(coord.trim())))) {
    throw new Error("All bounding box coordinates must be valid numbers");
  }

  if (minLon >= maxLon || minLat >= maxLat) {
    throw new Error("Invalid bounding box: min coordinates must be less than max coordinates");
  }

  if (minLon < -180 || maxLon > 180 || minLat < -90 || maxLat > 90) {
    throw new Error(
      "Bounding box coordinates must be within valid ranges (longitude: -180 to 180, latitude: -90 to 90)"
    );
  }
}

/**
 * Get traffic incidents in a specified bounding box area
 *
 * Returns information about traffic incidents (accidents, roadworks, closures, etc.)
 * within the specified geographic area.
 *
 * @param bbox Bounding box in format "minLon,minLat,maxLon,maxLat"
 * @param options Additional options for filtering incidents
 * @returns List of traffic incidents with details
 *
 * @example
 * ```typescript
 * // Get traffic incidents in Amsterdam
 * const incidents = await getTrafficIncidents("4.8854,52.3668,4.9416,52.3791");
 *
 * // Get only road closures and accidents
 * const incidents = await getTrafficIncidents(
 *   "4.8854,52.3668,4.9416,52.3791",
 *   {
 *     categoryFilter: [TRAFFIC_INCIDENT_CATEGORIES.ROAD_CLOSURE, TRAFFIC_INCIDENT_CATEGORIES.ACCIDENT],
 *     maxResults: 50
 *   }
 * );
 * ```
 */
export async function getTrafficIncidents(
  bbox: string,
  options: TrafficIncidentsOptions = {}
): Promise<TrafficIncidentsResult> {
  validateTomTomApiKey();
  validateBoundingBox(bbox);

  logger.debug(
    `Getting traffic incidents for bbox: ${bbox}, ` +
      `language: ${options.language || DEFAULT_OPTIONS.language}, ` +
      `timeValidityFilter: ${options.timeValidityFilter || DEFAULT_OPTIONS.timeValidityFilter}`
  );

  return await executeTrafficIncidentsRequest(bbox, options);
}

/**
 * Utility function to create a bounding box string from coordinates
 * @param minLon Minimum longitude
 * @param minLat Minimum latitude
 * @param maxLon Maximum longitude
 * @param maxLat Maximum latitude
 * @returns Formatted bounding box string
 */
export function createBoundingBox(
  minLon: number,
  minLat: number,
  maxLon: number,
  maxLat: number
): string {
  return `${minLon},${minLat},${maxLon},${maxLat}`;
}

/**
 * Utility function to get traffic incidents by center point and radius
 * @param centerLat Center latitude
 * @param centerLon Center longitude
 * @param radiusKm Radius in kilometers
 * @param options Additional options for filtering incidents
 * @returns List of traffic incidents with details
 */
export async function getTrafficIncidentsByRadius(
  centerLat: number,
  centerLon: number,
  radiusKm: number,
  options: TrafficIncidentsOptions = {}
): Promise<TrafficIncidentsResult> {
  // Convert radius to approximate degree offset (rough approximation)
  const degreeOffset = radiusKm / 111; // ~111 km per degree

  const bbox = createBoundingBox(
    centerLon - degreeOffset,
    centerLat - degreeOffset,
    centerLon + degreeOffset,
    centerLat + degreeOffset
  );

  return getTrafficIncidents(bbox, options);
}
