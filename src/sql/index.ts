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

// Core SQL engine
export { SqlFilterEngine } from "./sqlFilterEngine";

// Type definitions
export type {
  SqlColumnType,
  ColumnDefinition,
  TableDefinition,
  FlattenResult,
  SqlQueryResult,
  SqlQueryErrorResult,
  SqlQueryExecutionResult,
  SqlFilterMetadata,
  SqlFilteredResponse,
} from "./types";

// Values and utilities from types
export { SQL_FILTER_DEFAULTS, isQueryError } from "./types";

// Flatteners
export {
  flattenJunctionArchive,
  flattenAreaAnalyticsResults,
  flattenRouteMonitoringDetails,
  flattenJunctionLiveData,
  flattenTrafficIncidents,
  flattenTrafficFlowSegment,
  flattenJunctionDefinitions,
  flattenRouteList,
} from "./flatteners";

// Schemas
export {
  JUNCTION_ARCHIVE_SCHEMA,
  JUNCTION_ARCHIVE_SQL_EXAMPLES,
  AREA_ANALYTICS_SCHEMA,
  AREA_ANALYTICS_SQL_EXAMPLES,
  ROUTE_MONITORING_SCHEMA,
  ROUTE_MONITORING_SQL_EXAMPLES,
  JUNCTION_LIVE_DATA_SCHEMA,
  JUNCTION_LIVE_DATA_SQL_EXAMPLES,
  TRAFFIC_INCIDENTS_SCHEMA,
  TRAFFIC_INCIDENTS_SQL_EXAMPLES,
  TRAFFIC_FLOW_SEGMENT_SCHEMA,
  TRAFFIC_FLOW_SEGMENT_SQL_EXAMPLES,
  JUNCTION_DEFINITION_COMPACT_SCHEMA,
  JUNCTION_DEFINITION_FULL_SCHEMA,
  ROUTE_LIST_SCHEMA,
} from "./schemas";
