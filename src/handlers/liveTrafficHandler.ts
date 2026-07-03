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

import { logger } from "../utils/logger";
import { storeVizData } from "../services/cache/vizCache";
import {
  getFlowSegmentData,
  getTrafficIncidents,
} from "../services/live-traffic/liveTrafficService";
import { TrafficFlowSegmentRequest } from "../services/live-traffic/types";
import {
  SqlFilterEngine,
  flattenTrafficFlowSegment,
  flattenTrafficIncidents,
  TRAFFIC_FLOW_SEGMENT_SCHEMA,
  TRAFFIC_INCIDENTS_SCHEMA,
  SqlFilteredResponse,
} from "../sql";

/**
 * Handler for getting flow segment data with SQL filtering
 *
 * Requires sql_queries parameter to filter/aggregate the response data.
 * This prevents context window overflow when working with LLM agents.
 */
export function getFlowSegmentDataHandler() {
  return async (params: any) => {
    logger.info("Processing flow segment data request");

    const { sql_queries, show_ui, ...requestParams } = params;
    const request = requestParams as TrafficFlowSegmentRequest;

    // Validate sql_queries is provided (mandatory)
    if (!sql_queries || typeof sql_queries !== "object" || Object.keys(sql_queries).length === 0) {
      const errorMsg =
        "sql_queries parameter is REQUIRED. Provide at least one SQL query to filter/aggregate the flow segment data. " +
        'Example: {"segment_info": "SELECT frc, current_speed, free_flow_speed, confidence FROM flow_segment"}';
      logger.error(`❌ Flow segment data request rejected: ${errorMsg}`);
      return {
        content: [{ type: "text" as const, text: JSON.stringify({ error: errorMsg }) }],
        isError: true,
      };
    }

    const sqlEngine = new SqlFilterEngine();

    try {
      // 1. Fetch raw data from API
      const rawResult = await getFlowSegmentData(request);
      logger.info(`📊 Flow segment data received`);

      // 2. Flatten JSON to relational tables
      const flattenedData = flattenTrafficFlowSegment(rawResult);

      // 3. Initialize SQL engine with schema and data
      const warnings = await sqlEngine.initialize(TRAFFIC_FLOW_SEGMENT_SCHEMA, flattenedData);

      // 4. Execute SQL queries
      const queryResults = await sqlEngine.executeQueries(sql_queries);

      // 5. Get row counts for metadata
      const rowCounts = sqlEngine.getTableRowCounts();

      // 6. Cache the raw segment for the MCP App to render, unless disabled
      let vizMeta: { show_ui: boolean; viz_id?: string };
      if (show_ui !== false) {
        try {
          const vizId = storeVizData({
            tool: "tomtom-traffic-flow-segment",
            request: {
              point: request.point,
              style: request.style,
              zoom: request.zoom,
              unit: request.unit,
            },
            segment: rawResult,
          });
          vizMeta = { show_ui: true, viz_id: vizId };
        } catch (error: any) {
          logger.error(`Failed to cache traffic flow viz payload: ${error.message}`);
          vizMeta = { show_ui: false };
        }
      } else {
        vizMeta = { show_ui: false };
      }

      // 7. Build filtered response
      const response: SqlFilteredResponse = {
        metadata: {
          tool: "tomtom-traffic-flow-segment",
          parameters: {
            point: request.point,
            style: request.style,
            zoom: request.zoom,
          },
          raw_row_counts: rowCounts,
          queries_executed: Object.keys(sql_queries).length,
          warnings: warnings.length > 0 ? warnings : undefined,
        },
        aggregated_data: queryResults,
        _meta: vizMeta,
      };

      logger.info(
        `✅ Flow segment data processed with SQL filtering (${Object.keys(sql_queries).length} queries)`
      );
      return {
        content: [{ type: "text" as const, text: JSON.stringify(response, null, 2) }],
      };
    } catch (error: any) {
      logger.error(`Error getting live traffic data: ${error.message}`);
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({ error: error.message }),
          },
        ],
        isError: true,
      };
    } finally {
      // Always clean up database resources
      sqlEngine.close();
    }
  };
}

/**
 * Helper function to get traffic incidents by location query or bounding box
 */
async function getTrafficByBbox(bbox?: string, options: any = {}) {
  if (bbox) {
    return await getTrafficIncidents(bbox, options);
  }

  throw new Error("Either 'bbox' or 'query' parameter must be provided");
}

/**
 * Handler factory function for traffic incidents with SQL filtering
 *
 * Fetches incidents for one or more named bounding boxes in parallel and merges
 * into a single database for cross-area SQL comparisons.
 *
 * Requires sql_queries parameter to filter/aggregate the response data.
 * This prevents context window overflow when working with LLM agents.
 */
export function createTrafficIncidentsHandler() {
  return async (params: any) => {
    const { sql_queries, bboxes, show_ui, ...requestParams } = params;

    const areas: Array<{ name: string; bbox: string }> = bboxes;

    if (areas.length > 10) {
      const errorMsg = "Maximum 10 bounding boxes per request. Reduce the number of areas.";
      logger.error(`❌ Traffic incidents request rejected: ${errorMsg}`);
      return {
        content: [{ type: "text" as const, text: JSON.stringify({ error: errorMsg }) }],
        isError: true,
      };
    }

    // Validate sql_queries is provided (mandatory)
    if (!sql_queries || typeof sql_queries !== "object" || Object.keys(sql_queries).length === 0) {
      const errorMsg =
        "sql_queries parameter is REQUIRED. Provide at least one SQL query to filter/aggregate the traffic incidents. " +
        'Example: {"accidents": "SELECT id, iconCategory, delay FROM incidents WHERE iconCategory = \'Accident\'"}';
      logger.error(`❌ Traffic incidents request rejected: ${errorMsg}`);
      return {
        content: [{ type: "text" as const, text: JSON.stringify({ error: errorMsg }) }],
        isError: true,
      };
    }

    const sqlEngine = new SqlFilterEngine();

    try {
      const options = {
        language: requestParams.language,
        maxResults: requestParams.maxResults,
        categoryFilter: requestParams.categoryFilter,
        timeValidityFilter: requestParams.timeValidityFilter,
      };

      logger.info(
        `Traffic incidents lookup for ${areas.length} area(s): ${areas.map((a) => a.name).join(", ")}`
      );

      // 1. Fetch all areas in PARALLEL
      const rawResults = await Promise.all(
        areas.map(async (area) => ({
          areaName: area.name,
          bbox: area.bbox,
          data: await getTrafficByBbox(area.bbox, options),
        }))
      );

      // Log raw data stats
      let totalIncidents = 0;
      for (const { data } of rawResults) {
        totalIncidents += data.incidents?.length ?? 0;
      }
      logger.info(
        `📊 Found ${totalIncidents} total traffic incident(s) across ${areas.length} area(s)`
      );

      // 2. Merge flattened results with area names
      const mergedTables = new Map<string, Record<string, unknown>[]>();

      for (const { areaName, data } of rawResults) {
        const flattened = flattenTrafficIncidents(data, areaName);
        for (const [tableName, rows] of flattened.tables) {
          const existing = mergedTables.get(tableName) ?? [];
          mergedTables.set(tableName, [...existing, ...rows]);
        }
      }

      // 3. Initialize SQL engine with schema and merged data
      const warnings = await sqlEngine.initialize(TRAFFIC_INCIDENTS_SCHEMA, {
        tables: mergedTables,
      });

      // 4. Execute SQL queries across combined dataset
      const queryResults = await sqlEngine.executeQueries(sql_queries);

      // 5. Get row counts for metadata
      const rowCounts = sqlEngine.getTableRowCounts();

      // 6. Cache the raw per-area results for the MCP App to render, unless disabled
      let vizMeta: { show_ui: boolean; viz_id?: string };
      if (show_ui !== false) {
        try {
          const vizId = storeVizData({
            tool: "tomtom-traffic-incidents",
            areas: rawResults.map(({ areaName, bbox, data }) => ({
              name: areaName,
              bbox,
              incidents: data,
            })),
          });
          vizMeta = { show_ui: true, viz_id: vizId };
        } catch (error: any) {
          logger.error(`Failed to cache traffic incidents viz payload: ${error.message}`);
          vizMeta = { show_ui: false };
        }
      } else {
        vizMeta = { show_ui: false };
      }

      // 7. Build filtered response
      const response: SqlFilteredResponse = {
        metadata: {
          tool: "tomtom-traffic-incidents",
          parameters: {
            areas: areas.map((a) => a.name),
            areaCount: areas.length,
          },
          raw_row_counts: rowCounts,
          queries_executed: Object.keys(sql_queries).length,
          warnings: warnings.length > 0 ? warnings : undefined,
        },
        aggregated_data: queryResults,
        _meta: vizMeta,
      };

      logger.info(
        `✅ Traffic incidents processed with SQL filtering: ${areas.length} areas (${Object.keys(sql_queries).length} queries)`
      );
      return {
        content: [{ type: "text" as const, text: JSON.stringify(response, null, 2) }],
      };
    } catch (error: any) {
      logger.error(JSON.stringify(error.message, null, 2));
      return {
        content: [{ type: "text" as const, text: JSON.stringify({ error: error.message }) }],
        isError: true,
      };
    } finally {
      // Always clean up database resources
      sqlEngine.close();
    }
  };
}
