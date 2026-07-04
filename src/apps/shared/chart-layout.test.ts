import { describe, it, expect } from "vitest";
import { computeBarLayout } from "./chart-layout";

describe("computeBarLayout", () => {
  it("uses the preferred gap when there is room", () => {
    const { barWidth, barGap } = computeBarLayout(7, 320, 4);
    expect(barGap).toBe(4);
    expect(barWidth).toBeCloseTo((320 - 4 * 6) / 7);
  });
  it("never returns a negative or zero bar width for large series", () => {
    // 168 hourly entries used to produce barWidth ≈ -2 (invalid SVG)
    const { barWidth, barGap } = computeBarLayout(168, 320, 4);
    expect(barWidth).toBeGreaterThan(0);
    expect(barGap).toBe(0);
    expect(barWidth * 168).toBeLessThanOrEqual(320);
  });
  it("handles a single bar", () => {
    const { barWidth } = computeBarLayout(1, 320, 4);
    expect(barWidth).toBe(320);
  });
  it("returns zero width for zero count", () => {
    expect(computeBarLayout(0, 320, 4).barWidth).toBe(0);
  });
});
