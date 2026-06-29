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

import { DuckDBInstance, DuckDBConnection } from "@duckdb/node-api";
import { logger } from "../utils/logger";
import {
  TableDefinition,
  FlattenResult,
  SqlQueryResult,
  SqlQueryExecutionResult,
  SqlFilterEngineOptions,
  ResourceLimits,
  SQL_FILTER_DEFAULTS,
  SqlColumnType,
} from "./types";

/**
 * Map SQL column types from schema to DuckDB types
 */
function mapColumnType(type: SqlColumnType): string {
  switch (type) {
    case "TEXT":
      return "VARCHAR";
    case "REAL":
      return "DOUBLE";
    case "INTEGER":
      return "INTEGER";
    case "BIGINT":
      return "BIGINT"; // For large 64-bit IDs from TomTom API
    case "GEOMETRY":
      return "GEOMETRY";
    default:
      return "VARCHAR";
  }
}

/**
 * SQL Filter Engine - In-memory SQL execution for MCP response filtering
 *
 * Uses DuckDB for high-performance SQL queries on flattened
 * JSON data from TomTom API responses.
 *
 * Key improvements over sql.js:
 * - 10-50x faster query execution
 * - Native geospatial support (ST_* functions)
 * - PostgreSQL-compatible SQL dialect
 * - Better JSON handling
 */
export class SqlFilterEngine {
  private instance: DuckDBInstance | null = null;
  private connection: DuckDBConnection | null = null;
  private options: {
    queryTimeoutMs: number;
    maxRows: number;
    maxResultRows: number;
    resourceLimits: Required<ResourceLimits>;
  };
  private tableSizes: Map<string, number> = new Map();
  private spatialExtensionLoaded = false;

  constructor(options: SqlFilterEngineOptions = {}) {
    this.options = {
      queryTimeoutMs: options.queryTimeoutMs ?? SQL_FILTER_DEFAULTS.QUERY_TIMEOUT_MS,
      maxRows: options.maxRows ?? SQL_FILTER_DEFAULTS.MAX_ROWS_SOFT_LIMIT,
      maxResultRows: options.maxResultRows ?? SQL_FILTER_DEFAULTS.MAX_RESULT_ROWS,
      resourceLimits: {
        memoryLimit: options.resourceLimits?.memoryLimit ?? SQL_FILTER_DEFAULTS.MEMORY_LIMIT,
        threads: options.resourceLimits?.threads ?? SQL_FILTER_DEFAULTS.THREADS,
        maxTempDirectorySize:
          options.resourceLimits?.maxTempDirectorySize ??
          SQL_FILTER_DEFAULTS.MAX_TEMP_DIRECTORY_SIZE,
      },
    };
  }

  /**
   * Initialize the database with table schemas and data
   */
  async initialize(schemas: TableDefinition[], data: FlattenResult): Promise<string[]> {
    const warnings: string[] = [];
    const startTime = Date.now();

    // Create in-memory DuckDB instance with resource limits and security config
    try {
      const { resourceLimits } = this.options;
      this.instance = await DuckDBInstance.create(":memory:", {
        threads: String(resourceLimits.threads),
        memory_limit: resourceLimits.memoryLimit,
        max_temp_directory_size: resourceLimits.maxTempDirectorySize,
        allow_community_extensions: "false",
      });
      try {
        this.connection = await this.instance.connect();
      } catch (connectError) {
        // Clean up instance if connection fails to avoid memory leaks
        this.instance = null;
        throw connectError;
      }
    } catch (error) {
      this.close();
      throw new Error(
        `Failed to initialize DuckDB: ${error instanceof Error ? error.message : String(error)}`
      );
    }

    logger.debug(`DuckDB instance created in ${Date.now() - startTime}ms`);

    // Always load spatial extension before lockdown (must happen while external access is enabled)
    await this.ensureSpatialExtension();

    // Lock down DuckDB configuration to prevent extension loading, filesystem/network access
    await this.lockdownConfiguration();

    // Create tables
    for (const schema of schemas) {
      const createSql = this.buildCreateTableSql(schema);
      await this.connection.run(createSql);
      logger.debug(`Created table: ${schema.name}`);
    }

    // Insert data and check for soft limits
    let totalRows = 0;
    for (const [tableName, rows] of data.tables) {
      if (rows.length > 0) {
        await this.insertRows(tableName, rows);
        this.tableSizes.set(tableName, rows.length);
        totalRows += rows.length;
        logger.debug(`Inserted ${rows.length} rows into ${tableName}`);

        // Populate geometry columns if they exist
        const schema = schemas.find((s) => s.name === tableName);
        if (schema) {
          await this.populateGeometryColumns(tableName, schema);
        }
      }
    }

    // Check soft limit and add warning
    if (totalRows > this.options.maxRows) {
      const warning = `Large dataset warning: ${totalRows} total rows exceeds soft limit of ${this.options.maxRows}. Query performance may be affected.`;
      warnings.push(warning);
      logger.warn(warning);
    }

    return warnings;
  }

  /**
   * Build CREATE TABLE SQL statement from schema definition
   */
  private buildCreateTableSql(table: TableDefinition): string {
    const columns = table.columns
      .map((col) => {
        const duckDbType = mapColumnType(col.type);
        const nullable = col.nullable !== false ? "" : " NOT NULL";
        // Quote column names to handle reserved words
        return `"${col.name}" ${duckDbType}${nullable}`;
      })
      .join(", ");
    return `CREATE TABLE ${table.name} (${columns})`;
  }

  /**
   * Insert rows into a table using DuckDB Appender API for fast bulk insertion
   */
  private async insertRows(tableName: string, rows: Record<string, unknown>[]): Promise<void> {
    if (!this.connection || rows.length === 0) return;

    const columns = Object.keys(rows[0]);
    const appender = await this.connection.createAppender(tableName);

    try {
      for (const row of rows) {
        for (const col of columns) {
          const value = row[col];
          if (value === null || value === undefined) {
            appender.appendNull();
          } else if (typeof value === "boolean") {
            appender.appendBoolean(value);
          } else if (typeof value === "number") {
            if (Number.isNaN(value) || !Number.isFinite(value)) {
              appender.appendNull();
            } else if (Number.isInteger(value)) {
              appender.appendInteger(value);
            } else {
              appender.appendDouble(value);
            }
          } else if (typeof value === "bigint") {
            appender.appendBigInt(value);
          } else {
            appender.appendVarchar(String(value));
          }
        }
        appender.endRow();
      }
      appender.flushSync();
    } finally {
      appender.closeSync();
    }
  }

  /**
   * Execute multiple SQL queries and return results
   */
  async executeQueries(
    queries: Record<string, string>
  ): Promise<Record<string, SqlQueryExecutionResult>> {
    const results: Record<string, SqlQueryExecutionResult> = {};

    for (const [name, sql] of Object.entries(queries)) {
      try {
        results[name] = await this.executeQuery(sql);
      } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        results[name] = {
          error: errorMessage,
          columns: [],
          rows: [],
          rowCount: 0,
        };
        logger.warn(`Query "${name}" failed: ${errorMessage}`);
      }
    }

    return results;
  }

  /**
   * Load spatial extension on demand
   */
  private async ensureSpatialExtension(): Promise<void> {
    if (this.spatialExtensionLoaded || !this.connection) return;

    try {
      await this.connection.run("INSTALL spatial");
      await this.connection.run("LOAD spatial");
      this.spatialExtensionLoaded = true;
      logger.debug("DuckDB spatial extension loaded");
    } catch (error) {
      logger.warn(`Failed to load spatial extension: ${error}`);
    }
  }

  /**
   * Lock down DuckDB configuration to prevent SSRF via extension loading or filesystem/network access
   */
  private async lockdownConfiguration(): Promise<void> {
    if (!this.connection) return;

    await this.connection.run("SET enable_external_access = false");
    await this.connection.run("SET autoinstall_known_extensions = false");
    await this.connection.run("SET autoload_known_extensions = false");
    await this.connection.run("SET disabled_filesystems = 'LocalFileSystem'");
    await this.connection.run("SET lock_configuration = true");
    logger.debug("DuckDB configuration locked down");
  }

  /**
   * Populate geometry columns from GeoJSON or lat/lon data
   * This enables spatial queries like ST_Distance, ST_Within, etc.
   */
  private async populateGeometryColumns(tableName: string, schema: TableDefinition): Promise<void> {
    if (!this.connection) return;

    const columnNames = schema.columns.map((c) => c.name);
    const hasGeomColumn = columnNames.includes("geom");
    const hasGeomGeoJson = columnNames.includes("geom_geojson");
    const hasPointGeom = columnNames.includes("point_geom");
    const hasLatLon = columnNames.includes("lat") && columnNames.includes("lon");

    // Case 1: Table has geom column and geom_geojson source -> use ST_GeomFromGeoJSON
    if (hasGeomColumn && hasGeomGeoJson) {
      try {
        const updateSql = `UPDATE ${tableName} SET geom = ST_GeomFromGeoJSON(geom_geojson) WHERE geom_geojson IS NOT NULL`;
        await this.connection.run(updateSql);
        logger.debug(`Populated geom column in ${tableName} using ST_GeomFromGeoJSON`);
      } catch (error) {
        logger.warn(`Failed to populate geom column in ${tableName}: ${error}`);
      }
    }

    // Case 2: Table has point_geom column and lat/lon -> use ST_Point
    if (hasPointGeom && hasLatLon) {
      try {
        const updateSql = `UPDATE ${tableName} SET point_geom = ST_Point(lon, lat) WHERE lat IS NOT NULL AND lon IS NOT NULL`;
        await this.connection.run(updateSql);
        logger.debug(`Populated point_geom column in ${tableName} using ST_Point`);
      } catch (error) {
        logger.warn(`Failed to populate point_geom column in ${tableName}: ${error}`);
      }
    }
  }

  /**
   * Convert DuckDB-specific values to JSON-safe primitives.
   *
   * getRows() returns rich DuckDB value objects for non-JS-native types:
   * - bigint (from COUNT, date_part, BIGINT columns) → number
   * - DuckDB value objects like DuckDBDateValue, DuckDBTimestampValue,
   *   DuckDBTimeValue, DuckDBIntervalValue → string via .toString()
   *   (e.g. DATE "days since epoch" → "2025-03-15")
   */
  private convertDuckDBValues(rows: unknown[][]): unknown[][] {
    return rows.map((row) =>
      row.map((value) => {
        if (value === null || value === undefined) {
          return value;
        }
        if (typeof value === "bigint") {
          return Number(value);
        }
        // DuckDB value objects (DATE, TIMESTAMP, TIME, INTERVAL, etc.)
        // are non-null, non-array objects with a toString() that produces
        // human-readable strings (e.g. "2025-03-15", "08:30:00")
        if (typeof value === "object" && !Array.isArray(value)) {
          return String(value);
        }
        return value;
      })
    );
  }

  /**
   * Execute a single SQL query with security validation, timeout, and row limit
   */
  private async executeQuery(sql: string): Promise<SqlQueryResult> {
    if (!this.connection) {
      throw new Error("Database not initialized. Call initialize() first.");
    }

    // Security: Validate and sanitize the query
    this.validateQuery(sql);

    // Execute with timeout to prevent runaway queries
    const queryPromise = this.connection.runAndReadAll(sql);
    let timeoutId: ReturnType<typeof globalThis.setTimeout> | undefined;

    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutId = globalThis.setTimeout(() => {
        this.connection?.interrupt();
        reject(
          new Error(
            `Query timed out after ${this.options.queryTimeoutMs}ms. Simplify your query or use more restrictive filters.`
          )
        );
      }, this.options.queryTimeoutMs);
    });

    let reader;
    try {
      reader = await Promise.race([queryPromise, timeoutPromise]);
    } finally {
      globalThis.clearTimeout(timeoutId);
    }

    const columns = reader.columnNames();
    const rawRows = reader.getRows();

    // Convert non-JSON-safe DuckDB values to primitives:
    // - bigint (COUNT, date_part, etc.) → number
    // - DuckDB value objects (DATE, TIMESTAMP, TIME, INTERVAL) → string via .toString()
    const rows = this.convertDuckDBValues(rawRows);

    // Enforce row limit to prevent oversized responses
    const maxResultRows = this.options.maxResultRows;
    if (rows.length > maxResultRows) {
      return {
        columns,
        rows: rows.slice(0, maxResultRows),
        rowCount: rows.length,
        truncated: true,
        truncationMessage: `Results truncated to ${maxResultRows} rows (${rows.length} total). Use aggregation (GROUP BY, SUM, AVG) or add WHERE/LIMIT clauses for complete results.`,
      };
    }

    return {
      columns,
      rows,
      rowCount: rows.length,
    };
  }

  /**
   * Validate SQL query for security
   * Only SELECT queries are allowed, dangerous patterns are blocked
   */
  private validateQuery(sql: string): void {
    const trimmed = sql.trim();
    const upperTrimmed = trimmed.toUpperCase();

    // Only allow SELECT statements (read-only) or CTEs (WITH)
    if (!upperTrimmed.startsWith("SELECT") && !upperTrimmed.startsWith("WITH")) {
      throw new Error("Only SELECT queries are allowed. Queries must start with SELECT or WITH.");
    }

    // Ban semicolons — legitimate queries are single SELECT statements
    if (sql.includes(";")) {
      throw new Error("Query contains disallowed pattern: Multiple statements are not allowed");
    }

    // Defense-in-depth blocklist: these patterns are also blocked by DuckDB native settings
    // (enable_external_access=false, lock_configuration=true, disabled_filesystems), but the
    // regex layer provides clearer error messages and fail-fast before query execution.
    const dangerousPatterns: Array<{ pattern: RegExp; description: string }> = [
      // Config tampering (backed by lock_configuration=true)
      { pattern: /\bINSTALL\b/i, description: "Extension installation" },
      { pattern: /\bLOAD\b/i, description: "Extension loading" },
      { pattern: /\bSET\b/i, description: "Configuration changes" },
      { pattern: /\bRESET\b/i, description: "Configuration reset" },
      // Filesystem access (backed by enable_external_access=false + disabled_filesystems)
      { pattern: /\bCOPY\b\s+.*\s+\bTO\b/i, description: "COPY TO file operations" },
      { pattern: /\bCOPY\b\s+.*\s+\bFROM\b/i, description: "COPY FROM file operations" },
      {
        pattern: /\bread_csv\b|\bread_json\b|\bread_parquet\b|\bread_text\b|\bread_blob\b/i,
        description: "File read functions",
      },
      {
        pattern: /\bwrite_csv\b|\bwrite_json\b|\bwrite_parquet\b/i,
        description: "File write functions",
      },
      { pattern: /\bglob\s*\(/i, description: "Filesystem enumeration function" },
      // Network access (backed by enable_external_access=false)
      { pattern: /\bhttp_get\b|\bhttp_post\b/i, description: "HTTP functions" },
      // Database operations (backed by enable_external_access=false)
      { pattern: /\bATTACH\b/i, description: "Database attachment" },
      { pattern: /\bEXPORT\s+DATABASE\b/i, description: "Database export" },
      { pattern: /\bIMPORT\s+DATABASE\b/i, description: "Database import" },
      // Procedure/pragma (partially backed by lock_configuration)
      { pattern: /\bCALL\b/i, description: "Procedure calls" },
      { pattern: /\bPRAGMA\b/i, description: "PRAGMA statements" },
      // Information disclosure prevention
      {
        pattern: /\bduckdb_settings\b|\bduckdb_extensions\b/i,
        description: "DuckDB introspection functions",
      },
    ];

    for (const { pattern, description } of dangerousPatterns) {
      if (pattern.test(sql)) {
        throw new Error(`Query contains disallowed pattern: ${description}`);
      }
    }
  }

  /**
   * Get row counts for all tables (for metadata)
   */
  getTableRowCounts(): Record<string, number> {
    return Object.fromEntries(this.tableSizes);
  }

  /**
   * Clean up database resources
   * Always call this when done to prevent memory leaks
   */
  close(): void {
    if (this.connection) {
      this.connection.closeSync();
      this.connection = null;
      this.instance = null;
      logger.debug("DuckDB database closed");
    }
  }
}
