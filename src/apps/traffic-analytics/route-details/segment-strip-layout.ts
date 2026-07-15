/*
 * Copyright (C) 2025 TomTom Navigation B.V.
 * Licensed under the Apache License, Version 2.0
 */

/** One horizontal bar in the speed-profile strip. */
export interface SegmentStripBar {
  segmentId: number;
  x: number;
  width: number;
}

/**
 * Lays out one bar per segment across `width` px, proportional to
 * `segmentLength` — a long segment gets a wide bar, a short one a narrow bar,
 * cumulative left-to-right in input order.
 *
 * `minBarWidth` floors any segment's raw proportional width so tiny segments
 * (a few meters in a multi-km route) stay wide enough to hover/click. The
 * width reclaimed from floored segments is redistributed across the
 * remaining segments proportional to their own length, iterating until no
 * further segment dips below the floor (flooring one segment can push
 * another below the floor once its share is reclaimed elsewhere). If every
 * segment ends up floored (pathologically narrow `width` for the segment
 * count), the floor wins over exactly summing to `width`.
 *
 * Zero total length (no usable length data) falls back to equal widths.
 * Non-finite/non-positive input lengths are treated as zero-length.
 */
export function computeSegmentStripLayout(
  segments: { segmentId: number; segmentLength: number }[],
  width: number,
  minBarWidth = 2
): SegmentStripBar[] {
  const n = segments.length;
  if (n === 0 || !Number.isFinite(width) || width <= 0) return [];

  if (n === 1) {
    return [{ segmentId: segments[0].segmentId, x: 0, width }];
  }

  const lengths = segments.map((s) =>
    Number.isFinite(s.segmentLength) && s.segmentLength > 0 ? s.segmentLength : 0
  );
  const total = lengths.reduce((sum, len) => sum + len, 0);

  const widths: number[] =
    total > 0 ? lengths.map((len) => (len / total) * width) : new Array(n).fill(width / n);

  const floored = new Array(n).fill(false);
  for (let pass = 0; pass < n; pass++) {
    let changed = false;
    for (let i = 0; i < n; i++) {
      if (!floored[i] && widths[i] < minBarWidth) {
        floored[i] = true;
        changed = true;
      }
    }
    if (!changed) break;

    const flooredWidth = floored.reduce(
      (sum: number, isFloored: boolean) => (isFloored ? sum + minBarWidth : sum),
      0
    );
    const freeIndices = widths.map((_, i) => i).filter((i) => !floored[i]);
    const freeWidth = Math.max(0, width - flooredWidth);
    const freeTotal = freeIndices.reduce((sum, i) => sum + lengths[i], 0);

    for (const i of freeIndices) {
      widths[i] =
        freeTotal > 0 ? (lengths[i] / freeTotal) * freeWidth : freeWidth / freeIndices.length;
    }
    for (let i = 0; i < n; i++) {
      if (floored[i]) widths[i] = minBarWidth;
    }
  }

  let x = 0;
  return segments.map((seg, i) => {
    // Final guard: floats from the redistribution above stay finite and
    // positive by construction, but never emit an invalid SVG rect.
    const w = Number.isFinite(widths[i]) && widths[i] > 0 ? widths[i] : minBarWidth;
    const bar: SegmentStripBar = { segmentId: seg.segmentId, x, width: w };
    x += w;
    return bar;
  });
}
