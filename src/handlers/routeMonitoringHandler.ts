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
import { buildVizMeta } from "./helpers/vizMeta";
import { getRoutes, getRouteDetails } from "../services/route-monitoring/routeMonitoringService";
import {
  SqlFilterEngine,
  flattenRouteMonitoringDetails,
  ROUTE_MONITORING_SCHEMA,
  flattenRouteList,
  ROUTE_LIST_SCHEMA,
  SqlFilteredResponse,
} from "../sql";

/** Max entries in the auto-injected metadata.route_ids directory. */
const ROUTE_DIRECTORY_CAP = 100;

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
 * Handler for searching routes with SQL filtering
 *
 * Fetches all routes, flattens into SQL tables, and executes
 * user queries for efficient filtering.
 *
 * Requires sql_queries parameter.
 */
function createRouteSearchHandler() {
  return async (params: { sql_queries?: Record<string, string>; show_ui?: boolean }) => {
    const { sql_queries, show_ui } = params;

    logger.info("Route search");

    // Validate sql_queries is provided (mandatory)
    if (!sql_queries || typeof sql_queries !== "object" || Object.keys(sql_queries).length === 0) {
      const errorMsg =
        "sql_queries parameter is REQUIRED. Provide at least one SQL query to filter/aggregate the routes. " +
        'Example: {"delayed_routes": "SELECT route_id, route_name, delay_time FROM routes WHERE delay_time > 60 ORDER BY delay_time DESC"}';
      logger.error(`Route search request rejected: ${errorMsg}`);
      return {
        content: [{ type: "text" as const, text: JSON.stringify({ error: errorMsg }) }],
        isError: true,
      };
    }

    const sqlEngine = new SqlFilterEngine();

    try {
      // 1. Fetch all routes
      const allRoutes = await getRoutes();

      // 2. Flatten into SQL table
      const flattenedData = flattenRouteList(allRoutes);

      // 3. Initialize SQL engine with schema and data
      const warnings = await sqlEngine.initialize(ROUTE_LIST_SCHEMA, flattenedData);

      // 4. Execute SQL queries
      const queryResults = await sqlEngine.executeQueries(sql_queries);

      // 5. Get row counts for metadata
      const rowCounts = sqlEngine.getTableRowCounts();

      // 6. Cache the raw route list for the MCP App to render, unless disabled
      const vizMeta = buildVizMeta(show_ui, "route search", () => ({
        tool: "tomtom-route-search",
        routes: allRoutes,
      }));

      // Deterministic route-id directory so follow-up
      // tomtom-route-monitoring-details calls never need a re-query.
      const routeDirectory = allRoutes
        .slice(0, ROUTE_DIRECTORY_CAP)
        .map((r) => ({ route_id: r.routeId, route_name: r.routeName }));

      // 7. Build filtered response
      const response: SqlFilteredResponse = {
        metadata: {
          tool: "tomtom-route-search",
          parameters: {
            totalRoutes: allRoutes.length,
            ...(allRoutes.length > ROUTE_DIRECTORY_CAP && {
              route_ids_note: `route_ids lists the first ${ROUTE_DIRECTORY_CAP} of ${allRoutes.length} routes; query the routes table for the rest`,
            }),
          },
          route_ids: routeDirectory,
          raw_row_counts: rowCounts,
          queries_executed: Object.keys(sql_queries).length,
          warnings: warnings.length > 0 ? warnings : undefined,
        },
        aggregated_data: queryResults,
        _meta: vizMeta,
      };

      logger.info(
        `Route search completed: ${allRoutes.length} routes (${Object.keys(sql_queries).length} queries)`
      );
      return { content: [{ type: "text" as const, text: JSON.stringify(response) }] };
    } catch (error: any) {
      logger.error(`Route search failed: ${error.message}`);
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
 * Handler for getting detailed route information with SQL filtering
 *
 * Fetches details for one or more routes in parallel and merges into
 * a single database for cross-route SQL comparisons.
 *
 * Requires sql_queries parameter to filter/aggregate the segment data.
 * This prevents context window overflow when working with LLM agents.
 */
function createGetRouteDetailsHandler() {
  return async (params: {
    routeIds: string[];
    sql_queries?: Record<string, string>;
    show_ui?: boolean;
  }) => {
    const { routeIds, sql_queries, show_ui } = params;

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

    // Validate sql_queries is provided (mandatory)
    if (!sql_queries || typeof sql_queries !== "object" || Object.keys(sql_queries).length === 0) {
      const errorMsg =
        "sql_queries parameter is REQUIRED. Provide at least one SQL query to filter/aggregate the route details. " +
        'Example: {"slow_segments": "SELECT segment_id, current_speed, typical_speed FROM segments WHERE current_speed < typical_speed * 0.5 ORDER BY current_speed"}';
      logger.error(`❌ Route details request rejected: ${errorMsg}`);
      return {
        content: [{ type: "text" as const, text: JSON.stringify({ error: errorMsg }) }],
        isError: true,
      };
    }

    const sqlEngine = new SqlFilterEngine();

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
          const existing = mergedTables.get(tableName);
          if (existing) {
            existing.push(...rows);
          } else {
            mergedTables.set(tableName, [...rows]);
          }
        }
      }

      // 3. Initialize SQL engine with schema and merged data
      const warnings = await sqlEngine.initialize(ROUTE_MONITORING_SCHEMA, {
        tables: mergedTables,
      });

      // 4. Execute SQL queries across combined dataset
      const queryResults = await sqlEngine.executeQueries(sql_queries);

      // 5. Get row counts for metadata
      const rowCounts = sqlEngine.getTableRowCounts();

      // 6. Cache the raw route details for the MCP App to render, unless disabled
      const vizMeta = buildVizMeta(show_ui, "route details", () => ({
        tool: "tomtom-route-monitoring-details",
        routes: rawResults,
      }));

      // 7. Build filtered response
      const response: SqlFilteredResponse = {
        metadata: {
          tool: "tomtom-route-monitoring-details",
          parameters: {
            routeIds: ids,
            routeCount: ids.length,
          },
          raw_row_counts: rowCounts,
          queries_executed: Object.keys(sql_queries).length,
          warnings: warnings.length > 0 ? warnings : undefined,
        },
        aggregated_data: queryResults,
        _meta: vizMeta,
      };

      logger.info(
        `✅ Route details processed with SQL filtering: ${ids.length} routes (${Object.keys(sql_queries).length} queries)`
      );
      return { content: [{ type: "text" as const, text: JSON.stringify(response) }] };
    } catch (error: any) {
      logger.error(`❌ Failed to fetch route details: ${error.message}`);
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
