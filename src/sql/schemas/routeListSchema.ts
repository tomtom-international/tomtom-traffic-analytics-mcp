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
 * Table schema for route list summary info
 */
export const ROUTES_TABLE: TableDefinition = {
  name: "routes",
  columns: [
    { name: "route_id", type: "INTEGER", nullable: false },
    { name: "route_name", type: "TEXT", nullable: true },
    { name: "route_status", type: "TEXT", nullable: true },
    { name: "travel_time", type: "REAL", nullable: true },
    { name: "typical_travel_time", type: "REAL", nullable: true },
    { name: "delay_time", type: "REAL", nullable: true },
    { name: "passable", type: "INTEGER", nullable: true }, // 0/1 boolean
    { name: "route_length", type: "REAL", nullable: true },
    { name: "completeness", type: "REAL", nullable: true },
    { name: "typical_travel_time_coverage", type: "REAL", nullable: true },
  ],
};

/**
 * Schema for route search tool
 */
export const ROUTE_LIST_SCHEMA: TableDefinition[] = [ROUTES_TABLE];
