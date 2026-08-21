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
import { getRoutes, getRouteDetails } from "../services/route-monitoring/routeMonitoringService";
import {
  JsQueryEngine,
  MODEL_FACING_RESULT_LIMITS,
  flattenRouteMonitoringDetails,
  flattenRouteList,
  JsFilteredResponse,
} from "../query";

/**
 * Factory function that creates route monitoring handlers
 */
export function createRouteMonitoringHandlers() {
  return {
    searchRoutes: createRouteSearchHandler(),
    getRouteDetails: createGetRouteDetailsHandler(),
  };
}

/**
 * Handler for searching routes with sandboxed JS filtering
 *
 * Fetches all routes, flattens into datasets, and executes
 * user queries for efficient filtering.
 *
 * Requires js_queries parameter.
 */
function createRouteSearchHandler() {
  return async (params: { js_queries?: Record<string, string> }) => {
    const { js_queries } = params;

    logger.info("Route search");

    // Validate js_queries is provided (mandatory)
    if (!js_queries || typeof js_queries !== "object" || Object.keys(js_queries).length === 0) {
      const errorMsg =
        "js_queries parameter is REQUIRED. Provide at least one JavaScript expression to filter/aggregate the routes. " +
        'Example: {"delayed_routes": "routes.filter(r => r.delay_time > 60).sort((a, b) => b.delay_time - a.delay_time)"}';
      logger.error(`Route search request rejected: ${errorMsg}`);
      return {
        content: [{ type: "text" as const, text: JSON.stringify({ error: errorMsg }) }],
        isError: true,
      };
    }

    const queryEngine = new JsQueryEngine();

    try {
      // 1. Fetch all routes
      const allRoutes = await getRoutes();

      // 2. Flatten into a dataset
      const flattenedData = flattenRouteList(allRoutes);

      // 3. Load the flattened data into the sandbox
      const warnings = await queryEngine.initialize(flattenedData);

      // 4. Execute JS queries
      const queryResults = await queryEngine.executeQueries(js_queries, MODEL_FACING_RESULT_LIMITS);

      // 5. Describe the loaded datasets for metadata
      const shapes = queryEngine.getDatasetShapes();

      // 6. Build filtered response
      const response: JsFilteredResponse = {
        metadata: {
          tool: "tomtom-route-search",
          parameters: {
            totalRoutes: allRoutes.length,
          },
          dataset_shapes: shapes,
          queries_executed: Object.keys(js_queries).length,
          warnings: warnings.length > 0 ? warnings : undefined,
        },
        aggregated_data: queryResults,
      };

      logger.info(
        `Route search completed: ${allRoutes.length} routes (${Object.keys(js_queries).length} queries)`
      );
      return { content: [{ type: "text" as const, text: JSON.stringify(response, null, 2) }] };
    } catch (error: any) {
      logger.error(`Route search failed: ${error.message}`);
      return {
        content: [{ type: "text" as const, text: JSON.stringify({ error: error.message }) }],
        isError: true,
      };
    } finally {
      queryEngine.close();
    }
  };
}

/**
 * Handler for getting detailed route information with sandboxed JS filtering
 *
 * Fetches details for one or more routes in parallel and merges into
 * a single database for cross-route comparisons.
 *
 * Requires js_queries parameter to filter/aggregate the segment data.
 * This prevents context window overflow when working with LLM agents.
 */
function createGetRouteDetailsHandler() {
  return async (params: { routeIds: string[]; js_queries?: Record<string, string> }) => {
    const { routeIds, js_queries } = params;

    const ids: string[] = routeIds;

    if (ids.length > 20) {
      const errorMsg = "Maximum 20 routes per request. Reduce the number of route IDs.";
      logger.error(`❌ Route details request rejected: ${errorMsg}`);
      return {
        content: [{ type: "text" as const, text: JSON.stringify({ error: errorMsg }) }],
        isError: true,
      };
    }

    logger.info(
      `Fetching detailed route information for ${ids.length} route(s): ${ids.join(", ")}`
    );

    // Validate js_queries is provided (mandatory)
    if (!js_queries || typeof js_queries !== "object" || Object.keys(js_queries).length === 0) {
      const errorMsg =
        "js_queries parameter is REQUIRED. Provide at least one JavaScript expression to filter/aggregate the route details. " +
        'Example: {"slow_segments": "segments.filter(s => s.current_speed < s.typical_speed * 0.5).sort((a, b) => a.current_speed - b.current_speed)"}';
      logger.error(`❌ Route details request rejected: ${errorMsg}`);
      return {
        content: [{ type: "text" as const, text: JSON.stringify({ error: errorMsg }) }],
        isError: true,
      };
    }

    const queryEngine = new JsQueryEngine();

    try {
      // 1. Fetch all routes in PARALLEL
      const rawResults = await Promise.all(ids.map((id) => getRouteDetails(id)));

      // Log raw data stats
      let totalSegments = 0;
      for (const result of rawResults) {
        totalSegments += result.detailedSegments?.length ?? 0;
      }
      logger.info(`📊 Route details raw: ${ids.length} routes, ${totalSegments} total segments`);

      // 2. Merge flattened results from all routes
      const mergedTables = new Map<string, Record<string, unknown>[]>();

      for (const rawResult of rawResults) {
        const flattened = flattenRouteMonitoringDetails(rawResult);
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
          tool: "tomtom-route-monitoring-details",
          parameters: {
            routeIds: ids,
            routeCount: ids.length,
          },
          dataset_shapes: shapes,
          queries_executed: Object.keys(js_queries).length,
          warnings: warnings.length > 0 ? warnings : undefined,
        },
        aggregated_data: queryResults,
      };

      logger.info(
        `✅ Route details processed with sandboxed JS filtering: ${ids.length} routes (${Object.keys(js_queries).length} queries)`
      );
      return { content: [{ type: "text" as const, text: JSON.stringify(response, null, 2) }] };
    } catch (error: any) {
      logger.error(`❌ Failed to fetch route details: ${error.message}`);
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
