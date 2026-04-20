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
  getJunctionLiveData,
  getJunctionArchive,
  getAllJunctionDefinitions,
} from "../services/junction-analytics/junctionAnalyticsService";
import {
  SqlFilterEngine,
  flattenJunctionArchive,
  JUNCTION_ARCHIVE_SCHEMA,
  flattenJunctionLiveData,
  JUNCTION_LIVE_DATA_SCHEMA,
  flattenJunctionDefinitions,
  JUNCTION_DEFINITION_COMPACT_SCHEMA,
  JUNCTION_DEFINITION_FULL_SCHEMA,
  SqlFilteredResponse,
} from "../sql";

/**
 * Junction search handler with SQL filtering
 *
 * Fetches ALL junction definitions (auto-paginating), flattens into
 * SQL tables, and executes user queries for efficient filtering.
 *
 * Requires sql_queries parameter.
 */
export function getJunctionSearchHandler() {
  return async (params: any) => {
    const { view = "compact", sql_queries } = params;

    logger.info(`Junction search (view: ${view})`);

    // Validate sql_queries is provided (mandatory)
    if (!sql_queries || typeof sql_queries !== "object" || Object.keys(sql_queries).length === 0) {
      const errorMsg =
        "sql_queries parameter is REQUIRED. Provide at least one SQL query to filter/aggregate the junction definitions. " +
        'Example: {"active_junctions": "SELECT junction_id, name, status FROM junctions WHERE status = \'ACTIVE\'"}';
      logger.error(`Junction search request rejected: ${errorMsg}`);
      return {
        content: [{ type: "text" as const, text: JSON.stringify({ error: errorMsg }) }],
        isError: true,
      };
    }

    const sqlEngine = new SqlFilterEngine();

    try {
      // 1. Fetch ALL junctions (auto-paginating)
      const allJunctions = await getAllJunctionDefinitions();

      // 2. Flatten into SQL tables based on view
      const flattenedData = flattenJunctionDefinitions(allJunctions, view);

      // 3. Select schema based on view
      const schema =
        view === "full" ? JUNCTION_DEFINITION_FULL_SCHEMA : JUNCTION_DEFINITION_COMPACT_SCHEMA;

      // 4. Initialize SQL engine with schema and data
      const warnings = await sqlEngine.initialize(schema, flattenedData);

      // 5. Execute SQL queries
      const queryResults = await sqlEngine.executeQueries(sql_queries);

      // 6. Get row counts for metadata
      const rowCounts = sqlEngine.getTableRowCounts();

      // 7. Build filtered response
      const response: SqlFilteredResponse = {
        metadata: {
          tool: "tomtom-junction-search",
          parameters: {
            view,
            totalJunctions: allJunctions.length,
          },
          raw_row_counts: rowCounts,
          queries_executed: Object.keys(sql_queries).length,
          warnings: warnings.length > 0 ? warnings : undefined,
        },
        aggregated_data: queryResults,
      };

      logger.info(
        `Junction search completed: ${allJunctions.length} junctions (${Object.keys(sql_queries).length} queries, view: ${view})`
      );
      return { content: [{ type: "text" as const, text: JSON.stringify(response, null, 2) }] };
    } catch (error: any) {
      logger.error(`Junction search failed: ${error.message}`);
      return {
        content: [{ type: "text" as const, text: JSON.stringify({ error: error.message }) }],
        isError: true,
      };
    } finally {
      sqlEngine.close();
    }
  };
}

/**
 * Get junction live data details handler with SQL filtering
 *
 * Fetches live data for one or more junctions in parallel and merges into
 * a single database for cross-junction SQL comparisons.
 *
 * Requires sql_queries parameter to filter/aggregate the live data.
 * This prevents context window overflow when working with LLM agents.
 */
export function getJunctionLiveDataDetailsHandler() {
  return async (params: any) => {
    const { junctionIds, sql_queries, ...options } = params;

    const ids: string[] = junctionIds;

    if (ids.length > 20) {
      const errorMsg = "Maximum 20 junctions per request. Reduce the number of junction IDs.";
      logger.error(`❌ Junction live data request rejected: ${errorMsg}`);
      return {
        content: [{ type: "text" as const, text: JSON.stringify({ error: errorMsg }) }],
        isError: true,
      };
    }

    logger.info(`📊 Fetching junction live data for ${ids.length} junction(s): ${ids.join(", ")}`);

    // Validate sql_queries is provided (mandatory)
    if (!sql_queries || typeof sql_queries !== "object" || Object.keys(sql_queries).length === 0) {
      const errorMsg =
        "sql_queries parameter is REQUIRED. Provide at least one SQL query to filter/aggregate the live data. " +
        'Example: {"delayed_approaches": "SELECT approach_id, delay_sec, queue_length_meters FROM approaches ORDER BY delay_sec DESC LIMIT 5"}';
      logger.error(`❌ Junction live data request rejected: ${errorMsg}`);
      return {
        content: [{ type: "text" as const, text: JSON.stringify({ error: errorMsg }) }],
        isError: true,
      };
    }

    const sqlEngine = new SqlFilterEngine();

    try {
      // 1. Fetch all junctions in PARALLEL
      const rawResults = await Promise.all(ids.map((id) => getJunctionLiveData(id, options)));

      // Log raw data stats
      let totalApproaches = 0;
      for (const result of rawResults) {
        totalApproaches += result.approachesLiveData?.length ?? 0;
      }
      logger.info(
        `📊 Junction live data raw: ${ids.length} junctions, ${totalApproaches} total approaches`
      );

      // 2. Merge flattened results from all junctions
      const mergedTables = new Map<string, Record<string, unknown>[]>();

      for (const rawResult of rawResults) {
        const flattened = flattenJunctionLiveData(rawResult);
        for (const [tableName, rows] of flattened.tables) {
          const existing = mergedTables.get(tableName) ?? [];
          mergedTables.set(tableName, [...existing, ...rows]);
        }
      }

      // 3. Initialize SQL engine with schema and merged data
      const warnings = await sqlEngine.initialize(JUNCTION_LIVE_DATA_SCHEMA, {
        tables: mergedTables,
      });

      // 4. Execute SQL queries across combined dataset
      const queryResults = await sqlEngine.executeQueries(sql_queries);

      // 5. Get row counts for metadata
      const rowCounts = sqlEngine.getTableRowCounts();

      // 6. Build filtered response
      const response: SqlFilteredResponse = {
        metadata: {
          tool: "tomtom-junction-live-data",
          parameters: {
            junctionIds: ids,
            junctionCount: ids.length,
            includeGeometry: options.includeGeometry,
          },
          raw_row_counts: rowCounts,
          queries_executed: Object.keys(sql_queries).length,
          warnings: warnings.length > 0 ? warnings : undefined,
        },
        aggregated_data: queryResults,
      };

      logger.info(
        `✅ Junction live data processed with SQL filtering: ${ids.length} junctions (${Object.keys(sql_queries).length} queries)`
      );
      return { content: [{ type: "text" as const, text: JSON.stringify(response, null, 2) }] };
    } catch (error: any) {
      logger.error(`❌ Failed to retrieve junction live data: ${error.message}`);
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

/**
 * Get junction archive handler with SQL filtering
 *
 * Fetches archive data for one or more junctions in parallel and merges into
 * a single database for cross-junction SQL comparisons.
 *
 * Requires sql_queries parameter to filter/aggregate the large response data.
 * This prevents context window overflow when working with LLM agents.
 */
export function getJunctionArchiveHandler() {
  return async (params: any) => {
    const { junctionIds, sql_queries, ...options } = params;

    const ids: string[] = junctionIds;

    if (ids.length > 20) {
      const errorMsg = "Maximum 20 junctions per request. Reduce the number of junction IDs.";
      logger.error(`❌ Junction archive request rejected: ${errorMsg}`);
      return {
        content: [{ type: "text" as const, text: JSON.stringify({ error: errorMsg }) }],
        isError: true,
      };
    }

    logger.info(
      `📦 Fetching junction archive for ${ids.length} junction(s): ${ids.join(", ")} (${options.from} to ${options.to || "latest"})`
    );

    // Validate sql_queries is provided (mandatory)
    if (!sql_queries || typeof sql_queries !== "object" || Object.keys(sql_queries).length === 0) {
      const errorMsg =
        "sql_queries parameter is REQUIRED. Provide at least one SQL query to filter/aggregate the archive data. " +
        'Example: {"avg_delay": "SELECT approach_id, AVG(delay_sec) as avg_delay FROM approaches GROUP BY approach_id"}';
      logger.error(`❌ Junction archive request rejected: ${errorMsg}`);
      return {
        content: [{ type: "text" as const, text: JSON.stringify({ error: errorMsg }) }],
        isError: true,
      };
    }

    const sqlEngine = new SqlFilterEngine();

    try {
      // 1. Fetch all junctions in PARALLEL
      const rawResults = await Promise.all(ids.map((id) => getJunctionArchive(id, options)));

      // Log raw data stats
      let totalApproaches = 0;
      let totalTurnRatios = 0;
      for (const result of rawResults) {
        totalApproaches += result.approaches.length;
        totalTurnRatios += result.turnRatios.length;
      }
      logger.info(
        `📊 Junction archive raw: ${ids.length} junctions, ${totalApproaches} approach records, ${totalTurnRatios} turn ratio records`
      );

      // 2. Merge flattened results from all junctions
      const mergedTables = new Map<string, Record<string, unknown>[]>();

      for (const rawResult of rawResults) {
        const flattened = flattenJunctionArchive(rawResult);
        for (const [tableName, rows] of flattened.tables) {
          const existing = mergedTables.get(tableName) ?? [];
          mergedTables.set(tableName, [...existing, ...rows]);
        }
      }

      // 3. Initialize SQL engine with schema and merged data
      const warnings = await sqlEngine.initialize(JUNCTION_ARCHIVE_SCHEMA, {
        tables: mergedTables,
      });

      // 4. Execute SQL queries across combined dataset
      const queryResults = await sqlEngine.executeQueries(sql_queries);

      // 5. Get row counts for metadata
      const rowCounts = sqlEngine.getTableRowCounts();

      // 6. Build filtered response
      const response: SqlFilteredResponse = {
        metadata: {
          tool: "tomtom-junction-archive",
          parameters: {
            junctionIds: ids,
            junctionCount: ids.length,
            from: options.from,
            to: options.to,
          },
          raw_row_counts: rowCounts,
          queries_executed: Object.keys(sql_queries).length,
          warnings: warnings.length > 0 ? warnings : undefined,
        },
        aggregated_data: queryResults,
      };

      logger.info(
        `✅ Junction archive processed with SQL filtering: ${ids.length} junctions (${Object.keys(sql_queries).length} queries)`
      );
      return { content: [{ type: "text" as const, text: JSON.stringify(response, null, 2) }] };
    } catch (error: any) {
      logger.error(`❌ Failed to retrieve junction archive: ${error.message}`);
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
