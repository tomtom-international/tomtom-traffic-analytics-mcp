/*
 * Copyright (C) 2025 TomTom Navigation B.V.
 * Licensed under the Apache License, Version 2.0
 */

import { describe, it, expect } from "vitest";
import { selectEvictionKeys } from "./viz-eviction";

describe("selectEvictionKeys", () => {
  it("returns empty when under the bound", () => {
    expect(selectEvictionKeys([{ key: "a", t: 1 }], 20)).toEqual([]);
  });
  it("evicts the OLDEST entries first, regardless of key order", () => {
    const entries = [
      { key: "zz-newest", t: 300 },
      { key: "aa-oldest", t: 100 },
      { key: "mm-middle", t: 200 },
    ];
    expect(selectEvictionKeys(entries, 2)).toEqual(["aa-oldest"]);
    expect(selectEvictionKeys(entries, 1)).toEqual(["aa-oldest", "mm-middle"]);
  });
  it("treats missing timestamps as oldest (legacy unwrapped entries)", () => {
    const entries = [
      { key: "new", t: 100 },
      { key: "legacy", t: 0 },
    ];
    expect(selectEvictionKeys(entries, 1)).toEqual(["legacy"]);
  });
});
