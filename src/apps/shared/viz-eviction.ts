/*
 * Copyright (C) 2025 TomTom Navigation B.V.
 * Licensed under the Apache License, Version 2.0
 */

/**
 * Picks which cached viz entries to evict so at most `maxEntries` remain,
 * oldest-first by stored timestamp. Pure so the ordering is unit-testable —
 * the previous implementation sorted uuid-suffixed KEYS lexicographically,
 * which evicted arbitrary entries rather than the oldest.
 */
export function selectEvictionKeys(
  entries: Array<{ key: string; t: number }>,
  maxEntries: number
): string[] {
  if (entries.length <= maxEntries) return [];
  return [...entries]
    .sort((a, b) => a.t - b.t)
    .slice(0, entries.length - maxEntries)
    .map((e) => e.key);
}
