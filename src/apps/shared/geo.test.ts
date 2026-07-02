/*
 * Copyright (C) 2025 TomTom Navigation B.V.
 * Licensed under the Apache License, Version 2.0
 */

import { customizeService } from "@tomtom-org/maps-sdk/services";
import { bboxUnion, withBaseData } from "./geo";
import areaAnalyticsFixture from "./__fixtures__/area-analytics-response.json";
import incidentsFixture from "./__fixtures__/incidents-response.json";

const { parseTrafficAreaAnalyticsResponse } = customizeService.trafficAreaAnalytics;
const { parseTrafficIncidentDetailsResponse } = customizeService.trafficIncidentDetails;

describe("withBaseData", () => {
  it("passes baseData through unchanged when already present", () => {
    const result = withBaseData(areaAnalyticsFixture) as typeof areaAnalyticsFixture;

    expect(result.features[0].properties.baseData).toEqual(
      areaAnalyticsFixture.features[0].properties.baseData
    );
  });

  it("preserves an existing feature id", () => {
    const result = withBaseData(areaAnalyticsFixture) as typeof areaAnalyticsFixture;

    expect(result.features[0].id).toBe(areaAnalyticsFixture.features[0].id);
  });

  it("synthesizes baseData from timedData.all when baseData is absent", () => {
    const raw = {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          geometry: { type: "Polygon", coordinates: [[[0, 0]]] },
          properties: {
            name: "Region without baseData",
            timedData: {
              all: { v: 42, c: 10 },
            },
          },
        },
      ],
    };

    const result = withBaseData(raw) as any;

    expect(result.features[0].properties.baseData).toEqual({ v: 42, c: 10 });
  });

  it("assigns a fallback id when the feature has none", () => {
    const raw = {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          geometry: { type: "Polygon", coordinates: [[[0, 0]]] },
          properties: { name: "No id", timedData: { all: {} } },
        },
      ],
    };

    const result = withBaseData(raw) as any;

    expect(result.features[0].id).toBe("region-0");
  });

  it("defaults to an empty object when neither baseData nor timedData.all is present", () => {
    const raw = {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          geometry: { type: "Polygon", coordinates: [[[0, 0]]] },
          properties: { name: "Nothing here", timedData: {} },
        },
      ],
    };

    const result = withBaseData(raw) as any;

    expect(result.features[0].properties.baseData).toEqual({});
  });

  it("parses cleanly via the SDK response parser when baseData is already present (real fixture)", () => {
    const shimmed = withBaseData(areaAnalyticsFixture);

    expect(() => parseTrafficAreaAnalyticsResponse(shimmed as any)).not.toThrow();

    const parsed = parseTrafficAreaAnalyticsResponse(shimmed as any);
    expect(parsed.type).toBe("FeatureCollection");
    expect(parsed.features).toHaveLength(areaAnalyticsFixture.features.length);
    // The SDK parser renames abbreviated API fields (v -> speed, c -> congestionLevel, etc.)
    expect(parsed.features[0].properties.baseData).toEqual({
      speed: areaAnalyticsFixture.features[0].properties.baseData.v,
      freeFlowSpeed: areaAnalyticsFixture.features[0].properties.baseData.fv,
      congestionLevel: areaAnalyticsFixture.features[0].properties.baseData.c,
      travelTime: areaAnalyticsFixture.features[0].properties.baseData.t,
      networkLength: areaAnalyticsFixture.features[0].properties.baseData.l,
    });
  });

  it("parses cleanly via the SDK response parser when baseData must be synthesized (timedData.all only)", () => {
    const timedAllOnly = {
      type: "FeatureCollection",
      properties: {
        startDate: "2026-06-26",
        endDate: "2026-06-28",
        dataTypes: ["SPEED", "CONGESTION_LEVEL"],
        heatmap: false,
        frcs: [0, 1, 2],
      },
      features: [
        {
          type: "Feature",
          id: "feat-timed-all",
          geometry: {
            type: "Polygon",
            coordinates: [
              [
                [4.9, 52.3],
                [4.9, 52.4],
                [5.0, 52.4],
                [4.9, 52.3],
              ],
            ],
          },
          properties: {
            name: "Synthesized",
            timezone: "Europe/Amsterdam",
            level: 0,
            timedData: {
              all: { v: 27.3, c: 34 },
            },
          },
        },
      ],
    };

    const shimmed = withBaseData(timedAllOnly);

    expect(() => parseTrafficAreaAnalyticsResponse(shimmed as any)).not.toThrow();

    const parsed = parseTrafficAreaAnalyticsResponse(shimmed as any);
    expect(parsed.features).toHaveLength(1);
    expect(parsed.features[0].properties.baseData).toEqual({ speed: 27.3, congestionLevel: 34 });
  });
});

describe("incidents fixture parsing", () => {
  it("parses via parseTrafficIncidentDetailsResponse and yields features with string ids", () => {
    const parsed = parseTrafficIncidentDetailsResponse(incidentsFixture as any);

    expect(parsed.type).toBe("FeatureCollection");
    expect(parsed.features.length).toBeGreaterThan(0);
    for (const feature of parsed.features) {
      expect(typeof feature.id).toBe("string");
      expect((feature.id as string).length).toBeGreaterThan(0);
    }
  });
});

describe("bboxUnion", () => {
  it("computes the union of two bounding boxes", () => {
    const a: [number, number, number, number] = [4.85, 52.35, 4.9, 52.38];
    const b: [number, number, number, number] = [4.88, 52.3, 4.95, 52.39];

    expect(bboxUnion([a, b])).toEqual([4.85, 52.3, 4.95, 52.39]);
  });

  it("returns the single bbox unchanged when given one bbox", () => {
    const a: [number, number, number, number] = [1, 2, 3, 4];

    expect(bboxUnion([a])).toEqual(a);
  });
});
