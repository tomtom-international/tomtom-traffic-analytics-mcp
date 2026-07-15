/*
 * Copyright (C) 2025 TomTom Navigation B.V.
 * Licensed under the Apache License, Version 2.0
 */

/**
 * Removes items with duplicate keys, keeping the FIRST occurrence and
 * preserving input order. Used to dedupe incidents returned by more than one
 * overlapping bbox query — MapLibre requires unique feature ids for
 * feature-state, and duplicated list rows break focus highlighting.
 */
export function dedupeBy<T>(items: T[], key: (item: T) => string): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const item of items) {
    const k = key(item);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(item);
  }
  return out;
}
