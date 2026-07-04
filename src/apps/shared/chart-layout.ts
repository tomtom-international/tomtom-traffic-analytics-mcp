/*
 * Copyright (C) 2025 TomTom Navigation B.V.
 * Licensed under the Apache License, Version 2.0
 */

/**
 * Computes bar width/gap for an SVG bar chart of `count` bars in `width` px.
 *
 * With many bars (e.g. a week of hourly entries = 168 bars in 320px) the
 * naive `(width - gap*(n-1)) / n` goes NEGATIVE, emitting invalid SVG
 * `<rect width="-…">`. When the preferred gap would leave less than 1px per
 * bar, the gap is dropped entirely and bars share the width exactly.
 */
export function computeBarLayout(
  count: number,
  width: number,
  preferredGap = 4
): { barWidth: number; barGap: number } {
  if (count <= 0) return { barWidth: 0, barGap: preferredGap };
  const withGap = (width - preferredGap * (count - 1)) / count;
  if (withGap >= 1) return { barWidth: withGap, barGap: preferredGap };
  return { barWidth: width / count, barGap: 0 };
}
