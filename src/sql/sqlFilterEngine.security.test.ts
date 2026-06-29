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

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { SqlFilterEngine } from "./sqlFilterEngine";
import { TableDefinition } from "./types";

const TEST_SCHEMA: TableDefinition[] = [
  {
    name: "traffic",
    columns: [
      { name: "id", type: "INTEGER" },
      { name: "speed", type: "REAL" },
      { name: "road", type: "TEXT" },
    ],
  },
];

const TEST_DATA = {
  tables: new Map([
    ["traffic", [{ id: 1, speed: 60.5, road: "A10" }]],
  ]),
};

async function initEngine(): Promise<SqlFilterEngine> {
  const engine = new SqlFilterEngine();
  await engine.initialize(TEST_SCHEMA, TEST_DATA);
  return engine;
}

describe("SqlFilterEngine Security", () => {
  let engine: SqlFilterEngine;

  beforeEach(async () => {
    engine = await initEngine();
  });

  afterEach(() => {
    engine?.close();
  });

  describe("PoC attack vectors (reported vulnerability)", () => {
    it("rejects INSTALL via semicolon chaining", async () => {
      const results = await engine.executeQueries({
        attack: "SELECT 1; INSTALL httpfs",
      });
      expect(results.attack.error).toBeDefined();
      expect(results.attack.error).toContain("disallowed");
    });

    it("rejects LOAD via semicolon chaining", async () => {
      const results = await engine.executeQueries({
        attack: "SELECT 1; LOAD httpfs",
      });
      expect(results.attack.error).toBeDefined();
      expect(results.attack.error).toContain("disallowed");
    });

    it("rejects read_text function for SSRF", async () => {
      const results = await engine.executeQueries({
        attack:
          "SELECT content FROM read_text('http://169.254.169.254/latest/meta-data/iam/security-credentials/')",
      });
      expect(results.attack.error).toBeDefined();
    });
  });

  describe("semicolon ban (multi-statement injection)", () => {
    it("rejects semicolon with whitespace variations", async () => {
      const attacks = [
        "SELECT 1 ; INSTALL httpfs",
        "SELECT 1;\nINSTALL httpfs",
        "SELECT 1;\tLOAD httpfs",
        "SELECT 1;\r\nDROP TABLE traffic",
        "SELECT 1 ;  DELETE FROM traffic",
      ];
      for (const sql of attacks) {
        const results = await engine.executeQueries({ q: sql });
        expect(results.q.error).toBeDefined();
      }
    });

    it("rejects semicolon even with benign follow-up", async () => {
      const results = await engine.executeQueries({
        q: "SELECT 1; SELECT 2",
      });
      expect(results.q.error).toBeDefined();
      expect(results.q.error).toContain("Multiple statements");
    });
  });

  describe("extension and config bypass attempts", () => {
    it("rejects INSTALL as first statement", async () => {
      const results = await engine.executeQueries({
        q: "INSTALL httpfs",
      });
      expect(results.q.error).toBeDefined();
    });

    it("rejects LOAD as first statement", async () => {
      const results = await engine.executeQueries({
        q: "LOAD httpfs",
      });
      expect(results.q.error).toBeDefined();
    });

    it("rejects SET configuration changes", async () => {
      const results = await engine.executeQueries({
        q: "SET enable_external_access = true",
      });
      expect(results.q.error).toBeDefined();
    });

    it("rejects RESET configuration", async () => {
      const results = await engine.executeQueries({
        q: "RESET enable_external_access",
      });
      expect(results.q.error).toBeDefined();
    });
  });

  describe("dangerous DuckDB functions", () => {
    const dangerousFunctions = [
      { fn: "read_text", sql: "SELECT * FROM read_text('/etc/passwd')" },
      { fn: "read_blob", sql: "SELECT * FROM read_blob('/etc/passwd')" },
      { fn: "read_csv", sql: "SELECT * FROM read_csv('/tmp/data.csv')" },
      { fn: "read_json", sql: "SELECT * FROM read_json('/tmp/data.json')" },
      { fn: "read_parquet", sql: "SELECT * FROM read_parquet('/tmp/data.parquet')" },
      { fn: "http_get", sql: "SELECT * FROM http_get('http://evil.com')" },
      { fn: "http_post", sql: "SELECT * FROM http_post('http://evil.com', '')" },
      { fn: "write_csv", sql: "SELECT * FROM write_csv((SELECT 1), '/tmp/out.csv')" },
      { fn: "write_json", sql: "SELECT * FROM write_json((SELECT 1), '/tmp/out.json')" },
      { fn: "write_parquet", sql: "SELECT * FROM write_parquet((SELECT 1), '/tmp/out.parquet')" },
      { fn: "glob", sql: "SELECT * FROM glob('/etc/*')" },
    ];

    for (const { fn, sql } of dangerousFunctions) {
      it(`rejects ${fn} function`, async () => {
        const results = await engine.executeQueries({ q: sql });
        expect(results.q.error).toBeDefined();
      });
    }
  });

  describe("DuckDB introspection functions", () => {
    it("rejects duckdb_settings()", async () => {
      const results = await engine.executeQueries({
        q: "SELECT * FROM duckdb_settings()",
      });
      expect(results.q.error).toBeDefined();
    });

    it("rejects duckdb_extensions()", async () => {
      const results = await engine.executeQueries({
        q: "SELECT * FROM duckdb_extensions()",
      });
      expect(results.q.error).toBeDefined();
    });
  });

  describe("legitimate queries (no regressions)", () => {
    it("allows basic SELECT", async () => {
      const results = await engine.executeQueries({
        q: "SELECT * FROM traffic",
      });
      expect(results.q.error).toBeUndefined();
      expect(results.q.rowCount).toBe(1);
    });

    it("allows WHERE, ORDER BY, LIMIT", async () => {
      const results = await engine.executeQueries({
        q: "SELECT id, speed FROM traffic WHERE speed > 50 ORDER BY speed DESC LIMIT 10",
      });
      expect(results.q.error).toBeUndefined();
    });

    it("allows GROUP BY and aggregates", async () => {
      const results = await engine.executeQueries({
        q: "SELECT road, COUNT(*) as cnt, AVG(speed) as avg_speed FROM traffic GROUP BY road HAVING COUNT(*) > 0",
      });
      expect(results.q.error).toBeUndefined();
    });

    it("allows subqueries", async () => {
      const results = await engine.executeQueries({
        q: "SELECT * FROM traffic WHERE speed > (SELECT AVG(speed) FROM traffic)",
      });
      expect(results.q.error).toBeUndefined();
    });

    it("allows CTEs", async () => {
      const results = await engine.executeQueries({
        q: "WITH fast AS (SELECT * FROM traffic WHERE speed > 50) SELECT * FROM fast",
      });
      expect(results.q.error).toBeUndefined();
    });

    it("allows UNION", async () => {
      const results = await engine.executeQueries({
        q: "SELECT id, speed FROM traffic WHERE speed > 50 UNION ALL SELECT id, speed FROM traffic WHERE speed <= 50",
      });
      expect(results.q.error).toBeUndefined();
    });

    it("allows CASE expressions", async () => {
      const results = await engine.executeQueries({
        q: "SELECT id, CASE WHEN speed > 50 THEN 'fast' ELSE 'slow' END as category FROM traffic",
      });
      expect(results.q.error).toBeUndefined();
    });

    it("allows CAST and type conversions", async () => {
      const results = await engine.executeQueries({
        q: "SELECT CAST(speed AS INTEGER) as int_speed FROM traffic",
      });
      expect(results.q.error).toBeUndefined();
    });

    it("allows string functions", async () => {
      const results = await engine.executeQueries({
        q: "SELECT UPPER(road) as upper_road, CONCAT(road, '-highway') as label FROM traffic WHERE road LIKE 'A%'",
      });
      expect(results.q.error).toBeUndefined();
    });
  });

  describe("DuckDB configuration lockdown (integration)", () => {
    it("blocks INSTALL httpfs at DuckDB level even if regex were bypassed", async () => {
      // This test verifies the DuckDB config lock works independently.
      // The engine should have locked config during initialize().
      // We can't bypass validateQuery() from outside, but we can verify
      // that even if an attacker somehow got past it, DuckDB would block.
      const results = await engine.executeQueries({
        q: "SELECT current_setting('enable_external_access') as val",
      });
      // current_setting is a legitimate DuckDB function
      expect(results.q.error).toBeUndefined();
      // DuckDB returns booleans (not strings) for boolean settings
      expect(String(results.q.rows[0][0])).toBe("false");
    });

    it("blocks SET after config lock", async () => {
      const results = await engine.executeQueries({
        q: "SELECT current_setting('lock_configuration') as val",
      });
      expect(results.q.error).toBeUndefined();
      // DuckDB returns booleans (not strings) for boolean settings
      expect(String(results.q.rows[0][0])).toBe("true");
    });

    it("blocks autoinstall of extensions at DuckDB level", async () => {
      const results = await engine.executeQueries({
        q: "SELECT current_setting('autoinstall_known_extensions') as val",
      });
      expect(results.q.error).toBeUndefined();
      expect(String(results.q.rows[0][0])).toBe("false");
    });

    it("community extensions are blocked", async () => {
      const results = await engine.executeQueries({
        q: "SELECT current_setting('allow_community_extensions') as val",
      });
      expect(results.q.error).toBeUndefined();
      expect(String(results.q.rows[0][0])).toBe("false");
    });

    it("spatial functions work after lockdown", async () => {
      const spatialSchema: TableDefinition[] = [
        {
          name: "points",
          columns: [
            { name: "id", type: "INTEGER" },
            { name: "lat", type: "REAL" },
            { name: "lon", type: "REAL" },
          ],
        },
      ];
      const spatialData = {
        tables: new Map([
          ["points", [{ id: 1, lat: 52.3, lon: 4.9 }]],
        ]),
      };

      const spatialEngine = new SqlFilterEngine();
      try {
        await spatialEngine.initialize(spatialSchema, spatialData);
        const results = await spatialEngine.executeQueries({
          q: "SELECT ST_AsText(ST_Point(4.9, 52.3)) as point",
        });
        expect(results.q.error).toBeUndefined();
        expect(results.q.rows[0][0]).toContain("POINT");
      } finally {
        spatialEngine.close();
      }
    });

    it("applies default resource limits", async () => {
      const results = await engine.executeQueries({
        q: "SELECT current_setting('threads') as t, current_setting('memory_limit') as m",
      });
      expect(results.q.error).toBeUndefined();
      expect(String(results.q.rows[0][0])).toBe("2");
      expect(String(results.q.rows[0][1])).toContain("MiB");
    });

    it("applies custom resource limits", async () => {
      const customEngine = new SqlFilterEngine({
        resourceLimits: { threads: 4, memoryLimit: "512MB" },
      });
      try {
        await customEngine.initialize(TEST_SCHEMA, TEST_DATA);
        const results = await customEngine.executeQueries({
          q: "SELECT current_setting('threads') as t",
        });
        expect(results.q.error).toBeUndefined();
        expect(String(results.q.rows[0][0])).toBe("4");
      } finally {
        customEngine.close();
      }
    });
  });

  describe("GLOB operator vs glob() function", () => {
    it("allows GLOB operator for string matching", async () => {
      const results = await engine.executeQueries({
        q: "SELECT * FROM traffic WHERE road GLOB 'A*'",
      });
      expect(results.q.error).toBeUndefined();
    });

    it("rejects glob() function call", async () => {
      const results = await engine.executeQueries({
        q: "SELECT * FROM glob('/etc/*')",
      });
      expect(results.q.error).toBeDefined();
    });
  });
});
