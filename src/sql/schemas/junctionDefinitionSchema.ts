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
 * Table schema for junction summary info
 */
export const JUNCTIONS_TABLE: TableDefinition = {
  name: "junctions",
  columns: [
    { name: "junction_id", type: "TEXT", nullable: false },
    { name: "name", type: "TEXT", nullable: true },
    { name: "status", type: "TEXT", nullable: true },
    { name: "country_code", type: "TEXT", nullable: true },
    { name: "drive_on_left", type: "INTEGER", nullable: true }, // 0/1 boolean
    { name: "traffic_lights", type: "INTEGER", nullable: true }, // 0/1 boolean
    { name: "num_approaches", type: "INTEGER", nullable: false },
    { name: "num_exits", type: "INTEGER", nullable: false },
    { name: "created_at", type: "TEXT", nullable: true },
    { name: "last_modified_at", type: "TEXT", nullable: true },
    { name: "time_zone", type: "TEXT", nullable: true },
  ],
};

/**
 * Table schema for junction approach details (full view only)
 */
export const JUNCTION_APPROACHES_TABLE: TableDefinition = {
  name: "approaches",
  columns: [
    { name: "junction_id", type: "TEXT", nullable: false },
    { name: "approach_id", type: "INTEGER", nullable: false },
    { name: "name", type: "TEXT", nullable: true },
    { name: "road_name", type: "TEXT", nullable: true },
    { name: "direction", type: "TEXT", nullable: true },
    { name: "frc", type: "INTEGER", nullable: true },
    { name: "length", type: "REAL", nullable: true },
    { name: "one_way_road", type: "INTEGER", nullable: true }, // 0/1 boolean
    { name: "excluded", type: "INTEGER", nullable: true }, // 0/1 boolean
    { name: "drivable", type: "INTEGER", nullable: true }, // 0/1 boolean
  ],
};

/**
 * Table schema for junction exit details (full view only)
 */
export const JUNCTION_EXITS_TABLE: TableDefinition = {
  name: "exits",
  columns: [
    { name: "junction_id", type: "TEXT", nullable: false },
    { name: "exit_id", type: "INTEGER", nullable: false },
    { name: "name", type: "TEXT", nullable: true },
    { name: "road_name", type: "TEXT", nullable: true },
    { name: "direction", type: "TEXT", nullable: true },
    { name: "frc", type: "INTEGER", nullable: true },
    { name: "one_way_road", type: "INTEGER", nullable: true }, // 0/1 boolean
    { name: "drivable", type: "INTEGER", nullable: true }, // 0/1 boolean
  ],
};

/**
 * Compact schema for junction search (junctions table only)
 */
export const JUNCTION_DEFINITION_COMPACT_SCHEMA: TableDefinition[] = [JUNCTIONS_TABLE];

/**
 * Full schema for junction search (junctions + approaches + exits)
 */
export const JUNCTION_DEFINITION_FULL_SCHEMA: TableDefinition[] = [
  JUNCTIONS_TABLE,
  JUNCTION_APPROACHES_TABLE,
  JUNCTION_EXITS_TABLE,
];
