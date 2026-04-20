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
import {
  SqlFilterEngine,
  flattenAreaAnalyticsResults,
  AREA_ANALYTICS_SCHEMA,
  SqlFilteredResponse,
} from "../sql";

/**
 * Handler for getting Area Analytics stats (lite version) with SQL filtering
 *
 * Requires sql_queries parameter to filter/aggregate the response data.
 * This prevents context window overflow when working with LLM agents.
 */
export function getAreaAnalyticsStatsHandler() {
  return async (params: any) => {
    logger.info("Processing Area Analytics stats request");

    const { sql_queries, ...request } = params as AreaAnalyticsStatsRequest & {
      sql_queries?: Record<string, string>;
    };

    // Validate sql_queries is provided (mandatory)
    if (!sql_queries || typeof sql_queries !== "object" || Object.keys(sql_queries).length === 0) {
      const errorMsg =
        "sql_queries parameter is REQUIRED. Provide at least one SQL query to filter/aggregate the stats results. " +
        'Example: {"congestion_trend": "SELECT time, AVG(congestion_level) as avg_congestion FROM timed_data WHERE aggregation_type = \'daily\' GROUP BY time"}';
      logger.error(`❌ Area Analytics stats request rejected: ${errorMsg}`);
      return {
        content: [{ type: "text" as const, text: JSON.stringify({ error: errorMsg }, null, 2) }],
        isError: true,
      };
    }

    const sqlEngine = new SqlFilterEngine();

    try {
      // 1. Fetch raw data from API
      const rawResult = await getAreaAnalyticsStats(request);
      logger.info(`📊 Area Analytics stats raw data: ${rawResult.features.length} features`);

      // 2. Flatten JSON to relational tables (reuse existing flattener)
      const flattenedData = flattenAreaAnalyticsResults(rawResult);

      // 3. Initialize SQL engine with schema and data
      const warnings = await sqlEngine.initialize(AREA_ANALYTICS_SCHEMA, flattenedData);

      // 4. Execute SQL queries
      const queryResults = await sqlEngine.executeQueries(sql_queries);

      // 5. Get row counts for metadata
      const rowCounts = sqlEngine.getTableRowCounts();

      // 6. Build filtered response
      const response: SqlFilteredResponse = {
        metadata: {
          tool: "tomtom-area-analytics-stats",
          parameters: {
            name: request.name,
            startDate: request.startDate,
            endDate: request.endDate,
          },
          raw_row_counts: rowCounts,
          queries_executed: Object.keys(sql_queries).length,
          warnings: warnings.length > 0 ? warnings : undefined,
        },
        aggregated_data: queryResults,
      };

      logger.info(
        `✅ Area Analytics stats processed with SQL filtering (${Object.keys(sql_queries).length} queries)`
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
      sqlEngine.close();
    }
  };
}
