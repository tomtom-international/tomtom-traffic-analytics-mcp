/*
 * Copyright (C) 2025 TomTom NV
 * Licensed under the Apache License, Version 2.0
 */

import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { JsQueryEngine, buildWrapper } from "./jsQueryEngine";
import { type FlattenResult, isQueryError, type JsQuerySuccessResult } from "./types";

vi.mock("../utils/logger", () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

const DATA: FlattenResult = {
  tables: new Map<string, Record<string, unknown>[]>([
    [
      "approaches",
      [
        { junction_id: "J1", approach_id: 1, delay_sec: 30, queue_length_meters: 10 },
        { junction_id: "J1", approach_id: 2, delay_sec: 90, queue_length_meters: 40 },
        { junction_id: "J2", approach_id: 1, delay_sec: 10, queue_length_meters: null },
      ],
    ],
    ["turn_ratios", [{ junction_id: "J1", approach_id: 1, exit_id: 5, ratio_percent: 62 }]],
  ]),
};

/** Unwrap a successful result, failing loudly if the query errored. */
function value(result: ReturnType<typeof isQueryError> extends never ? never : any): unknown {
  expect(isQueryError(result), `unexpected error: ${JSON.stringify(result)}`).toBe(false);
  return (result as JsQuerySuccessResult).value;
}

describe("JsQueryEngine", () => {
  let engine: JsQueryEngine;

  beforeAll(async () => {
    engine = new JsQueryEngine();
    await engine.initialize(DATA);
  });

  afterAll(() => engine.close());

  it("loads only the datasets a query names, and still reports every shape", async () => {
    // A fresh engine, because the shared one has already loaded both datasets.
    const e = new JsQueryEngine();
    await e.initialize(DATA);
    try {
      const results = await e.executeQueries({ q: "approaches.length" });
      expect(value(results.q)).toBe(3);
      // Shapes are computed host-side, so an unloaded dataset is still described
      // — that is what lets a model correct a field name without re-fetching.
      expect(Object.keys(e.getDatasetShapes()).sort()).toEqual(["approaches", "turn_ratios"]);
    } finally {
      e.close();
    }
  });

  it("loads a dataset named only by a later batch of queries", async () => {
    const e = new JsQueryEngine();
    await e.initialize(DATA);
    try {
      expect(value((await e.executeQueries({ a: "approaches.length" })).a)).toBe(3);
      // turn_ratios was skipped by the first batch; the second must still see it.
      expect(value((await e.executeQueries({ b: "turn_ratios.length" })).b)).toBe(1);
    } finally {
      e.close();
    }
  });

  it("throws rather than returning undefined for a dataset no query named", async () => {
    const e = new JsQueryEngine();
    await e.initialize(DATA);
    try {
      // Reaching a dataset through a computed key defeats the source scan. The
      // guard must make that loud: `undefined.length` would be silent-wrong.
      const results = await e.executeQueries({
        sneaky: "const k = 'turn_' + 'ratios'; return globalThis.__datasets[k].length;",
      });
      expect(isQueryError(results.sneaky)).toBe(true);
      expect((results.sneaky as { error: string }).error).toContain("was not loaded");
      expect((results.sneaky as { error: string }).error).toContain("turn_ratios");
    } finally {
      e.close();
    }
  });

  it("loads everything when a query uses `data` programmatically", async () => {
    const e = new JsQueryEngine();
    await e.initialize(DATA);
    try {
      const results = await e.executeQueries({
        keys: "Object.keys(data).sort()",
        dynamic: "data['turn_' + 'ratios'].length",
      });
      expect(value(results.keys)).toEqual(["approaches", "turn_ratios"]);
      expect(value(results.dynamic)).toBe(1);
    } finally {
      e.close();
    }
  });

  it("does not confuse a dataset name with a longer identifier containing it", async () => {
    const data: FlattenResult = {
      tables: new Map<string, Record<string, unknown>[]>([
        ["data_rows", [{ n: 1 }]],
        ["rows", [{ n: 2 }]],
      ]),
    };
    const e = new JsQueryEngine();
    await e.initialize(data);
    try {
      // "data_rows" contains "rows", but \b must not match inside an identifier.
      const results = await e.executeQueries({ q: "data_rows.length" });
      expect(value(results.q)).toBe(1);
    } finally {
      e.close();
    }
  });

  it("evaluates a bare expression", async () => {
    const results = await engine.executeQueries({ q: "approaches.length" });
    expect(value(results.q)).toBe(3);
  });

  it("evaluates a statement block that ends in return", async () => {
    const results = await engine.executeQueries({
      q: "const slow = approaches.filter(a => a.delay_sec > 20);\nreturn slow.map(a => a.approach_id);",
    });
    expect(value(results.q)).toEqual([1, 2]);
  });

  it("binds each dataset as a local and on data", async () => {
    const results = await engine.executeQueries({
      locals: "turn_ratios[0].ratio_percent",
      viaData: "Object.keys(data).sort()",
    });
    expect(value(results.locals)).toBe(62);
    expect(value(results.viaData)).toEqual(["approaches", "turn_ratios"]);
  });

  it("groups and aggregates like a GROUP BY", async () => {
    const results = await engine.executeQueries({
      q: "Object.entries(Object.groupBy(approaches, a => a.junction_id)).map(([id, rows]) => ({ id, avg: rows.reduce((s, r) => s + r.delay_sec, 0) / rows.length }))",
    });
    expect(value(results.q)).toEqual([
      { id: "J1", avg: 60 },
      { id: "J2", avg: 10 },
    ]);
  });

  it("reports rowCount for array results", async () => {
    const results = await engine.executeQueries({ q: "approaches" });
    expect((results.q as JsQuerySuccessResult).rowCount).toBe(3);
  });

  it("returns per-query errors without failing the other queries", async () => {
    const results = await engine.executeQueries({
      bad: "approaches.nope()",
      good: "approaches.length",
    });
    expect(isQueryError(results.bad)).toBe(true);
    expect((results.bad as { error: string }).error).toMatch(/not a function/i);
    expect(value(results.good)).toBe(3);
  });

  it("names an unknown identifier in the error, so the model can self-correct", async () => {
    const results = await engine.executeQueries({ q: "segments.length" });
    expect((results.q as { error: string }).error).toMatch(/'segments' is not defined/);
  });

  it("rejects a result that cannot be serialised to JSON", async () => {
    const results = await engine.executeQueries({ q: "() => 1" });
    expect((results.q as { error: string }).error).toMatch(/cannot be serialised/i);
  });

  it("describes the loaded datasets, including a field absent from the first row", async () => {
    const shapes = engine.getDatasetShapes();
    expect(shapes.approaches.rows).toBe(3);
    expect(shapes.approaches.fields).toContain("queue_length_meters");
    expect(shapes.turn_ratios.rows).toBe(1);
  });

  it("loads turf only when a query references it", async () => {
    const before = await engine.executeQueries({ q: "typeof turf" });
    expect(value(before.q)).toBe("undefined");

    const after = await engine.executeQueries({
      q: "Math.round(turf.distance([4.9, 52.37], [4.91, 52.37], { units: 'meters' }))",
    });
    expect(value(after.q)).toBeGreaterThan(600);
    expect(value(after.q)).toBeLessThan(700);
  });

  it("loads h3 only when a query references it", async () => {
    const results = await engine.executeQueries({ q: "h3.latLngToCell(52.37, 4.9, 8)" });
    expect(value(results.q)).toMatch(/^8[0-9a-f]+$/);
  });
});

describe("JsQueryEngine result caps", () => {
  it("truncates arrays over the row cap and says so", async () => {
    const engine = new JsQueryEngine();
    await engine.initialize({ tables: new Map([["rows", []]]) });
    try {
      const results = await engine.executeQueries({
        q: "Array.from({ length: 12000 }, (_, i) => i)",
      });
      const result = results.q as JsQuerySuccessResult;
      expect(result.truncated).toBe(true);
      expect(result.rowCount).toBe(12000);
      expect((result.value as number[]).length).toBe(10000);
      expect(result.truncationMessage).toMatch(/12000 rows/);
    } finally {
      engine.close();
    }
  });

  it("truncates an array that is under the row cap but over the byte cap", async () => {
    const engine = new JsQueryEngine();
    await engine.initialize({ tables: new Map([["rows", []]]) });
    try {
      const results = await engine.executeQueries({
        q: "Array.from({ length: 5000 }, (_, i) => ({ i, blob: 'x'.repeat(500) }))",
      });
      const result = results.q as JsQuerySuccessResult;
      expect(result.truncated).toBe(true);
      expect((result.value as unknown[]).length).toBeLessThan(5000);
      expect(JSON.stringify(result.value).length).toBeLessThanOrEqual(1_000_000);
    } finally {
      engine.close();
    }
  });

  it("rejects an oversized non-array result rather than truncating it", async () => {
    const engine = new JsQueryEngine();
    await engine.initialize({ tables: new Map([["rows", []]]) });
    try {
      const results = await engine.executeQueries({ q: "'x'.repeat(2_000_000)" });
      expect((results.q as { error: string }).error).toMatch(/over the 1000000 byte cap/);
    } finally {
      engine.close();
    }
  });
});

describe("buildWrapper", () => {
  it("returns the source as a value in expression mode", () => {
    expect(buildWrapper("1 + 1", [], "expression")).toContain("return (\n1 + 1\n);");
  });

  it("uses the source as the function body in statements mode", () => {
    const wrapper = buildWrapper("const x = 1;\nreturn x;", [], "statements");
    expect(wrapper).toContain("const x = 1;\nreturn x;");
    expect(wrapper).not.toContain("return (");
  });

  it("binds only dataset names that are valid identifiers", () => {
    const wrapper = buildWrapper("1", ["good_name", "bad-name", "data"], "expression");
    expect(wrapper).toContain("const { good_name } = __datasets;");
    expect(wrapper).not.toContain("bad-name");
  });
});

describe("JsQueryEngine expression/statement handling", () => {
  let engine: JsQueryEngine;

  beforeAll(async () => {
    engine = new JsQueryEngine();
    await engine.initialize(DATA);
  });

  afterAll(() => engine.close());

  it("is not fooled by the word return inside a string literal", async () => {
    // A regex-based heuristic reads this as a statement block, runs it as one,
    // and silently returns nothing.
    const results = await engine.executeQueries({ q: "['return me'].join('')" });
    expect(value(results.q)).toBe("return me");
  });

  it("runs a statement-only query that never returns", async () => {
    const results = await engine.executeQueries({ q: "const unused = 1;" });
    expect(value(results.q)).toBeNull();
  });

  it("reports a syntax error that is invalid in both forms", async () => {
    const results = await engine.executeQueries({ q: "approaches.filter(" });
    expect((results.q as { error: string }).error).toMatch(/SyntaxError|unexpected/i);
  });
});
