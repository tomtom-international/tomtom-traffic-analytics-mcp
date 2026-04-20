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

// Common GeoJSON types
export interface GeoJSONPolygon {
  type: "Polygon";
  coordinates: number[][][];
}

export interface GeoJSONMultiPolygon {
  type: "MultiPolygon";
  coordinates: number[][][][];
}

export interface GeoJSONFeature {
  type: "Feature";
  geometry: GeoJSONPolygon | GeoJSONMultiPolygon;
  properties: {
    name?: string;
    timezone?: string;
  };
}

// Data types for Area Analytics
export type AreaAnalyticsDataType =
  | "NETWORK_LENGTH"
  | "CONGESTION_LEVEL"
  | "FREE_FLOW_SPEED"
  | "TRAVEL_TIME"
  | "SPEED";

// Functional Road Classes (0-8)
export type FunctionalRoadClass = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;

// Hours (0-23)
export type Hour =
  | 0
  | 1
  | 2
  | 3
  | 4
  | 5
  | 6
  | 7
  | 8
  | 9
  | 10
  | 11
  | 12
  | 13
  | 14
  | 15
  | 16
  | 17
  | 18
  | 19
  | 20
  | 21
  | 22
  | 23;

// Time aggregation data
export interface TimeAggregatedData {
  time: string;
  v?: number; // SPEED
  fv?: number; // FREE_FLOW_SPEED
  c?: number; // CONGESTION_LEVEL
  t?: number; // TRAVEL_TIME
  l?: number; // NETWORK_LENGTH
}

// Tiled data (spatial aggregation)
export interface TiledData {
  lat: number;
  lon: number;
  v?: number; // SPEED
  fv?: number; // FREE_FLOW_SPEED
  c?: number; // CONGESTION_LEVEL
  t?: number; // TRAVEL_TIME
  l?: number; // NETWORK_LENGTH
}

// Report results feature properties
export interface ReportFeatureProperties {
  name: string;
  timezone: string;
  level: number;
  timedData: {
    all: TimeAggregatedData;
    yearly?: TimeAggregatedData[];
    monthly?: TimeAggregatedData[];
    daily?: TimeAggregatedData[];
    hourly?: TimeAggregatedData[];
  };
  tiledData: {
    tiles: TiledData[];
  };
}

// Report results feature
export interface ReportResultsFeature {
  type: "Feature";
  geometry: GeoJSONPolygon | GeoJSONMultiPolygon;
  properties: ReportFeatureProperties;
}

// Report results properties
export interface ReportResultsProperties {
  startDate: string;
  endDate: string;
  dataTypes: AreaAnalyticsDataType[];
  heatmap: boolean;
  frcs: FunctionalRoadClass[];
  hours: Hour[];
}

// Complete report results
export interface AreaAnalyticsReportResults {
  type: "FeatureCollection";
  features: ReportResultsFeature[];
  properties: ReportResultsProperties;
}

// Stats request (lite version with restrictions)
export interface AreaAnalyticsStatsRequest {
  name: string;
  startDate: string; // YYYY-MM-DD format
  endDate: string; // YYYY-MM-DD format (must be within 31 days from startDate)
  hours: Hour[];
  frcs: FunctionalRoadClass[];
  dataTypes: AreaAnalyticsDataType[]; // One or more data types
  features: [GeoJSONFeature]; // Exactly one feature
}

// Stats response (same as report results)
export type AreaAnalyticsStatsResponse = AreaAnalyticsReportResults;
