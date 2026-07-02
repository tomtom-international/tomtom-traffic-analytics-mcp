/*
 * Copyright (C) 2025 TomTom Navigation B.V.
 * Licensed under the Apache License, Version 2.0
 */

/**
 * A GeoJSON-style bounding box: [minLon, minLat, maxLon, maxLat].
 */
export type Bbox = [number, number, number, number];

/**
 * Area Analytics "lite" shim.
 *
 * The Area Analytics `/areaanalytics/reports/lite` endpoint normally includes
 * `properties.baseData` on every feature, but some response shapes (older
 * cached data, alternate report modes) only carry `properties.timedData.all`.
 * SDK parsing (`customizeService.trafficAreaAnalytics.parseTrafficAreaAnalyticsResponse`)
 * requires `baseData` to be present, so this shim guarantees it — passing an
 * existing value through unchanged, or synthesizing it from `timedData.all`
 * when absent. It also guarantees every feature has a stable `id`, since the
 * SDK parser reads `id` off the top-level feature (not `properties`).
 *
 * @param raw - Raw (or partially processed) Area Analytics API response
 * @returns A shallow copy of `raw` with `baseData`/`id` guaranteed on every feature
 */
export function withBaseData(raw: any): any {
  return {
    ...raw,
    features: (raw?.features ?? []).map((f: any, i: number) => ({
      ...f,
      id: f.id ?? `region-${i}`,
      properties: {
        ...f.properties,
        baseData: f.properties?.baseData ?? f.properties?.timedData?.all ?? {},
      },
    })),
  };
}

/**
 * Computes the bounding box that contains all given bounding boxes.
 *
 * @param bboxes - One or more [minLon, minLat, maxLon, maxLat] boxes
 * @returns The smallest bbox that contains every input bbox
 * @throws {Error} If `bboxes` is empty
 */
export function bboxUnion(bboxes: Bbox[]): Bbox {
  if (bboxes.length === 0) {
    throw new Error("bboxUnion requires at least one bbox");
  }

  return bboxes.reduce<Bbox>(
    (acc, [minLon, minLat, maxLon, maxLat]) => [
      Math.min(acc[0], minLon),
      Math.min(acc[1], minLat),
      Math.max(acc[2], maxLon),
      Math.max(acc[3], maxLat),
    ],
    [...bboxes[0]] as Bbox
  );
}
