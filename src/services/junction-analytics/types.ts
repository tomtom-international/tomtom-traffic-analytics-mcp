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

// Common types for geometry
export interface GeoJSONPoint {
  type: "Point";
  coordinates: [number, number];
}

export interface GeoJSONPolygon {
  type: "Polygon";
  coordinates: number[][][];
}

export interface GeoJSONMultiLineString {
  type: "MultiLineString";
  coordinates: number[][][];
}

export interface GeoJSONFeature {
  type: "Feature";
  geometry: GeoJSONPoint | GeoJSONPolygon;
  properties: Record<string, any>;
}

// Junction Analytics API types
export interface JunctionDefinition {
  id: string;
  name: string;
  status: "PREVIEW" | "ACTIVE" | "PENDING_UPDATE" | "ERROR";
  statusDetail?: string;
  rawJunction: GeoJSONFeature;
  detectionConfig: {
    autodetectName: boolean;
  };
  junctionModel?: JunctionModel;
  createdAt: string;
  lastModifiedAt: string;
  lastUserUpdatedAt: string;
  timeZone: string;
}

export interface JunctionModel {
  id?: string;
  name: string;
  countryCode: string;
  driveOnLeft: boolean;
  trafficLights: boolean;
  approaches: Approach[];
  exits: Exit[];
}

export interface Approach {
  id: number;
  name: string;
  roadName: string;
  direction: "SOUTH" | "WEST" | "EAST" | "NORTH" | "CLOCKWISE" | "COUNTER_CLOCKWISE";
  frc: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;
  length: number;
  oneWayRoad: boolean;
  excluded: boolean;
  drivable: boolean;
  segmentedGeometry: GeoJSONMultiLineString;
  userPoints: GeoJSONPoint[];
  openlr: string;
  dataNotAvailable: boolean;
  arrivalPoints?: ArrivalPoint[];
}

export interface Exit {
  id: number;
  name: string;
  roadName: string;
  direction: "SOUTH" | "WEST" | "EAST" | "NORTH" | "CLOCKWISE" | "COUNTER_CLOCKWISE";
  frc: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;
  oneWayRoad: boolean;
  drivable: boolean;
  segmentedGeometry: GeoJSONMultiLineString;
  openlr: string;
}

export interface ArrivalPoint {
  id: number;
  name: string;
  userPoint: GeoJSONPoint;
  projectedPoint: GeoJSONPoint;
}

// Live data types
export interface ApproachLiveData {
  id: number;
  travelTimeSec: number;
  freeFlowTravelTimeSec: number;
  delaySec: number;
  usualDelaySec: number;
  stops: number;
  queueLengthMeters: number;
  isClosed: boolean;
  volumePerHour?: number;
  turnRatios: TurnRatio[];
  stopsHistogram: StopsHistogram;
}

export interface TurnRatio {
  exitId: number;
  exitIndex: number;
  ratioPercent: number;
  probesCount: number;
}

export interface StopsHistogram {
  entries: Array<{
    numberOfStops: number;
    numberOfVehicles: number;
  }>;
}

export interface JunctionLiveData {
  id: string;
  approachesLiveData: ApproachLiveData[];
  junctionModel?: JunctionModel;
}

export interface JunctionDefinitionListResponse {
  content: JunctionDefinition[];
  pageable: {
    pageNumber: number;
    pageSize: number;
    offset: number;
    paged: boolean;
    unpaged: boolean;
  };
  last: boolean;
  totalElements: number;
  totalPages: number;
  numberOfElements: number;
  first: boolean;
  size: number;
  number: number;
  empty: boolean;
}

// Archive types
export interface JunctionArchiveApproachData {
  time: string;
  junctionId: string;
  approachId: string;
  travelTimeSec: number;
  freeFlowTravelTimeSec: number;
  delaySec: number;
  usualDelaySec: number;
  stops: number;
  queueLengthMeters: number;
  volumePerHour: number;
  isClosed: boolean;
  stopsHistogram: string;
}

export interface JunctionArchiveTurnRatioData {
  time: string;
  junctionId: string;
  approachId: string;
  exitId: string;
  exitIndex: number;
  ratioPercent: number;
  probesCount: number;
}

export interface JunctionArchiveJsonResponse {
  approaches: JunctionArchiveApproachData[];
  turnRatios: JunctionArchiveTurnRatioData[];
}

// Common request options
export interface BaseJunctionOptions {
  includeGeometry?: boolean;
}

export interface PaginationOptions {
  page?: number;
  size?: number;
}

export interface DateRangeOptions {
  from: string;
  to?: string;
}
