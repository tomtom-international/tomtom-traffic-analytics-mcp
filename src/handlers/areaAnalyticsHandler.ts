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
import { getAreaAnalyticsStats } from "../services/area-analytics/areaAnalyticsService";
import { AreaAnalyticsStatsRequest } from "../services/area-analytics/types";
import { JsQueryEngine, flattenAreaAnalyticsResults, JsFilteredResponse } from "../query";

/**
 * Handler for getting Area Analytics stats (lite version) with sandboxed JS filtering
 *
 * Requires js_queries parameter to filter/aggregate the response data.
 * This prevents context window overflow when working with LLM agents.
 */
export function getAreaAnalyticsStatsHandler() {
  return async (params: any) => {
    logger.info("Processing Area Analytics stats request");

    const { js_queries, ...request } = params as AreaAnalyticsStatsRequest & {
      js_queries?: Record<string, string>;
    };

    // Validate js_queries is provided (mandatory)
    if (!js_queries || typeof js_queries !== "object" || Object.keys(js_queries).length === 0) {
      const errorMsg =
        "js_queries parameter is REQUIRED. Provide at least one JavaScript expression to filter/aggregate the stats results. " +
        'Example: {"congestion_trend": "timed_data.filter(r => r.aggregation_type === \'daily\').map(r => ({ time: r.time, congestion: r.congestion_level }))"}';
      logger.error(`❌ Area Analytics stats request rejected: ${errorMsg}`);
      return {
        content: [{ type: "text" as const, text: JSON.stringify({ error: errorMsg }, null, 2) }],
        isError: true,
      };
    }

    const queryEngine = new JsQueryEngine();

    try {
      // 1. Fetch raw data from API
      const rawResult = await getAreaAnalyticsStats(request);
      logger.info(`📊 Area Analytics stats raw data: ${rawResult.features.length} features`);

      // 2. Flatten JSON to relational tables (reuse existing flattener)
      const flattenedData = flattenAreaAnalyticsResults(rawResult);

      // 3. Load the flattened data into the sandbox
      const warnings = await queryEngine.initialize(flattenedData);

      // 4. Execute JS queries
      const queryResults = await queryEngine.executeQueries(js_queries);

      // 5. Describe the loaded datasets for metadata
      const shapes = queryEngine.getDatasetShapes();

      // 6. Build filtered response
      const response: JsFilteredResponse = {
        metadata: {
          tool: "tomtom-area-analytics-stats",
          parameters: {
            name: request.name,
            startDate: request.startDate,
            endDate: request.endDate,
          },
          dataset_shapes: shapes,
          queries_executed: Object.keys(js_queries).length,
          warnings: warnings.length > 0 ? warnings : undefined,
        },
        aggregated_data: queryResults,
      };

      logger.info(
        `✅ Area Analytics stats processed with sandboxed JS filtering (${Object.keys(js_queries).length} queries)`
      );
      return {
        content: [{ type: "text" as const, text: JSON.stringify(response, null, 2) }],
      };
    } catch (error: any) {
      logger.error(`Error getting Area Analytics stats: ${error.message}`);
      return {
        content: [
          { type: "text" as const, text: JSON.stringify({ error: error.message }, null, 2) },
        ],
        isError: true,
      };
    } finally {
      // Always clean up database resources
      queryEngine.close();
    }
  };
}
