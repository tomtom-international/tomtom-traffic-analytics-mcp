/*
 * Copyright (C) 2025 TomTom Navigation B.V.
 * Licensed under the Apache License, Version 2.0
 */

import { App } from "@modelcontextprotocol/ext-apps";
import { TomTomMap, CustomGeoJSONModule, TrafficFlowModule } from "@tomtom-org/maps-sdk/map";
import { bboxFromCoordsArray } from "@tomtom-org/maps-sdk/core";
import { ensureTomTomConfigured } from "@shared/sdk-config";
import { extractFullData } from "@shared/viz-data";
import { shouldShowUI, showMapUI, hideMapUI, showErrorUI } from "@shared/ui-visibility";
import { ratioToColor, renderRampLegend } from "@shared/speed-colors";
import { formatDuration, formatConfidence, formatSpeed } from "@shared/format";
import "@shared/controls";
// Bundled so map chrome styling never depends on the CDN link the SDK
// injects at runtime (see resourceRegistry.ts APP_RESOURCE_CSP comment).
import "maplibre-gl/dist/maplibre-gl.css";
import "./styles.css";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Request parameters from the `tomtom-traffic-flow-segment` viz payload. */
interface VizRequest {
  point?: { latitude: number; longitude: number };
  style?: string;
  zoom?: number;
  unit?: string;
}

/** Raw Flow Segment Data API response, cached verbatim by the handler. */
interface VizSegment {
  frc: string;
  currentSpeed: number;
  freeFlowSpeed: number;
  currentTravelTime: number;
  freeFlowTravelTime: number;
  confidence: number;
  roadClosure: boolean;
  coordinates: Array<{ latitude: number; longitude: number }>;
}

interface VizPayload {
  tool: string;
  request: VizRequest;
  segment: VizSegment;
}

const FRC_LABELS: Record<string, string> = {
  FRC0: "Motorway",
  FRC1: "Major road",
  FRC2: "Other major road",
  FRC3: "Secondary road",
  FRC4: "Local connecting road",
  FRC5: "Local road (high importance)",
  FRC6: "Local road",
};

const CLOSED_COLOR = "#e03030";

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

const app = new App({ name: "tta-traffic-flow", version: "1.0.0" });

let map: TomTomMap | undefined;
let geoModule: CustomGeoJSONModule | undefined;
let flowBackdrop: TrafficFlowModule | undefined;
let backdropOn = true;

// ---------------------------------------------------------------------------
// DOM helpers
// ---------------------------------------------------------------------------

function el<T extends HTMLElement = HTMLElement>(id: string): T | null {
  return document.getElementById(id) as T | null;
}

function hideWaiting(): void {
  el("waiting-state")?.classList.add("hidden");
}

function setPanelVisible(visible: boolean): void {
  el("flow-panel")?.classList.toggle("hidden", !visible);
}

// ---------------------------------------------------------------------------
// Stat card
// ---------------------------------------------------------------------------

function renderStats(viz: VizPayload): void {
  const seg = viz.segment;
  const unitLabel = viz.request?.unit === "mph" ? "mph" : "km/h";

  const roadClassEl = el("road-class");
  if (roadClassEl) roadClassEl.textContent = FRC_LABELS[seg.frc] ?? seg.frc;

  el("closure-badge")?.classList.toggle("hidden", !seg.roadClosure);

  const grid = el("stat-grid");
  if (!grid) return;

  grid.innerHTML = "";

  const hasTimes =
    Number.isFinite(seg.currentTravelTime) && Number.isFinite(seg.freeFlowTravelTime);
  const delaySeconds = hasTimes ? seg.currentTravelTime - seg.freeFlowTravelTime : undefined;
  const rows: Array<[string, string]> = [
    ["Current speed", formatSpeed(seg.currentSpeed, unitLabel)],
    ["Free-flow speed", formatSpeed(seg.freeFlowSpeed, unitLabel)],
    ["Current travel time", formatDuration(seg.currentTravelTime)],
    ["Free-flow travel time", formatDuration(seg.freeFlowTravelTime)],
    ["Delay", delaySeconds !== undefined && delaySeconds > 0 ? formatDuration(delaySeconds) : delaySeconds === undefined ? "—" : "None"],
    ["Confidence", formatConfidence(seg.confidence)],
  ];

  for (const [label, value] of rows) {
    const dt = document.createElement("dt");
    dt.textContent = label;
    const dd = document.createElement("dd");
    dd.textContent = value;
    grid.appendChild(dt);
    grid.appendChild(dd);
  }
}

// ---------------------------------------------------------------------------
// Backdrop toggle — element lives in app.html from page load, so this only
// needs to be wired once.
// ---------------------------------------------------------------------------

el("backdrop-toggle")?.addEventListener("click", () => {
  backdropOn = !backdropOn;
  flowBackdrop?.setVisible(backdropOn);
  const btn = el("backdrop-toggle");
  btn?.classList.toggle("active", backdropOn);
  btn?.setAttribute("aria-pressed", String(backdropOn));
});

// ---------------------------------------------------------------------------
// MCP App lifecycle — register hooks before connect() (ext-apps 1.7 rule)
// ---------------------------------------------------------------------------

app.ontoolinput = async (): Promise<void> => {
  hideWaiting();
};

app.ontoolresult = async (result): Promise<void> => {
  hideWaiting();

  if (result.isError) {
    setPanelVisible(false);
    showErrorUI("Failed to fetch traffic flow data");
    return;
  }

  const rawText = (result.content?.[0] as { text?: string } | undefined)?.text ?? "{}";
  const parsedResp = JSON.parse(rawText);

  if (!shouldShowUI(parsedResp)) {
    setPanelVisible(false);
    hideMapUI();
    return;
  }

  if (!(await ensureTomTomConfigured(app))) {
    setPanelVisible(false);
    showErrorUI("TOMTOM_API_KEY not configured — map unavailable");
    return;
  }

  const viz = (await extractFullData(app, parsedResp)) as VizPayload;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- viz shape is unverified after a cache-miss fallback
  if (!Array.isArray((viz as any)?.segment?.coordinates)) {
    setPanelVisible(false);
    showErrorUI("Visualization data expired — re-run the tool");
    return;
  }

  showMapUI();

  map ??= new TomTomMap({
    style: "standardLight",
    mapLibre: { container: "sdk-map", center: [0, 0], zoom: 2 },
  });

  // E2E hook — the flow line/point are canvas-rendered, not DOM.
  if (!(window as unknown as { __e2e_ml?: unknown }).__e2e_ml) {
    (window as unknown as { __e2e_ml: unknown }).__e2e_ml = map.mapLibreMap;
  }

  // Backdrop FIRST so the queried segment's layers draw on top of it.
  flowBackdrop ??= await TrafficFlowModule.get(map, { visible: backdropOn });
  geoModule ??= await CustomGeoJSONModule.get(map, {
    sources: {
      segment: {
        layers: [
          {
            id: "traffic-flow-segment-casing",
            type: "line",
            layout: { "line-join": "round", "line-cap": "round" },
            paint: { "line-color": "#ffffff", "line-width": 9 },
          },
          {
            id: "traffic-flow-segment-line",
            type: "line",
            filter: ["!=", ["get", "closed"], true],
            layout: { "line-join": "round", "line-cap": "round" },
            paint: { "line-color": ["get", "color"], "line-width": 5 },
          },
          {
            id: "traffic-flow-segment-closed",
            type: "line",
            filter: ["==", ["get", "closed"], true],
            layout: { "line-join": "round", "line-cap": "round" },
            paint: { "line-color": CLOSED_COLOR, "line-width": 5, "line-dasharray": [2, 1.5] },
          },
        ],
      },
      point: {
        layers: [
          {
            id: "traffic-flow-point-circle",
            type: "circle",
            paint: {
              "circle-radius": 5,
              "circle-color": "#0a3653",
              "circle-stroke-width": 2,
              "circle-stroke-color": "#ffffff",
            },
          },
        ],
      },
    },
  });

  const seg = viz.segment;
  const ratio = seg.freeFlowSpeed > 0 ? seg.currentSpeed / seg.freeFlowSpeed : undefined;
  const lineCoords = seg.coordinates.map((c) => [c.longitude, c.latitude]);
  await geoModule.show(
    {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          id: "segment",
          geometry: { type: "LineString", coordinates: lineCoords },
          properties: { id: "segment", color: ratioToColor(ratio), closed: seg.roadClosure === true },
        },
      ],
    },
    "segment"
  );

  const pt = viz.request?.point;
  await geoModule.show(
    {
      type: "FeatureCollection",
      features: pt
        ? [
            {
              type: "Feature",
              id: "query-point",
              geometry: { type: "Point", coordinates: [pt.longitude, pt.latitude] },
              properties: { id: "query-point" },
            },
          ]
        : [],
    },
    "point"
  );

  setPanelVisible(true);
  renderStats(viz);

  const legendEl = el("legend");
  if (legendEl) renderRampLegend(legendEl, "Current vs free-flow speed");

  const bbox = bboxFromCoordsArray(lineCoords);
  if (bbox) map.mapLibreMap.fitBounds(bbox, { padding: 80, maxZoom: 16 });
};

app.onteardown = async (): Promise<Record<string, never>> => {
  geoModule?.setVisible(false);
  flowBackdrop?.setVisible(false);
  return {};
};

async function connectApp(): Promise<void> {
  try {
    await app.connect();
  } catch (error) {
    // Expected when opened standalone (no MCP host) — e.g. local smoke testing.
    console.warn("[traffic-flow] Failed to connect to MCP host:", error);
  }
}

void connectApp();
