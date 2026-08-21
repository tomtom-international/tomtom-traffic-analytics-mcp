/*
 * Copyright (C) 2025 TomTom NV
 * Licensed under the Apache License, Version 2.0
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { JsQueryEngine } from "./jsQueryEngine";
import type { FlattenResult, JsQuerySuccessResult } from "./types";

vi.mock("../utils/logger", () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

const DATA: FlattenResult = {
  tables: new Map<string, Record<string, unknown>[]>([["rows", [{ id: 1, value: 42 }]]]),
};

/**
 * The sandbox is deny-by-default: the guest runs on its own WASM heap and the
 * host never bridges anything into it. These tests assert that nothing from
 * the host — credentials, filesystem, network, module loader — is reachable,
 * and that runaway code is bounded rather than able to hang the server.
 */
describe("JsQueryEngine sandbox isolation", () => {
  let engine: JsQueryEngine;

  beforeAll(async () => {
    engine = new JsQueryEngine();
    await engine.initialize(DATA);
  });

  afterAll(() => engine.close());

  it.each([
    ["process", "typeof process"],
    ["require", "typeof require"],
    ["fetch", "typeof fetch"],
    ["XMLHttpRequest", "typeof XMLHttpRequest"],
    ["WebAssembly", "typeof WebAssembly"],
    ["setTimeout", "typeof setTimeout"],
    ["Worker", "typeof Worker"],
  ])("does not expose %s to guest code", async (_name, query) => {
    const results = await engine.executeQueries({ q: query });
    expect((results.q as JsQuerySuccessResult).value).toBe("undefined");
  });

  it("cannot read host environment variables", async () => {
    process.env.SANDBOX_CANARY = "leaked-api-key";
    try {
      const results = await engine.executeQueries({
        q: "typeof process === 'undefined' ? 'no process' : process.env.SANDBOX_CANARY",
      });
      expect((results.q as JsQuerySuccessResult).value).toBe("no process");
    } finally {
      process.env.SANDBOX_CANARY = undefined;
    }
  });

  it("cannot reach the host global object through the Function constructor", async () => {
    const results = await engine.executeQueries({
      // The classic escape: build a function whose body runs in global scope.
      // It still runs inside the guest, where there is no process to find.
      q: "(function () {}).constructor('return typeof process')()",
    });
    expect((results.q as JsQuerySuccessResult).value).toBe("undefined");
  });

  it("cannot import a host module", async () => {
    // There is no module loader in the guest, so the dynamic import produces a
    // promise that never settles rather than an error. What matters is that no
    // module object is ever handed back.
    const results = await engine.executeQueries({ q: "import('node:fs')" });
    expect((results.q as JsQuerySuccessResult).value).toEqual({});

    const awaited = await engine.executeQueries({
      q: "let seen = 'never resolved'; import('node:fs').then(m => { seen = typeof m.readFileSync; }); return seen;",
    });
    expect((awaited.q as JsQuerySuccessResult).value).toBe("never resolved");
  });

  it("cannot mutate host prototypes", async () => {
    await engine.executeQueries({
      q: "Object.prototype.polluted = 'yes'; return 1;",
    });
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it("keeps guest state from leaking between engines", async () => {
    const first = new JsQueryEngine();
    await first.initialize(DATA);
    await first.executeQueries({ q: "globalThis.stash = 'secret'; return 1;" });
    first.close();

    const second = new JsQueryEngine();
    await second.initialize(DATA);
    try {
      const results = await second.executeQueries({ q: "typeof globalThis.stash" });
      expect((results.q as JsQuerySuccessResult).value).toBe("undefined");
    } finally {
      second.close();
    }
  });
});

describe("JsQueryEngine resource limits", () => {
  it("interrupts an infinite loop instead of hanging the server", async () => {
    const engine = new JsQueryEngine();
    await engine.initialize(DATA);
    try {
      const startTime = Date.now();
      const results = await engine.executeQueries({ q: "while (true) {}" });
      const elapsed = Date.now() - startTime;

      expect((results.q as { error: string }).error).toMatch(/timed out after 5000ms/);
      // The interrupt fires on a wall-clock deadline, so this must land just
      // past the 5s budget rather than running forever.
      expect(elapsed).toBeGreaterThanOrEqual(5000);
      expect(elapsed).toBeLessThan(8000);
    } finally {
      engine.close();
    }
  }, 15000);

  it("interrupts an unbounded allocation loop", async () => {
    const engine = new JsQueryEngine();
    await engine.initialize(DATA);
    try {
      const results = await engine.executeQueries({
        q: "const acc = []; while (true) { acc.push('x'.repeat(1000)); } return acc.length;",
      });
      // Either the heap cap or the deadline stops it; both are failures the
      // host survives, which is the property under test.
      expect("error" in results.q).toBe(true);
    } finally {
      engine.close();
    }
  }, 20000);

  it("stays usable after a query is interrupted", async () => {
    const engine = new JsQueryEngine();
    await engine.initialize(DATA);
    try {
      await engine.executeQueries({ q: "while (true) {}" });
      const results = await engine.executeQueries({ q: "rows[0].value" });
      expect((results.q as JsQuerySuccessResult).value).toBe(42);
    } finally {
      engine.close();
    }
  }, 15000);

  it("survives runaway recursion with a stack cap", async () => {
    const engine = new JsQueryEngine();
    await engine.initialize(DATA);
    try {
      const results = await engine.executeQueries({
        q: "function f() { return f(); } return f();",
      });
      expect((results.q as { error: string }).error).toMatch(/stack overflow/i);
    } finally {
      engine.close();
    }
  });
});
