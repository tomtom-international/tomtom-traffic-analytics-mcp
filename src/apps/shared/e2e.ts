/*
 * Copyright (C) 2025 TomTom Navigation B.V.
 * Licensed under the Apache License, Version 2.0
 */

import type { TomTomMap } from "@tomtom-org/maps-sdk/map";

/**
 * Exposes the underlying MapLibre map for Playwright E2E tests — map content
 * (markers, lines, tiles) is canvas-rendered, not DOM, so tests drive the map
 * through this handle. First map wins: never overwritten, so the handle
 * always refers to the app's primary map regardless of module init order.
 */
export function exposeMapForE2E(map: TomTomMap): void {
  const w = window as unknown as { __e2e_ml?: unknown };
  if (!w.__e2e_ml) {
    w.__e2e_ml = map.mapLibreMap;
  }
}
