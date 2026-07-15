import { describe, it, expect } from "vitest";
import { ratioToColor, NO_DATA_COLOR, RATIO_STOPS, gradientCss } from "./speed-colors";

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

describe("gradientCss", () => {
  it("normalizes stop positions by the stops' own min/max", () => {
    expect(
      gradientCss([
        { value: 0.4, color: "#e03030" },
        { value: 0.7, color: "#f5a623" },
        { value: 0.9, color: "#2dc653" },
      ])
    ).toBe("#e03030 0.0%, #f5a623 60.0%, #2dc653 100.0%");
  });
  it("guards a zero span (all stops equal)", () => {
    expect(
      gradientCss([
        { value: 5, color: "#111111" },
        { value: 5, color: "#222222" },
      ])
    ).toBe("#111111 0.0%, #222222 0.0%");
  });
  it("returns empty string for no stops", () => {
    expect(gradientCss([])).toBe("");
  });
});
