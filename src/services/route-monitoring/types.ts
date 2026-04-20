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

/**
 * Coordinate representation for latitude and longitude
 */
export interface PathPoint {
  latitude: number;
  longitude: number;
}

/**
 * Basic route information returned from listing
 */
export interface RouteBasicInfo {
  routeId: number;
  routeName: string;
  routeStatus: string;
  routePathPoints: PathPoint[];
  travelTime?: number;
  typicalTravelTime?: number;
  delayTime?: number;
  passable?: boolean;
  routeLength: number;
  completeness?: number;
  typicalTravelTimeCoverage?: number;
}

/**
 * Detailed segment information for a route
 */
export interface RouteSegment {
  segmentId: number;
  segmentIdStr: string;
  averageSpeed?: number;
  typicalSpeed?: number;
  segmentLength: number;
  openLrId?: string;
  currentSpeed?: number;
  relativeSpeed?: number;
  confidence?: number;
  openLrLength?: number;
  shape?: PathPoint[];
}

/**
 * Detailed route information with segments
 */
export interface RouteDetailedInfo extends RouteBasicInfo {
  routeConfidence?: number;
  detailedSegments?: RouteSegment[];
}

/**
 * Route status constants
 */
export const ROUTE_STATUS = {
  NEW: "NEW",
  ACTIVE: "ACTIVE",
  UPDATING: "UPDATING",
  FAILED: "FAILED",
  ARCHIVED: "ARCHIVED",
} as const;

export type RouteStatus = (typeof ROUTE_STATUS)[keyof typeof ROUTE_STATUS];
