/*
 * Copyright (C) 2025 TomTom Navigation B.V.
 * Licensed under the Apache License, Version 2.0
 */

/** Placeholder shown when a numeric value is missing/invalid in the payload. */
export const NO_VALUE = "—";

/**
 * Formats a duration in seconds as "3 min 20 s" / "45 s" / "3 min".
 *
 * This is a local helper, not the SDK's `formatDuration` (which only reports
 * minute-level granularity and returns `undefined` under 30 seconds) — the
 * stat cards need second-level precision for short segments and delays.
 * Returns {@link NO_VALUE} when the input is missing or not a finite number
 * (partial API payloads must not render as "NaN s").
 */
export function formatDuration(totalSeconds: number | undefined | null): string {
  if (totalSeconds == null || !Number.isFinite(totalSeconds)) return NO_VALUE;
  const secs = Math.max(0, Math.round(totalSeconds));
  const mins = Math.floor(secs / 60);
  const rem = secs % 60;
  if (mins === 0) return `${rem} s`;
  return rem === 0 ? `${mins} min` : `${mins} min ${rem} s`;
}

/**
 * Formats a confidence value as a percentage. Accepts either a 0–1 fraction
 * (Flow Segment API) or a 0–100 percent (Route Monitoring API) — values <= 1
 * are treated as fractions. Returns {@link NO_VALUE} for non-finite input.
 */
export function formatConfidence(value: number | undefined | null): string {
  if (value == null || !Number.isFinite(value)) return NO_VALUE;
  const pct = value <= 1 ? Math.round(value * 100) : Math.round(value);
  return `${pct}%`;
}

/** Formats a speed with its unit label, or {@link NO_VALUE} for non-finite input. */
export function formatSpeed(value: number | undefined | null, unitLabel: string): string {
  if (value == null || !Number.isFinite(value)) return NO_VALUE;
  return `${Math.round(value)} ${unitLabel}`;
}
