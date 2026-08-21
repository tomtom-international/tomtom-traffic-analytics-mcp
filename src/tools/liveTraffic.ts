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
  trafficFlowDataSchema,
  trafficIncidentsSchema,
} from "../schemas/live-traffic/liveTrafficSchema";
import {
  getFlowSegmentDataHandler,
  createTrafficIncidentsHandler,
} from "../handlers/liveTrafficHandler";

/**
 * Creates and registers Traffic API tools (Flow, Incidents, etc.)
 */
export function createLiveTrafficTools(server: McpServer): void {
  server.registerTool(
    "tomtom-traffic-flow-segment",
    {
      description: `Get real-time traffic flow information for the road segment closest to given coordinates. Returns one segment per call: current and free-flow speed, current and free-flow travel time, confidence, and road-closure flag.

REQUIRES js_queries — e.g. {"segment_info": "flow_segment.map(s => ({ frc: s.frc, speed: s.current_speed }))"}.

**Runtime:** sandboxed JavaScript — see the server instructions for the query contract.

**Available dataset: flow_segment** (exactly one row)
Fields: frc (FRC0-FRC6), current_speed, free_flow_speed, current_travel_time, free_flow_travel_time, confidence (0-1, 1=highest quality), road_closure (0/1), openlr, geom (GeoJSON LineString object — pass straight to turf)

**FRC scale** (Functional Road Class — lower number = more major road):
FRC0=Motorway, FRC1=Major, FRC2=OtherMajor, FRC3=Secondary, FRC4=LocalConnecting, FRC5=LocalHigh, FRC6=Local.

**Example queries:**
- Segment data: flow_segment.map(s => ({ frc: s.frc, speed: s.current_speed, freeFlow: s.free_flow_speed, confidence: s.confidence }))
- Delay: flow_segment.map(s => ({ delaySeconds: s.current_travel_time - s.free_flow_travel_time, confidence: s.confidence }))
- Segment length in metres: turf.length(flow_segment[0].geom, { units: 'meters' })
- Does it cross an area: turf.booleanIntersects(flow_segment[0].geom, turf.circle([4.9, 52.37], 1, { units: 'kilometers' }))`,
      inputSchema: trafficFlowDataSchema,
    },
    getFlowSegmentDataHandler()
  );

  server.registerTool(
    "tomtom-traffic-incidents",
    {
      description: `Query live traffic incidents (accidents, jams, closures, roadworks) within one or more named bounding boxes. Returns each active incident in the requested areas with category, delay, magnitude, geometry, and report metadata.

    REQUIRES js_queries — e.g. {"accidents": "incidents.filter(i => i.iconCategory === 'Accident')"}.

    **Runtime:** sandboxed JavaScript — see the server instructions for the query contract.

    **Available dataset: incidents**
    Fields: area_name (set per bounding box, for cross-area queries), id, iconCategory, magnitudeOfDelay, startTime, endTime, from, to, length, delay, roadNumbers (array of strings), timeValidity, probabilityOfOccurrence, numberOfReports, lastReportTime, events (array of {description, code, iconCategory}), geometry_type, geom (GeoJSON object — pass straight to turf)

    **iconCategory enum (13 values):**
    - Disruptions: Accident, JamLane, LaneClosure, RoadClosure
    - Construction / routing: RoadWorks, Detour
    - Weather: Fog, Rain, Ice, Wind, Flooding
    - Other: Dangerous, Cluster

    **IMPORTANT — delay availability:**
    - Accident, JamLane, LaneClosure carry real-time delay measurements
    - RoadWorks are informational markers with delay = null — they mark construction zones, not live congestion
    - When averaging delays, filter with \`i.delay != null\` to exclude informational incidents

    **Example queries:**
    - Accidents: incidents.filter(i => i.iconCategory === 'Accident').map(i => ({ id: i.id, from: i.from, delay: i.delay }))
    - Event descriptions: incidents.flatMap(i => i.events?.map(e => e.description) ?? [])
    - Compare areas: Object.entries(Object.groupBy(incidents.filter(i => i.delay != null), i => i.area_name)).map(([area, rows]) => ({ area, count: rows.length, avgDelay: +(rows.reduce((s, r) => s + r.delay, 0) / rows.length).toFixed(1) }))
    - Within 2km of a point: incidents.filter(i => turf.distance(turf.centroid(i.geom), [4.9, 52.37], { units: 'kilometers' }) < 2).map(i => i.id)
    - Inside a polygon: incidents.filter(i => turf.booleanIntersects(i.geom, turf.circle([4.9, 52.37], 1, { units: 'kilometers' })))`,
      inputSchema: trafficIncidentsSchema,
    },
    createTrafficIncidentsHandler()
  );
}
