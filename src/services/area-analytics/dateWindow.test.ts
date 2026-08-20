/*
 * Copyright (C) 2025 TomTom NV
 * Licensed under the Apache License, Version 2.0
 */

import { describe, expect, it } from "vitest";
import { clampEndDate, hasFeatureTimezone, latestAvailableEndDate } from "./dateWindow";

/** A fixed "today" so these assertions do not drift with the calendar. */
const NOW = new Date("2026-08-20T09:30:00Z");
const UTC_FEATURE = [{ type: "Feature", properties: {} }];
const TZ_FEATURE = [{ type: "Feature", properties: { timezone: "Europe/Amsterdam" } }];

describe("latestAvailableEndDate", () => {
  it("is two days back without a feature timezone", () => {
    expect(latestAvailableEndDate(false, NOW)).toBe("2026-08-18");
  });

  it("is three days back with one, matching the API's stricter rule", () => {
    expect(latestAvailableEndDate(true, NOW)).toBe("2026-08-17");
  });

  it("crosses a month boundary correctly", () => {
    expect(latestAvailableEndDate(false, new Date("2026-09-01T00:00:00Z"))).toBe("2026-08-30");
  });
});

describe("hasFeatureTimezone", () => {
  it("detects a timezone on any feature", () => {
    expect(hasFeatureTimezone(TZ_FEATURE)).toBe(true);
    expect(hasFeatureTimezone([...UTC_FEATURE, ...TZ_FEATURE])).toBe(true);
  });

  it("treats absent, blank and non-array inputs as no timezone", () => {
    expect(hasFeatureTimezone(UTC_FEATURE)).toBe(false);
    expect(hasFeatureTimezone([{ type: "Feature", properties: { timezone: "   " } }])).toBe(false);
    expect(hasFeatureTimezone([{ type: "Feature" }])).toBe(false);
    expect(hasFeatureTimezone(undefined)).toBe(false);
  });
});

describe("clampEndDate", () => {
  it("leaves a date already inside the window alone, with no warning", () => {
    const result = clampEndDate("2026-08-15", UTC_FEATURE, NOW);
    expect(result).toEqual({ endDate: "2026-08-15" });
  });

  it("leaves the boundary date alone", () => {
    expect(clampEndDate("2026-08-18", UTC_FEATURE, NOW).warning).toBeUndefined();
  });

  it("clamps today's date, which is the request that produced the 400", () => {
    const result = clampEndDate("2026-08-20", UTC_FEATURE, NOW);
    expect(result.endDate).toBe("2026-08-18");
    // The warning has to say what the results now cover, or a model would report
    // an answer for a window the caller never asked for.
    expect(result.warning).toContain("2026-08-18");
    expect(result.warning).toContain("2026-08-20");
  });

  it("applies the stricter rule when a feature sets a timezone", () => {
    const result = clampEndDate("2026-08-20", TZ_FEATURE, NOW);
    expect(result.endDate).toBe("2026-08-17");
  });

  it("passes a malformed or missing date through untouched", () => {
    // A bad date is the API's error to report. Rewriting it into a valid one
    // would turn a clear rejection into a silently different question.
    expect(clampEndDate("not-a-date", UTC_FEATURE, NOW)).toEqual({ endDate: "not-a-date" });
    expect(clampEndDate(undefined, UTC_FEATURE, NOW).endDate).toBeUndefined();
  });
});
