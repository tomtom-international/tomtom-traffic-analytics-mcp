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
import {
  junctionSearchSchema,
  junctionLiveDataDetailsSchema,
  junctionArchiveSchema,
} from "../schemas/junction-analytics/junctionAnalyticsSchema";
import {
  getJunctionSearchHandler,
  getJunctionLiveDataDetailsHandler,
  getJunctionArchiveHandler,
} from "../handlers/junctionAnalyticsHandler";

/**
 * Creates and registers Junction Analytics tools
 */
export function createJunctionAnalyticsTools(server: McpServer): void {
  // Search junctions with sandboxed JS filtering
  server.registerTool(
    "tomtom-junction-search",
    {
      description: `Search and filter all your junctions using JavaScript. Use this FIRST to discover junction IDs by name, status, country, or other properties, then pass the IDs to tomtom-junction-live-data or tomtom-junction-archive for traffic analysis. Returns junction catalog metadata only — no live traffic data. Junctions must be pre-created in Move Portal (no ad-hoc lat/lon queries).

    Fetches ALL junctions (auto-paginating) and loads them into the sandbox.

    REQUIRES js_queries parameter: an object mapping named keys to JavaScript — e.g. {"active": "junctions.filter(j => j.status === 'ACTIVE').map(j => ({ id: j.junction_id, name: j.name }))"}.

    **Runtime: sandboxed JavaScript.** Each query is a single expression, or statements ending in \`return\`. Datasets are plain arrays of objects, bound as locals (also on \`data\`). 5s timeout, 10,000-row and 1 MB result caps. No I/O, no imports. \`Object.groupBy(rows, r => key)\` is the idiomatic GROUP BY. \`turf\` (turf.js v7) and \`h3\` (h3-js v4) are injected automatically when your code references them.

    Booleans are 0/1 numbers (1 = true). FRC scale (Functional Road Class — lower number = more major road): 0=Motorway, 1=Major, 2=OtherMajor, 3=Secondary, 4=LocalConnecting, 5=LocalHigh, 6=Local, 7=LocalMinor.

    **Compact view (default) — dataset: junctions**
    Fields: junction_id, name, status (ACTIVE/PENDING_UPDATE/ERROR), country_code (ISO 3166-1 alpha-3, e.g. ESP/DEU/USA), drive_on_left (0/1), traffic_lights (0/1), num_approaches, num_exits, created_at, last_modified_at, time_zone

    **Full view (view="full") — adds datasets: approaches, exits**
    - approaches: junction_id, approach_id, name, road_name, direction (NORTH/SOUTH/EAST/WEST), frc (numeric 0-7), length, one_way_road (0/1), excluded (0/1), drivable (0/1)
    - exits: junction_id, exit_id, name, road_name, direction, frc (numeric 0-7), one_way_road (0/1), drivable (0/1)

    **Example queries:**
    - Find by name: junctions.filter(j => j.name.toLowerCase().includes('highway')).map(j => ({ id: j.junction_id, name: j.name }))
    - Active junctions: junctions.filter(j => j.status === 'ACTIVE').map(j => ({ id: j.junction_id, name: j.name, country: j.country_code }))
    - Count by country: Object.entries(Object.groupBy(junctions, j => j.country_code)).map(([country, rows]) => ({ country, count: rows.length })).sort((a, b) => b.count - a.count)
    - Find by road (full view): approaches.filter(a => a.road_name?.toLowerCase().includes('main')).map(a => ({ junction: a.junction_id, road: a.road_name }))`,
      inputSchema: junctionSearchSchema,
    },
    getJunctionSearchHandler()
  );

  // Get junction live data details with sandboxed JS filtering
  server.registerTool(
    "tomtom-junction-live-data",
    {
      description: `Real-time traffic snapshot for one or more junctions. Returns a single live reading per junction covering approach delays, queue lengths, turn ratios, and stops histogram. Use tomtom-junction-search first to discover junction IDs.

    REQUIRES js_queries parameter: an object mapping named keys to JavaScript — e.g. {"delays": "[...approaches].sort((a, b) => b.delay_sec - a.delay_sec)"}.

    **Runtime: sandboxed JavaScript.** Each query is a single expression, or statements ending in \`return\`. Datasets are plain arrays of objects, bound as locals (also on \`data\`). 5s timeout, 10,000-row and 1 MB result caps. No I/O, no imports. \`Object.groupBy(rows, r => key)\` is the idiomatic GROUP BY. \`turf\` (turf.js v7) and \`h3\` (h3-js v4) are injected automatically when your code references them.

    Booleans are 0/1 numbers (is_closed=1 means the approach is closed). FRC scale: 0=Motorway, 1=Major, 2=OtherMajor, 3=Secondary, 4=LocalConnecting, 5=LocalHigh, 6=Local, 7=LocalMinor.

    **Important — includeGeometry side effect:**
    The three *_metadata datasets (junction_metadata, approach_metadata, exit_metadata) are only populated when includeGeometry=true. Without it they are empty arrays, so any lookup against them finds nothing.

    **Available datasets:**
    - approaches: junction_id, approach_id, travel_time_sec, free_flow_travel_time_sec, delay_sec, usual_delay_sec, stops, queue_length_meters, volume_per_hour, is_closed (0/1)
    - turn_ratios: junction_id, approach_id, exit_id, exit_index, ratio_percent, probes_count
    - stops_histogram: junction_id, approach_id, number_of_stops, number_of_vehicles
    - junction_metadata: junction_id, name, country_code (3-letter ISO: ESP/DEU/USA), drive_on_left (0/1), traffic_lights (0/1)
    - approach_metadata: junction_id, approach_id, name, road_name, direction, frc (numeric 0-7), length, one_way_road, excluded, drivable
    - exit_metadata: junction_id, exit_id, name, road_name, direction, frc (numeric 0-7), one_way_road, drivable

    **Example queries:**
    - Most delayed: [...approaches].sort((a, b) => b.delay_sec - a.delay_sec).slice(0, 5).map(a => ({ id: a.approach_id, delay: a.delay_sec, queue: a.queue_length_meters }))
    - Turn ratios: turn_ratios.filter(t => t.approach_id === 1).sort((a, b) => b.ratio_percent - a.ratio_percent)
    - Join to metadata: approaches.map(a => ({ ...a, road: approach_metadata.find(m => m.approach_id === a.approach_id)?.road_name }))

    **MULTI-JUNCTION COMPARISON queries:**
    - Rank by congestion: Object.entries(Object.groupBy(approaches, a => a.junction_id)).map(([id, rows]) => ({ id, avgDelay: +(rows.reduce((s, r) => s + r.delay_sec, 0) / rows.length).toFixed(2) })).sort((a, b) => b.avgDelay - a.avgDelay)
    - Compare queues: Object.entries(Object.groupBy(approaches, a => a.junction_id)).map(([id, rows]) => ({ id, maxQueue: Math.max(...rows.map(r => r.queue_length_meters ?? 0)), approaches: new Set(rows.map(r => r.approach_id)).size }))`,
      inputSchema: junctionLiveDataDetailsSchema,
    },
    getJunctionLiveDataDetailsHandler()
  );

  // Get junction archive with sandboxed JS filtering
  server.registerTool(
    "tomtom-junction-archive",
    {
      description: `Download minute-by-minute historical traffic data for junctions over a specified date range (maximum 2 days). Use tomtom-junction-search first to find junction IDs. Use for peak-hour analysis, before/after comparisons, and intra-day pattern detection.

    REQUIRES js_queries parameter: an object mapping named keys to JavaScript — e.g. {"hourly_avg": "Object.entries(Object.groupBy(approaches, a => new Date(a.time).getUTCHours())).map(([hour, rows]) => ({ hour: +hour, avg: rows.reduce((s, r) => s + r.delay_sec, 0) / rows.length }))"}.

    **Runtime: sandboxed JavaScript.** Each query is a single expression, or statements ending in \`return\`. Datasets are plain arrays of objects, bound as locals (also on \`data\`). 5s timeout, 10,000-row and 1 MB result caps. No I/O, no imports. \`Object.groupBy(rows, r => key)\` is the idiomatic GROUP BY. \`turf\` (turf.js v7) and \`h3\` (h3-js v4) are injected automatically when your code references them.

    Booleans are 0/1 numbers (is_closed=1 means the approach is closed). \`time\` is an ISO 8601 string — use \`new Date(r.time)\` for hour/day bucketing.

    **Available datasets:**
    - approaches: time, junction_id, approach_id, travel_time_sec, free_flow_travel_time_sec, delay_sec, usual_delay_sec, stops, queue_length_meters, volume_per_hour, is_closed (0/1)
    - turn_ratios: time, junction_id, approach_id, exit_id, exit_index, ratio_percent, probes_count

    **Example queries:**
    - Hourly delays: Object.entries(Object.groupBy(approaches, a => new Date(a.time).getUTCHours())).map(([hour, rows]) => ({ hour: +hour, avgDelay: +(rows.reduce((s, r) => s + r.delay_sec, 0) / rows.length).toFixed(2), maxDelay: Math.max(...rows.map(r => r.delay_sec)) })).sort((a, b) => b.avgDelay - a.avgDelay)
    - Percentile (no SQL equivalent needed): const d = approaches.map(a => a.delay_sec).filter(v => v != null).sort((x, y) => x - y); return { p50: d[Math.floor(d.length * 0.5)], p95: d[Math.floor(d.length * 0.95)] };
    - Peak congestion: Object.entries(Object.groupBy(approaches.filter(a => a.delay_sec > 30), a => a.approach_id)).map(([id, rows]) => ({ id, avgDelay: +(rows.reduce((s, r) => s + r.delay_sec, 0) / rows.length).toFixed(2) })).sort((a, b) => b.avgDelay - a.avgDelay).slice(0, 5)

    **MULTI-JUNCTION COMPARISON queries:**
    - Compare junctions: Object.entries(Object.groupBy(approaches, a => a.junction_id)).map(([id, rows]) => ({ id, avgDelay: +(rows.reduce((s, r) => s + r.delay_sec, 0) / rows.length).toFixed(2), avgQueue: +(rows.reduce((s, r) => s + (r.queue_length_meters ?? 0), 0) / rows.length).toFixed(2) })).sort((a, b) => b.avgDelay - a.avgDelay)
    - Hourly pattern per junction: Object.entries(Object.groupBy(approaches, a => a.junction_id + '@' + new Date(a.time).getUTCHours())).map(([key, rows]) => ({ key, avgDelay: +(rows.reduce((s, r) => s + r.delay_sec, 0) / rows.length).toFixed(2) }))`,
      inputSchema: junctionArchiveSchema,
    },
    getJunctionArchiveHandler()
  );
}
