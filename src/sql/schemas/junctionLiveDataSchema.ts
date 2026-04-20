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

import { TableDefinition } from "../types";

/**
 * Table schema for junction live data approaches (real-time metrics)
 */
export const LIVE_APPROACHES_TABLE: TableDefinition = {
  name: "approaches",
  columns: [
    { name: "junction_id", type: "TEXT", nullable: false },
    { name: "approach_id", type: "INTEGER", nullable: false },
    { name: "travel_time_sec", type: "REAL", nullable: true },
    { name: "free_flow_travel_time_sec", type: "REAL", nullable: true },
    { name: "delay_sec", type: "REAL", nullable: true },
    { name: "usual_delay_sec", type: "REAL", nullable: true },
    { name: "stops", type: "REAL", nullable: true },
    { name: "queue_length_meters", type: "REAL", nullable: true },
    { name: "volume_per_hour", type: "REAL", nullable: true },
    { name: "is_closed", type: "INTEGER", nullable: true },
  ],
};

/**
 * Table schema for junction live data turn ratios
 */
export const LIVE_TURN_RATIOS_TABLE: TableDefinition = {
  name: "turn_ratios",
  columns: [
    { name: "junction_id", type: "TEXT", nullable: false },
    { name: "approach_id", type: "INTEGER", nullable: false },
    { name: "exit_id", type: "INTEGER", nullable: false },
    { name: "exit_index", type: "INTEGER", nullable: true },
    { name: "ratio_percent", type: "REAL", nullable: true },
    { name: "probes_count", type: "INTEGER", nullable: true },
  ],
};

/**
 * Table schema for stops histogram data
 */
export const STOPS_HISTOGRAM_TABLE: TableDefinition = {
  name: "stops_histogram",
  columns: [
    { name: "junction_id", type: "TEXT", nullable: false },
    { name: "approach_id", type: "INTEGER", nullable: false },
    { name: "number_of_stops", type: "INTEGER", nullable: false },
    { name: "number_of_vehicles", type: "INTEGER", nullable: true },
  ],
};

/**
 * Table schema for junction metadata (requires include_geometry=true)
 */
export const JUNCTION_METADATA_TABLE: TableDefinition = {
  name: "junction_metadata",
  columns: [
    { name: "junction_id", type: "TEXT", nullable: false },
    { name: "name", type: "TEXT", nullable: true },
    { name: "country_code", type: "TEXT", nullable: true },
    { name: "drive_on_left", type: "INTEGER", nullable: true },
    { name: "traffic_lights", type: "INTEGER", nullable: true },
  ],
};

/**
 * Table schema for approach metadata (requires include_geometry=true)
 */
export const APPROACH_METADATA_TABLE: TableDefinition = {
  name: "approach_metadata",
  columns: [
    { name: "junction_id", type: "TEXT", nullable: false },
    { name: "approach_id", type: "INTEGER", nullable: false },
    { name: "name", type: "TEXT", nullable: true },
    { name: "road_name", type: "TEXT", nullable: true },
    { name: "direction", type: "TEXT", nullable: true },
    { name: "frc", type: "INTEGER", nullable: true },
    { name: "length", type: "REAL", nullable: true },
    { name: "one_way_road", type: "INTEGER", nullable: true },
    { name: "excluded", type: "INTEGER", nullable: true },
    { name: "drivable", type: "INTEGER", nullable: true },
  ],
};

/**
 * Table schema for exit metadata (requires include_geometry=true)
 */
export const EXIT_METADATA_TABLE: TableDefinition = {
  name: "exit_metadata",
  columns: [
    { name: "junction_id", type: "TEXT", nullable: false },
    { name: "exit_id", type: "INTEGER", nullable: false },
    { name: "name", type: "TEXT", nullable: true },
    { name: "road_name", type: "TEXT", nullable: true },
    { name: "direction", type: "TEXT", nullable: true },
    { name: "frc", type: "INTEGER", nullable: true },
    { name: "one_way_road", type: "INTEGER", nullable: true },
    { name: "drivable", type: "INTEGER", nullable: true },
  ],
};

/**
 * Complete schema for junction live data tool
 */
export const JUNCTION_LIVE_DATA_SCHEMA: TableDefinition[] = [
  LIVE_APPROACHES_TABLE,
  LIVE_TURN_RATIOS_TABLE,
  STOPS_HISTOGRAM_TABLE,
  JUNCTION_METADATA_TABLE,
  APPROACH_METADATA_TABLE,
  EXIT_METADATA_TABLE,
];

/**
 * SQL query examples for junction live data tool documentation
 */
export const JUNCTION_LIVE_DATA_SQL_EXAMPLES = `
Available tables:
- approaches: junction_id, approach_id, travel_time_sec, free_flow_travel_time_sec, delay_sec, usual_delay_sec, stops, queue_length_meters, volume_per_hour, is_closed
- turn_ratios: junction_id, approach_id, exit_id, exit_index, ratio_percent, probes_count
- stops_histogram: junction_id, approach_id, number_of_stops, number_of_vehicles
- junction_metadata: junction_id, name, country_code, drive_on_left, traffic_lights (requires include_geometry=true)
- approach_metadata: junction_id, approach_id, name, road_name, direction, frc, length, one_way_road, excluded, drivable (requires include_geometry=true)
- exit_metadata: junction_id, exit_id, name, road_name, direction, frc, one_way_road, drivable (requires include_geometry=true)

Example queries:
1. Most delayed approaches:
   SELECT approach_id, delay_sec, queue_length_meters FROM approaches ORDER BY delay_sec DESC LIMIT 5

2. Turn ratio distribution for specific approach:
   SELECT exit_id, ratio_percent, probes_count FROM turn_ratios WHERE approach_id = 1 ORDER BY ratio_percent DESC

3. Approaches with high queue lengths (with metadata):
   SELECT a.approach_id, am.road_name, a.queue_length_meters, a.delay_sec
   FROM approaches a LEFT JOIN approach_metadata am ON a.approach_id = am.approach_id
   WHERE a.queue_length_meters > 50 ORDER BY a.queue_length_meters DESC

4. Junction summary with metadata:
   SELECT jm.name, jm.traffic_lights, COUNT(a.approach_id) as num_approaches, AVG(a.delay_sec) as avg_delay
   FROM junction_metadata jm LEFT JOIN approaches a ON jm.junction_id = a.junction_id GROUP BY jm.junction_id
`.trim();
