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
import {
  getFlowSegmentData,
  getTrafficIncidents,
} from "../services/live-traffic/liveTrafficService";
import { TrafficFlowSegmentRequest } from "../services/live-traffic/types";
import {
  JsQueryEngine,
  MODEL_FACING_RESULT_LIMITS,
  flattenTrafficFlowSegment,
  flattenTrafficIncidents,
  JsFilteredResponse,
} from "../query";

/**
 * Handler for getting flow segment data with sandboxed JS filtering
 *
 * Requires js_queries parameter to filter/aggregate the response data.
 * This prevents context window overflow when working with LLM agents.
 */
export function getFlowSegmentDataHandler() {
  return async (params: any) => {
    logger.info("Processing flow segment data request");

    const { js_queries, ...requestParams } = params;
    const request = requestParams as TrafficFlowSegmentRequest;

    // Validate js_queries is provided (mandatory)
    if (!js_queries || typeof js_queries !== "object" || Object.keys(js_queries).length === 0) {
      const errorMsg =
        "js_queries parameter is REQUIRED. Provide at least one JavaScript expression to filter/aggregate the flow segment data. " +
        'Example: {"segment_info": "flow_segment.map(s => ({ frc: s.frc, speed: s.current_speed, freeFlow: s.free_flow_speed }))"}';
      logger.error(`❌ Flow segment data request rejected: ${errorMsg}`);
      return {
        content: [{ type: "text" as const, text: JSON.stringify({ error: errorMsg }) }],
        isError: true,
      };
    }

    const queryEngine = new JsQueryEngine();

    try {
      // 1. Fetch raw data from API
      const rawResult = await getFlowSegmentData(request);
      logger.info(`📊 Flow segment data received`);

      // 2. Flatten JSON to relational tables
      const flattenedData = flattenTrafficFlowSegment(rawResult);

      // 3. Load the flattened data into the sandbox
      const warnings = await queryEngine.initialize(flattenedData);

      // 4. Execute JS queries
      const queryResults = await queryEngine.executeQueries(js_queries, MODEL_FACING_RESULT_LIMITS);

      // 5. Describe the loaded datasets for metadata
      const shapes = queryEngine.getDatasetShapes();

      // 6. Build filtered response
      const response: JsFilteredResponse = {
        metadata: {
          tool: "tomtom-traffic-flow-segment",
          parameters: {
            point: request.point,
            style: request.style,
            zoom: request.zoom,
          },
          dataset_shapes: shapes,
          queries_executed: Object.keys(js_queries).length,
          warnings: warnings.length > 0 ? warnings : undefined,
        },
        aggregated_data: queryResults,
      };

      logger.info(
        `✅ Flow segment data processed with sandboxed JS filtering (${Object.keys(js_queries).length} queries)`
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
      queryEngine.close();
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
 * Handler factory function for traffic incidents with sandboxed JS filtering
 *
 * Fetches incidents for one or more named bounding boxes in parallel and merges
 * into a single database for cross-area comparisons.
 *
 * Requires js_queries parameter to filter/aggregate the response data.
 * This prevents context window overflow when working with LLM agents.
 */
export function createTrafficIncidentsHandler() {
  return async (params: any) => {
    const { js_queries, bboxes, ...requestParams } = params;

    const areas: Array<{ name: string; bbox: string }> = bboxes;

    if (areas.length > 10) {
      const errorMsg = "Maximum 10 bounding boxes per request. Reduce the number of areas.";
      logger.error(`❌ Traffic incidents request rejected: ${errorMsg}`);
      return {
        content: [{ type: "text" as const, text: JSON.stringify({ error: errorMsg }) }],
        isError: true,
      };
    }

    // Validate js_queries is provided (mandatory)
    if (!js_queries || typeof js_queries !== "object" || Object.keys(js_queries).length === 0) {
      const errorMsg =
        "js_queries parameter is REQUIRED. Provide at least one JavaScript expression to filter/aggregate the traffic incidents. " +
        'Example: {"accidents": "incidents.filter(i => i.iconCategory === \'Accident\').map(i => ({ id: i.id, delay: i.delay }))"}';
      logger.error(`❌ Traffic incidents request rejected: ${errorMsg}`);
      return {
        content: [{ type: "text" as const, text: JSON.stringify({ error: errorMsg }) }],
        isError: true,
      };
    }

    const queryEngine = new JsQueryEngine();

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

      // 3. Load the merged data into the sandbox
      const warnings = await queryEngine.initialize({
        tables: mergedTables,
      });

      // 4. Execute JS queries across combined dataset
      const queryResults = await queryEngine.executeQueries(js_queries, MODEL_FACING_RESULT_LIMITS);

      // 5. Describe the loaded datasets for metadata
      const shapes = queryEngine.getDatasetShapes();

      // 6. Build filtered response
      const response: JsFilteredResponse = {
        metadata: {
          tool: "tomtom-traffic-incidents",
          parameters: {
            areas: areas.map((a) => a.name),
            areaCount: areas.length,
          },
          dataset_shapes: shapes,
          queries_executed: Object.keys(js_queries).length,
          warnings: warnings.length > 0 ? warnings : undefined,
        },
        aggregated_data: queryResults,
      };

      logger.info(
        `✅ Traffic incidents processed with sandboxed JS filtering: ${areas.length} areas (${Object.keys(js_queries).length} queries)`
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
      queryEngine.close();
    }
  };
}
