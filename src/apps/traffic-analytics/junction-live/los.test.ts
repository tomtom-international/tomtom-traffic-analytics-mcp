/*
 * Copyright (C) 2025 TomTom Navigation B.V.
 * Licensed under the Apache License, Version 2.0
 */

import { LOS_BANDS, losFor, losThresholdLabel } from "./los";

describe("losFor", () => {
  it("maps boundary delays to bands", () => {
    expect(losFor(10)?.letter).toBe("A");
    expect(losFor(10.1)?.letter).toBe("B");
    expect(losFor(80)?.letter).toBe("E");
    expect(losFor(80.1)?.letter).toBe("F");
    expect(losFor(1e9)?.letter).toBe("F");
  });

  it("returns undefined for null/NaN", () => {
    expect(losFor(null)).toBeUndefined();
    expect(losFor(undefined)).toBeUndefined();
    expect(losFor(Number.NaN)).toBeUndefined();
  });
});

describe("losThresholdLabel", () => {
  it("formats thresholds", () => {
    expect(losThresholdLabel(LOS_BANDS[0])).toBe("≤10 s");
    expect(losThresholdLabel(LOS_BANDS[5])).toBe(">80 s");
  });
});

describe("LOS_BANDS", () => {
  it("every band has a plain-language label", () => {
    for (const b of LOS_BANDS) expect(b.label.length).toBeGreaterThan(0);
  });
});
