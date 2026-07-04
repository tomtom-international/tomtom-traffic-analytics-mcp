import { describe, it, expect } from "vitest";
import { formatDuration, formatConfidence, formatSpeed } from "./format";

describe("formatDuration", () => {
  it("formats seconds-only durations", () => {
    expect(formatDuration(45)).toBe("45 s");
    expect(formatDuration(0)).toBe("0 s");
  });
  it("omits the seconds part for whole minutes", () => {
    expect(formatDuration(180)).toBe("3 min");
  });
  it("formats mixed durations", () => {
    expect(formatDuration(200)).toBe("3 min 20 s");
  });
  it("clamps negatives to zero", () => {
    expect(formatDuration(-5)).toBe("0 s");
  });
  it("returns em dash for non-finite input", () => {
    expect(formatDuration(undefined)).toBe("—");
    expect(formatDuration(null)).toBe("—");
    expect(formatDuration(Number.NaN)).toBe("—");
  });
});

describe("formatConfidence", () => {
  it("treats values <= 1 as fractions", () => {
    expect(formatConfidence(0.83)).toBe("83%");
    expect(formatConfidence(1)).toBe("100%");
  });
  it("treats values > 1 as percentages", () => {
    expect(formatConfidence(83)).toBe("83%");
    expect(formatConfidence(99.6)).toBe("100%");
  });
  it("returns em dash for non-finite input", () => {
    expect(formatConfidence(undefined)).toBe("—");
    expect(formatConfidence(Number.NaN)).toBe("—");
  });
});

describe("formatSpeed", () => {
  it("rounds and appends the unit", () => {
    expect(formatSpeed(51.7, "km/h")).toBe("52 km/h");
  });
  it("returns em dash for non-finite input", () => {
    expect(formatSpeed(undefined, "km/h")).toBe("—");
    expect(formatSpeed(Number.NaN, "mph")).toBe("—");
  });
});
