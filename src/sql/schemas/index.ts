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

export {
  JUNCTION_ARCHIVE_SCHEMA,
  APPROACHES_TABLE,
  TURN_RATIOS_TABLE,
  JUNCTION_ARCHIVE_SQL_EXAMPLES,
} from "./junctionArchiveSchema";

export {
  AREA_ANALYTICS_SCHEMA,
  TIMED_DATA_TABLE,
  TILED_DATA_TABLE,
  AREA_ANALYTICS_SQL_EXAMPLES,
} from "./areaAnalyticsSchema";

export {
  ROUTE_MONITORING_SCHEMA,
  ROUTE_INFO_TABLE,
  SEGMENTS_TABLE,
  ROUTE_MONITORING_SQL_EXAMPLES,
} from "./routeMonitoringSchema";

export {
  JUNCTION_LIVE_DATA_SCHEMA,
  LIVE_APPROACHES_TABLE,
  LIVE_TURN_RATIOS_TABLE,
  STOPS_HISTOGRAM_TABLE,
  JUNCTION_METADATA_TABLE,
  APPROACH_METADATA_TABLE,
  EXIT_METADATA_TABLE,
  JUNCTION_LIVE_DATA_SQL_EXAMPLES,
} from "./junctionLiveDataSchema";

export {
  TRAFFIC_INCIDENTS_SCHEMA,
  INCIDENTS_TABLE,
  TRAFFIC_INCIDENTS_SQL_EXAMPLES,
} from "./trafficIncidentsSchema";

export {
  TRAFFIC_FLOW_SEGMENT_SCHEMA,
  FLOW_SEGMENT_TABLE,
  TRAFFIC_FLOW_SEGMENT_SQL_EXAMPLES,
} from "./trafficFlowSegmentSchema";

export {
  JUNCTION_DEFINITION_COMPACT_SCHEMA,
  JUNCTION_DEFINITION_FULL_SCHEMA,
  JUNCTIONS_TABLE,
  JUNCTION_APPROACHES_TABLE,
  JUNCTION_EXITS_TABLE,
} from "./junctionDefinitionSchema";

export { ROUTE_LIST_SCHEMA, ROUTES_TABLE } from "./routeListSchema";
