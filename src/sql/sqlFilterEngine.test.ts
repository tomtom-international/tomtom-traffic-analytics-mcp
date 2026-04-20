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

import { describe, it, expect, afterEach } from "vitest";
import { SqlFilterEngine } from "./sqlFilterEngine";
import { TableDefinition } from "./types";

describe("SqlFilterEngine", () => {
  let engine: SqlFilterEngine;

  afterEach(() => {
    engine?.close();
  });

  describe("DATE and TIMESTAMP result serialization", () => {
    const schema: TableDefinition[] = [
      {
        name: "events",
        columns: [
          { name: "id", type: "INTEGER" },
          { name: "time", type: "TEXT" },
          { name: "value", type: "REAL" },
        ],
      },
    ];

    const data = {
      tables: new Map([
        [
          "events",
          [
            { id: 1, time: "2025-03-15T08:00:00", value: 42.5 },
            { id: 2, time: "2025-03-15T14:30:00", value: 55.0 },
            { id: 3, time: "2025-03-16T09:00:00", value: 38.2 },
          ],
        ],
      ]),
    };

    it("should return DATE values as strings, not raw integers", async () => {
      engine = new SqlFilterEngine();
      await engine.initialize(schema, data);

      const results = await engine.executeQueries({
        daily:
          "SELECT time::DATE as day, AVG(value) as avg_val FROM events GROUP BY day ORDER BY day",
      });

      expect(results.daily.error).toBeUndefined();
      expect(results.daily.rowCount).toBe(2);

      // The day column should be a string like "2025-03-15", not a raw integer like 20163
      const firstRow = results.daily.rows[0];
      expect(typeof firstRow[0]).toBe("string");
      expect(firstRow[0]).toBe("2025-03-15");
    });

    it("should return TIMESTAMP values as strings", async () => {
      engine = new SqlFilterEngine();
      await engine.initialize(schema, data);

      const results = await engine.executeQueries({
        ts: "SELECT time::TIMESTAMP as ts FROM events ORDER BY ts LIMIT 1",
      });

      expect(results.ts.error).toBeUndefined();
      const firstRow = results.ts.rows[0];
      expect(typeof firstRow[0]).toBe("string");
      expect(firstRow[0]).toContain("2025-03-15");
    });

    it("should return date_part results as numbers", async () => {
      engine = new SqlFilterEngine();
      await engine.initialize(schema, data);

      const results = await engine.executeQueries({
        hours:
          "SELECT date_part('hour', time::TIMESTAMP) as hour, AVG(value) as avg_val FROM events GROUP BY hour ORDER BY hour",
      });

      expect(results.hours.error).toBeUndefined();
      expect(results.hours.rowCount).toBe(3);

      // date_part returns BigInt in DuckDB; getRowsJson() should convert to number
      const firstRow = results.hours.rows[0];
      expect(typeof firstRow[0]).toBe("number");
    });

    it("should return COUNT/SUM aggregates as numbers", async () => {
      engine = new SqlFilterEngine();
      await engine.initialize(schema, data);

      const results = await engine.executeQueries({
        agg: "SELECT COUNT(*) as cnt, SUM(value) as total FROM events",
      });

      expect(results.agg.error).toBeUndefined();
      const row = results.agg.rows[0];
      // COUNT returns BigInt in DuckDB; should be a number after conversion
      expect(typeof row[0]).toBe("number");
      expect(row[0]).toBe(3);
      expect(typeof row[1]).toBe("number");
    });
  });
});
