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
 * Fallback dates to use when a raw Area Analytics response has neither
 * `properties.startDate`/`endDate` nor `properties.days`.
 */
export interface AreaAnalyticsDateFallback {
  startDate?: string;
  endDate?: string;
}

/**
 * Area Analytics "date shape" shim.
 *
 * The real `/areaanalytics/reports/lite` endpoint returns collection-level
 * `properties.days: ["YYYY-MM-DD", ...]` instead of `properties.startDate`/`endDate`.
 * The SDK's `parseTrafficAreaAnalyticsResponse` does `new Date(properties.startDate)`
 * unguarded, which yields an Invalid Date when `startDate` is absent. This shim
 * synthesizes `startDate` (min of `days`) and `endDate` (max of `days`) whenever
 * they're missing and `days` is present, composing with {@link withBaseData}.
 *
 * When neither `startDate`/`endDate` nor `days` is present, falls back to the
 * dates from the original tool request (if supplied) — e.g. when the API
 * response shape changes again and omits every date field.
 *
 * @param raw - Raw (or partially processed) Area Analytics API response
 * @param fallback - Dates from the originating tool request, used only when
 *   the response itself carries neither `startDate`/`endDate` nor `days`
 * @returns A shallow copy of `raw` (with `baseData` guaranteed via `withBaseData`)
 *   and collection-level `startDate`/`endDate` guaranteed whenever derivable
 */
export function normalizeAreaResponse(raw: any, fallback?: AreaAnalyticsDateFallback): any {
  const withData = withBaseData(raw);
  const properties = withData?.properties ?? {};

  if (properties.startDate && properties.endDate) {
    return withData;
  }

  let startDate = properties.startDate;
  let endDate = properties.endDate;

  const days: unknown = properties.days;
  if ((!startDate || !endDate) && Array.isArray(days) && days.length > 0) {
    const sorted = [...days].sort();
    startDate = startDate ?? sorted[0];
    endDate = endDate ?? sorted[sorted.length - 1];
  }

  if (!startDate || !endDate) {
    startDate = startDate ?? fallback?.startDate;
    endDate = endDate ?? fallback?.endDate;
  }

  return {
    ...withData,
    properties: {
      ...properties,
      startDate,
      endDate,
    },
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

/**
 * Vertex-average centroid of a GeoJSON polygon ring.
 *
 * GeoJSON rings are closed (first coordinate repeated as the last); averaging
 * all vertices would count that shared vertex twice and bias the centroid
 * toward it, so the duplicated closing vertex is excluded first.
 *
 * @param ring - Array of [lon, lat] vertices (open or closed)
 * @returns [lon, lat] centroid, or null when the ring is empty
 */
export function polygonRingCentroid(ring: number[][]): [number, number] | null {
  if (ring.length === 0) return null;

  const first = ring[0];
  const last = ring[ring.length - 1];
  const isClosed =
    ring.length > 1 && first[0] === last[0] && first[1] === last[1];
  const vertices = isClosed ? ring.slice(0, -1) : ring;

  let sumLon = 0;
  let sumLat = 0;
  for (const vertex of vertices) {
    sumLon += vertex[0];
    sumLat += vertex[1];
  }
  return [sumLon / vertices.length, sumLat / vertices.length];
}
