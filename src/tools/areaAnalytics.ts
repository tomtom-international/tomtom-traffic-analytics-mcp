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

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { areaAnalyticsStatsSchema } from "../schemas/area-analytics/areaAnalyticsSchema";
import { getAreaAnalyticsStatsHandler } from "../handlers/areaAnalyticsHandler";

/**
 * Creates and registers Area Analytics tools
 */
export function createAreaAnalyticsTools(server: McpServer): void {
  server.registerTool(
    "tomtom-area-analytics-stats",
    {
      description: `Retrieve historical traffic patterns (speed, free-flow speed, congestion, travel time) for one GeoJSON polygon over up to a 31-day window. NOT real-time — data has a 24–48h processing delay. timed_data = time-series across the polygon (trends over hours/days/months); tiled_data = spatial grid cells within the polygon (hotspot locations). Use for trend analysis, peak vs off-peak comparison, and hotspot detection.

    REQUIRES js_queries — e.g. {"daily_avg": "timed_data.filter(r => r.aggregation_type === 'daily').map(r => ({ day: r.time, congestion: r.congestion_level }))"}.

    **Runtime:** sandboxed JavaScript — see the server instructions for the query contract.

    **Available datasets:**
    - timed_data: region_name, timezone, level, aggregation_type ('all'|'yearly'|'monthly'|'daily'|'hourly'), time, speed, free_flow_speed, congestion_level (0-100; 0=free flow, 100=standstill), travel_time, network_length
    - tiled_data: region_name, lat, lon, geom (GeoJSON Point of the tile centre — use for turf; lat/lon are there for h3), speed, free_flow_speed, congestion_level (0-100), travel_time, network_length

    Note: field content depends on the dataTypes you request. Valid values: NETWORK_LENGTH, CONGESTION_LEVEL, FREE_FLOW_SPEED, TRAVEL_TIME, SPEED. E.g. free_flow_speed is only populated if FREE_FLOW_SPEED is in dataTypes.

    **Example queries:**
    - Daily trend: timed_data.filter(r => r.aggregation_type === 'daily').map(r => ({ day: r.time, congestion: +r.congestion_level.toFixed(2) }))
    - Hotspots: [...tiled_data].sort((a, b) => b.congestion_level - a.congestion_level).slice(0, 20)
    - Peak hour: Object.entries(Object.groupBy(timed_data.filter(r => r.aggregation_type === 'hourly'), r => new Date(r.time).getUTCHours())).map(([hour, rows]) => ({ hour: +hour, avg: rows.reduce((s, r) => s + r.congestion_level, 0) / rows.length })).sort((a, b) => b.avg - a.avg)
    - Within 1km of a point: tiled_data.filter(t => turf.distance(t.geom, [4.9, 52.37], { units: 'meters' }) < 1000)
    - H3 hex-binned hotspots: Object.entries(Object.groupBy(tiled_data, t => h3.latLngToCell(t.lat, t.lon, 8))).map(([cell, rows]) => ({ cell, center: h3.cellToLatLng(cell), congestion: +(rows.reduce((s, r) => s + r.congestion_level, 0) / rows.length).toFixed(1) })).sort((a, b) => b.congestion - a.congestion).slice(0, 10)`,
      inputSchema: areaAnalyticsStatsSchema,
    },
    getAreaAnalyticsStatsHandler()
  );
}
