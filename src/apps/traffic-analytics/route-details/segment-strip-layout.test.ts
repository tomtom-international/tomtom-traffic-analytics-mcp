/*
 * Copyright (C) 2025 TomTom Navigation B.V.
 * Licensed under the Apache License, Version 2.0
 */

import { describe, it, expect } from "vitest";
import { computeSegmentStripLayout } from "./segment-strip-layout";

describe("computeSegmentStripLayout", () => {
  it("returns an empty array for no segments", () => {
    expect(computeSegmentStripLayout([], 320)).toEqual([]);
  });

  it("gives a single segment the full width", () => {
    const bars = computeSegmentStripLayout([{ segmentId: 7, segmentLength: 123 }], 320);
    expect(bars).toEqual([{ segmentId: 7, x: 0, width: 320 }]);
  });

  it("splits two equal-length segments into equal widths summing to ~width", () => {
    const bars = computeSegmentStripLayout(
      [
        { segmentId: 1, segmentLength: 100 },
        { segmentId: 2, segmentLength: 100 },
      ],
      300
    );
    expect(bars).toHaveLength(2);
    expect(bars[0].width).toBeCloseTo(150);
    expect(bars[1].width).toBeCloseTo(150);
    expect(bars[0].x).toBeCloseTo(0);
    expect(bars[1].x).toBeCloseTo(150);
    expect(bars[0].width + bars[1].width).toBeCloseTo(300);
  });

  it("preserves segment ids and input order", () => {
    const bars = computeSegmentStripLayout(
      [
        { segmentId: 42, segmentLength: 10 },
        { segmentId: 5, segmentLength: 30 },
        { segmentId: 99, segmentLength: 60 },
      ],
      100
    );
    expect(bars.map((b) => b.segmentId)).toEqual([42, 5, 99]);
  });

  it("computes cumulative x proportional to segment length", () => {
    const bars = computeSegmentStripLayout(
      [
        { segmentId: 1, segmentLength: 10 },
        { segmentId: 2, segmentLength: 30 },
        { segmentId: 3, segmentLength: 60 },
      ],
      100
    );
    expect(bars[0].x).toBeCloseTo(0);
    expect(bars[0].width).toBeCloseTo(10);
    expect(bars[1].x).toBeCloseTo(10);
    expect(bars[1].width).toBeCloseTo(30);
    expect(bars[2].x).toBeCloseTo(40);
    expect(bars[2].width).toBeCloseTo(60);
  });

  it("floors a tiny segment's width to the minimum bar width", () => {
    const bars = computeSegmentStripLayout(
      [
        { segmentId: 1, segmentLength: 1 },
        { segmentId: 2, segmentLength: 999 },
      ],
      100,
      2
    );
    expect(bars[0].width).toBe(2);
    expect(bars[1].width).toBeCloseTo(98);
  });

  it("falls back to equal widths when total length is zero", () => {
    const bars = computeSegmentStripLayout(
      [
        { segmentId: 1, segmentLength: 0 },
        { segmentId: 2, segmentLength: 0 },
        { segmentId: 3, segmentLength: 0 },
      ],
      90
    );
    expect(bars.map((b) => b.width)).toEqual([30, 30, 30]);
  });

  it("never returns negative or NaN widths", () => {
    const bars = computeSegmentStripLayout(
      [
        { segmentId: 1, segmentLength: -5 },
        { segmentId: 2, segmentLength: NaN as unknown as number },
        { segmentId: 3, segmentLength: 50 },
      ],
      60
    );
    for (const bar of bars) {
      expect(bar.width).toBeGreaterThan(0);
      expect(Number.isFinite(bar.width)).toBe(true);
      expect(Number.isFinite(bar.x)).toBe(true);
      expect(bar.x).toBeGreaterThanOrEqual(0);
    }
  });
});
