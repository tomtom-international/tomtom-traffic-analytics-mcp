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
  JsQueryEngine,
  flattenJunctionArchive,
  flattenJunctionLiveData,
  flattenJunctionDefinitions,
  JsFilteredResponse,
} from "../query";

/**
 * Junction search handler with sandboxed JS filtering
 *
 * Fetches ALL junction definitions (auto-paginating), flattens into
 * datasets, and executes user queries for efficient filtering.
 *
 * Requires js_queries parameter.
 */
export function getJunctionSearchHandler() {
  return async (params: any) => {
    const { view = "compact", js_queries } = params;

    logger.info(`Junction search (view: ${view})`);

    // Validate js_queries is provided (mandatory)
    if (!js_queries || typeof js_queries !== "object" || Object.keys(js_queries).length === 0) {
      const errorMsg =
        "js_queries parameter is REQUIRED. Provide at least one JavaScript expression to filter/aggregate the junction definitions. " +
        'Example: {"active_junctions": "junctions.filter(j => j.status === \'ACTIVE\').map(j => ({ id: j.junction_id, name: j.name }))"}';
      logger.error(`Junction search request rejected: ${errorMsg}`);
      return {
        content: [{ type: "text" as const, text: JSON.stringify({ error: errorMsg }) }],
        isError: true,
      };
    }

    const queryEngine = new JsQueryEngine();

    try {
      // 1. Fetch ALL junctions (auto-paginating). `includeGeometry: true` is
      //    required for the Move Portal list endpoint to return each
      //    junction's `junctionModel` field — without it, countryCode,
      //    trafficLights, approaches and exits are all undefined and the
      //    flattener falls back to null/0 for every junction.
      const allJunctions = await getAllJunctionDefinitions({ includeGeometry: true });

      // 2. Flatten into datasets based on view
      const flattenedData = flattenJunctionDefinitions(allJunctions, view);

      // 3. Load the flattened data into the sandbox
      const warnings = await queryEngine.initialize(flattenedData);

      // 4. Execute JS queries
      const queryResults = await queryEngine.executeQueries(js_queries);

      // 5. Describe the loaded datasets for metadata
      const shapes = queryEngine.getDatasetShapes();

      // 6. Build filtered response
      const response: JsFilteredResponse = {
        metadata: {
          tool: "tomtom-junction-search",
          parameters: {
            view,
            totalJunctions: allJunctions.length,
          },
          dataset_shapes: shapes,
          queries_executed: Object.keys(js_queries).length,
          warnings: warnings.length > 0 ? warnings : undefined,
        },
        aggregated_data: queryResults,
      };

      logger.info(
        `Junction search completed: ${allJunctions.length} junctions (${Object.keys(js_queries).length} queries, view: ${view})`
      );
      return { content: [{ type: "text" as const, text: JSON.stringify(response, null, 2) }] };
    } catch (error: any) {
      logger.error(`Junction search failed: ${error.message}`);
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
 * Get junction live data details handler with sandboxed JS filtering
 *
 * Fetches live data for one or more junctions in parallel and merges into
 * a single database for cross-junction comparisons.
 *
 * Requires js_queries parameter to filter/aggregate the live data.
 * This prevents context window overflow when working with LLM agents.
 */
export function getJunctionLiveDataDetailsHandler() {
  return async (params: any) => {
    const { junctionIds, js_queries, ...options } = params;

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

    // Validate js_queries is provided (mandatory)
    if (!js_queries || typeof js_queries !== "object" || Object.keys(js_queries).length === 0) {
      const errorMsg =
        "js_queries parameter is REQUIRED. Provide at least one JavaScript expression to filter/aggregate the live data. " +
        'Example: {"delayed_approaches": "[...approaches].sort((a, b) => b.delay_sec - a.delay_sec).slice(0, 5)"}';
      logger.error(`❌ Junction live data request rejected: ${errorMsg}`);
      return {
        content: [{ type: "text" as const, text: JSON.stringify({ error: errorMsg }) }],
        isError: true,
      };
    }

    const queryEngine = new JsQueryEngine();

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

      // 3. Load the merged data into the sandbox
      const warnings = await queryEngine.initialize({
        tables: mergedTables,
      });

      // 4. Execute JS queries across combined dataset
      const queryResults = await queryEngine.executeQueries(js_queries);

      // 5. Describe the loaded datasets for metadata
      const shapes = queryEngine.getDatasetShapes();

      // 6. Build filtered response
      const response: JsFilteredResponse = {
        metadata: {
          tool: "tomtom-junction-live-data",
          parameters: {
            junctionIds: ids,
            junctionCount: ids.length,
            includeGeometry: options.includeGeometry,
          },
          dataset_shapes: shapes,
          queries_executed: Object.keys(js_queries).length,
          warnings: warnings.length > 0 ? warnings : undefined,
        },
        aggregated_data: queryResults,
      };

      logger.info(
        `✅ Junction live data processed with sandboxed JS filtering: ${ids.length} junctions (${Object.keys(js_queries).length} queries)`
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
      queryEngine.close();
    }
  };
}

/**
 * Get junction archive handler with sandboxed JS filtering
 *
 * Fetches archive data for one or more junctions in parallel and merges into
 * a single database for cross-junction comparisons.
 *
 * Requires js_queries parameter to filter/aggregate the large response data.
 * This prevents context window overflow when working with LLM agents.
 */
export function getJunctionArchiveHandler() {
  return async (params: any) => {
    const { junctionIds, js_queries, ...options } = params;

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

    // Validate js_queries is provided (mandatory)
    if (!js_queries || typeof js_queries !== "object" || Object.keys(js_queries).length === 0) {
      const errorMsg =
        "js_queries parameter is REQUIRED. Provide at least one JavaScript expression to filter/aggregate the archive data. " +
        'Example: {"avg_delay": "Object.entries(Object.groupBy(approaches, a => a.approach_id)).map(([id, rows]) => ({ id, avg: rows.reduce((s, r) => s + r.delay_sec, 0) / rows.length }))"}';
      logger.error(`❌ Junction archive request rejected: ${errorMsg}`);
      return {
        content: [{ type: "text" as const, text: JSON.stringify({ error: errorMsg }) }],
        isError: true,
      };
    }

    const queryEngine = new JsQueryEngine();

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

      // 3. Load the merged data into the sandbox
      const warnings = await queryEngine.initialize({
        tables: mergedTables,
      });

      // 4. Execute JS queries across combined dataset
      const queryResults = await queryEngine.executeQueries(js_queries);

      // 5. Describe the loaded datasets for metadata
      const shapes = queryEngine.getDatasetShapes();

      // 6. Build filtered response
      const response: JsFilteredResponse = {
        metadata: {
          tool: "tomtom-junction-archive",
          parameters: {
            junctionIds: ids,
            junctionCount: ids.length,
            from: options.from,
            to: options.to,
          },
          dataset_shapes: shapes,
          queries_executed: Object.keys(js_queries).length,
          warnings: warnings.length > 0 ? warnings : undefined,
        },
        aggregated_data: queryResults,
      };

      logger.info(
        `✅ Junction archive processed with sandboxed JS filtering: ${ids.length} junctions (${Object.keys(js_queries).length} queries)`
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
      queryEngine.close();
    }
  };
}
