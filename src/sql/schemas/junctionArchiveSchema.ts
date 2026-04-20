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
 * Table schema for junction archive approaches data
 */
export const APPROACHES_TABLE: TableDefinition = {
  name: "approaches",
  columns: [
    { name: "time", type: "TEXT", nullable: false },
    { name: "junction_id", type: "TEXT", nullable: false },
    { name: "approach_id", type: "TEXT", nullable: false },
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
 * Table schema for junction archive turn ratios data
 */
export const TURN_RATIOS_TABLE: TableDefinition = {
  name: "turn_ratios",
  columns: [
    { name: "time", type: "TEXT", nullable: false },
    { name: "junction_id", type: "TEXT", nullable: false },
    { name: "approach_id", type: "TEXT", nullable: false },
    { name: "exit_id", type: "TEXT", nullable: false },
    { name: "exit_index", type: "INTEGER", nullable: true },
    { name: "ratio_percent", type: "REAL", nullable: true },
    { name: "probes_count", type: "INTEGER", nullable: true },
  ],
};

/**
 * Complete schema for junction archive tool
 */
export const JUNCTION_ARCHIVE_SCHEMA: TableDefinition[] = [APPROACHES_TABLE, TURN_RATIOS_TABLE];

/**
 * SQL query examples for junction archive tool documentation
 */
export const JUNCTION_ARCHIVE_SQL_EXAMPLES = `
Available tables: approaches, turn_ratios

Example queries:
1. Hourly delay analysis:
   SELECT strftime('%H', time) as hour, AVG(delay_sec) as avg_delay, MAX(delay_sec) as max_delay
   FROM approaches GROUP BY strftime('%H', time) ORDER BY avg_delay DESC

2. Top congested approaches:
   SELECT approach_id, AVG(delay_sec) as avg_delay, AVG(queue_length_meters) as avg_queue
   FROM approaches WHERE delay_sec > 30 GROUP BY approach_id ORDER BY avg_delay DESC LIMIT 5

3. Turn ratio distribution:
   SELECT approach_id, exit_id, AVG(ratio_percent) as avg_ratio
   FROM turn_ratios GROUP BY approach_id, exit_id HAVING avg_ratio > 20
`.trim();
