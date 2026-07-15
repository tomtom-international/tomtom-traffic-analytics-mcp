/*
 * Copyright (C) 2025 TomTom Navigation B.V.
 * Licensed under the Apache License, Version 2.0
 */

/** Structural types so the tracker is testable without the maps SDK. */
interface MapLibreLike {
  setFeatureState(target: { source: string; id: string }, state: Record<string, boolean>): void;
  removeFeatureState(target: { source: string; id: string }, state?: string): void;
}

export interface FeatureStateHost {
  map: { mapLibreMap: MapLibreLike } | undefined;
  geoModule: { sourceAndLayerIDs: Record<string, { sourceID: string }> } | undefined;
}

/**
 * Creates a MapLibre feature-state setter that tracks the previously flagged
 * feature id per (source, state) pair, so at most one feature per pair is
 * ever flagged. Passing `null` clears the pair.
 *
 * `getHost` is read on every call so the tracker can be created at module
 * scope before the map/geoModule exist (calls before init are no-ops).
 */
export function createFeatureStateSetter(
  getHost: () => FeatureStateHost
): (source: string, id: string | number | null, state: string) => void {
  const prev: Record<string, Record<string, string | null>> = {};

  return function setState(source: string, id: string | number | null, state: string): void {
    const { map, geoModule } = getHost();
    if (!map || !geoModule) return;
    const sourceID = geoModule.sourceAndLayerIDs[source].sourceID;

    const prevBySource = (prev[source] ??= {});
    const prevId = prevBySource[state] ?? null;
    if (prevId !== null) {
      map.mapLibreMap.removeFeatureState({ source: sourceID, id: prevId }, state);
    }
    const next = id !== null ? String(id) : null;
    if (next !== null) {
      map.mapLibreMap.setFeatureState({ source: sourceID, id: next }, { [state]: true });
    }
    prevBySource[state] = next;
  };
}
