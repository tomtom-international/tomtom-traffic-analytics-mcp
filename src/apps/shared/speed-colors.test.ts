import { describe, it, expect } from "vitest";
import { ratioToColor, NO_DATA_COLOR, RATIO_STOPS } from "./speed-colors";

describe("ratioToColor", () => {
  it("returns exact stop colors at stop values", () => {
    for (const [value, color] of RATIO_STOPS) {
      expect(ratioToColor(value)).toBe(color);
    }
  });
  it("clamps below the first stop and above the last", () => {
    expect(ratioToColor(0)).toBe(RATIO_STOPS[0][1]);
    expect(ratioToColor(0.1)).toBe(RATIO_STOPS[0][1]);
    expect(ratioToColor(1)).toBe(RATIO_STOPS[RATIO_STOPS.length - 1][1]);
    expect(ratioToColor(1.5)).toBe(RATIO_STOPS[RATIO_STOPS.length - 1][1]);
  });
  it("interpolates between stops to a valid hex that is neither endpoint", () => {
    const mid = ratioToColor(0.55); // between 0.4 (red) and 0.7 (amber)
    expect(mid).toMatch(/^#[0-9a-f]{6}$/);
    expect(mid).not.toBe(RATIO_STOPS[0][1]);
    expect(mid).not.toBe(RATIO_STOPS[1][1]);
  });
  it("returns NO_DATA_COLOR for null, undefined, and NaN", () => {
    expect(ratioToColor(null)).toBe(NO_DATA_COLOR);
    expect(ratioToColor(undefined)).toBe(NO_DATA_COLOR);
    expect(ratioToColor(Number.NaN)).toBe(NO_DATA_COLOR);
  });
});
