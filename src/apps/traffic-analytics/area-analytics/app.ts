/*
 * Copyright (C) 2025 TomTom Navigation B.V.
 * Licensed under the Apache License, Version 2.0
 */

import { App } from "@modelcontextprotocol/ext-apps";
import {
  TomTomMap,
  TrafficAreaAnalyticsModule,
  resolveColorStops,
  type AreaAnalyticsDisplayMode,
} from "@tomtom-org/maps-sdk/map";
import { bboxFromGeoJSON } from "@tomtom-org/maps-sdk/core";
import { customizeService } from "@tomtom-org/maps-sdk/services";
import type {
  TrafficAreaAnalytics,
  AreaAnalyticsMetricKey,
  AreaAnalyticsTimedEntry,
} from "@tomtom-org/maps-sdk/core";
import type { AreaAnalyticsTileFeature } from "@tomtom-org/maps-sdk/map";
import { ensureTomTomConfigured } from "@shared/sdk-config";
import { extractFullData } from "@shared/viz-data";
import { shouldShowUI, showMapUI, hideMapUI, showErrorUI } from "@shared/ui-visibility";
import { normalizeAreaResponse } from "@shared/geo";
import "./styles.css";

const { parseTrafficAreaAnalyticsResponse } = customizeService.trafficAreaAnalytics;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Request parameters from the `tomtom-area-analytics-stats` viz payload. */
interface VizRequest {
  name?: string;
  startDate?: string;
  endDate?: string;
  dataTypes?: string[];
  hours?: number[];
  frcs?: number[];
}

interface VizPayload {
  tool: string;
  request: VizRequest;
  /** Raw Area Analytics `/areaanalytics/reports/lite` response. */
  report: unknown;
}

const METRIC_LABEL: Record<AreaAnalyticsMetricKey, string> = {
  speed: "Speed (km/h)",
  freeFlowSpeed: "Free-flow speed (km/h)",
  congestionLevel: "Congestion (%)",
  travelTime: "Travel time (min/10km)",
  networkLength: "Network length (m)",
};

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

const app = new App({ name: "tta-area-analytics", version: "1.0.0" });

let map: TomTomMap | undefined;
let analyticsModule: TrafficAreaAnalyticsModule | undefined;
let hoverBound = false;

let analytics: TrafficAreaAnalytics | undefined;
let currentRequest: VizRequest = {};
let currentMode: AreaAnalyticsDisplayMode = "hexgrid-3d";
let activeMetric: AreaAnalyticsMetricKey = "congestionLevel";
let availableMetrics: AreaAnalyticsMetricKey[] = [];

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
  el("analytics-panel")?.classList.toggle("hidden", !visible);
  if (!visible) {
    el("tile-tooltip")?.classList.add("hidden");
  }
}

function clearRangeInputs(): void {
  const minEl = el<HTMLInputElement>("range-min");
  const maxEl = el<HTMLInputElement>("range-max");
  if (minEl) minEl.value = "";
  if (maxEl) maxEl.value = "";
}

// ---------------------------------------------------------------------------
// Metric helpers
// ---------------------------------------------------------------------------

function pickMetric(
  metrics: AreaAnalyticsMetricKey[],
  preferred: AreaAnalyticsMetricKey
): AreaAnalyticsMetricKey {
  if (metrics.includes(preferred)) return preferred;
  if (metrics.includes("congestionLevel")) return "congestionLevel";
  return metrics[0] ?? preferred;
}

function formatMetricValue(metric: AreaAnalyticsMetricKey, value: number): string {
  const rounded = Math.round(value * 10) / 10;
  switch (metric) {
    case "congestionLevel":
      return `${rounded}%`;
    case "speed":
    case "freeFlowSpeed":
      return `${rounded} km/h`;
    case "travelTime":
      return `${rounded} min/10km`;
    case "networkLength":
      return `${Math.round(value)} m`;
    default:
      return `${rounded}`;
  }
}

function hasTileData(data: TrafficAreaAnalytics): boolean {
  return data.features.some((f) => (f.properties.tiledData?.tiles?.length ?? 0) > 0);
}

// ---------------------------------------------------------------------------
// Header
// ---------------------------------------------------------------------------

function formatDate(date: Date | undefined): string {
  if (!date || Number.isNaN(date.getTime())) return "Unknown";
  return date.toISOString().slice(0, 10);
}

function renderHeader(data: TrafficAreaAnalytics, request: VizRequest): void {
  const titleEl = el("header-title");
  const metaEl = el("header-meta");
  if (!titleEl || !metaEl) return;

  const name = data.features[0]?.properties.name ?? request.name ?? "Area";
  titleEl.textContent = name;

  const dateRange = `${formatDate(data.properties.startDate)} – ${formatDate(data.properties.endDate)}`;
  const hours = request.hours?.length ? `Hours: ${request.hours.join(", ")}` : "";
  const frcs = request.frcs?.length ? `FRC: ${request.frcs.join(", ")}` : "";
  metaEl.textContent = [dateRange, hours, frcs].filter(Boolean).join(" · ");
}

// ---------------------------------------------------------------------------
// Controls: mode / metric selects
// ---------------------------------------------------------------------------

function populateModeSelect(mode: AreaAnalyticsDisplayMode): void {
  const select = el<HTMLSelectElement>("mode-select");
  if (select) select.value = mode;
}

function populateMetricSelect(metrics: AreaAnalyticsMetricKey[], active: AreaAnalyticsMetricKey): void {
  const select = el<HTMLSelectElement>("metric-select");
  if (!select) return;

  select.innerHTML = "";
  for (const metric of metrics) {
    const option = document.createElement("option");
    option.value = metric;
    option.textContent = METRIC_LABEL[metric] ?? metric;
    if (metric === active) option.selected = true;
    select.appendChild(option);
  }
}

// ---------------------------------------------------------------------------
// Legend
// ---------------------------------------------------------------------------

function renderLegend(): void {
  const legend = el("legend");
  if (!legend || !analyticsModule || !analytics) return;

  if (!hasTileData(analytics)) {
    legend.classList.add("hidden");
    return;
  }

  const config = analyticsModule.getConfig();
  const colorConfig = config?.metricConfig?.[activeMetric]?.color ?? "trafficLight";
  const stops = resolveColorStops(colorConfig);

  if (!stops.length) {
    legend.classList.add("hidden");
    return;
  }

  const range = analytics.properties.ranges[activeMetric];
  const gradient = stops.map((s) => `${s.color} ${Math.round(s.value * 100)}%`).join(", ");

  legend.innerHTML = `
    <div class="legend-title">${METRIC_LABEL[activeMetric] ?? activeMetric}</div>
    <div class="legend-bar" style="background: linear-gradient(to right, ${gradient})"></div>
    <div class="legend-range">
      <span>${range ? formatMetricValue(activeMetric, range.min) : "–"}</span>
      <span>${range ? formatMetricValue(activeMetric, range.max) : "–"}</span>
    </div>
  `;
  legend.classList.remove("hidden");
}

// ---------------------------------------------------------------------------
// Time-series panel (inline SVG bars, no chart library)
// ---------------------------------------------------------------------------

function formatTimeLabel(entry: AreaAnalyticsTimedEntry): string {
  if (entry.date) {
    const date = entry.date instanceof Date ? entry.date : new Date(entry.date);
    const day = Number.isNaN(date.getTime()) ? "" : date.toISOString().slice(0, 10);
    return entry.hour !== undefined ? `${day} ${entry.hour}:00` : day;
  }
  return "";
}

function renderTimeSeries(): void {
  const chart = el("timeseries-chart");
  if (!chart) return;

  const feature = analytics?.features[0];
  const series = feature?.properties.timedData.daily ?? feature?.properties.timedData.hourly ?? [];

  if (series.length === 0) {
    chart.innerHTML = `<div class="state-panel timeseries-empty">No time-series data for this metric</div>`;
    return;
  }

  const values = series.map((entry) => entry[activeMetric] ?? 0);
  const max = Math.max(...values, 0.0001);

  const width = 320;
  const height = 110;
  const barGap = 4;
  const barWidth = (width - barGap * (values.length - 1)) / values.length;

  const bars = values
    .map((value, i) => {
      const barHeight = Math.max(2, (value / max) * (height - 16));
      const x = i * (barWidth + barGap);
      const y = height - barHeight;
      const label = formatTimeLabel(series[i]);
      const valueLabel = formatMetricValue(activeMetric, value);
      return `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barWidth.toFixed(1)}" height="${barHeight.toFixed(1)}" fill="#2563eb" rx="1.5"><title>${label}: ${valueLabel}</title></rect>`;
    })
    .join("");

  chart.innerHTML = `
    <svg viewBox="0 0 ${width} ${height}" width="100%" height="${height}" preserveAspectRatio="none" role="img" aria-label="${METRIC_LABEL[activeMetric]} time series">
      ${bars}
    </svg>
  `;
}

// ---------------------------------------------------------------------------
// Hover tooltip
// ---------------------------------------------------------------------------

function hideTooltip(): void {
  el("tile-tooltip")?.classList.add("hidden");
}

function renderTooltipContent(feature: AreaAnalyticsTileFeature): string {
  const rows = availableMetrics
    .filter((metric) => feature.properties[metric] !== undefined)
    .map((metric) => {
      const value = feature.properties[metric] as number;
      return `<div class="tooltip-row"><span>${METRIC_LABEL[metric] ?? metric}</span><span>${formatMetricValue(metric, value)}</span></div>`;
    })
    .join("");
  return rows || `<div class="tooltip-row">No data</div>`;
}

function handleHover(
  feature: AreaAnalyticsTileFeature | undefined,
  lngLat: { lng: number; lat: number } | undefined
): void {
  const tooltip = el("tile-tooltip");
  if (!tooltip || !map) return;

  if (!feature || !lngLat) {
    hideTooltip();
    return;
  }

  const point = map.mapLibreMap.project(lngLat);
  tooltip.style.left = `${point.x}px`;
  tooltip.style.top = `${point.y}px`;
  tooltip.innerHTML = renderTooltipContent(feature);
  tooltip.classList.remove("hidden");
}

// ---------------------------------------------------------------------------
// Empty-state handling
// ---------------------------------------------------------------------------

function toggleEmptyState(empty: boolean): void {
  el("empty-state")?.classList.toggle("hidden", !empty);
  if (empty) {
    el("legend")?.classList.add("hidden");
    el("timeseries-panel")?.classList.add("hidden");
  }
}

// ---------------------------------------------------------------------------
// Static control wiring — elements live in app.html from page load, so this
// only needs to run once.
// ---------------------------------------------------------------------------

el<HTMLSelectElement>("mode-select")?.addEventListener("change", (event) => {
  currentMode = (event.target as HTMLSelectElement).value as AreaAnalyticsDisplayMode;
  analyticsModule?.setMode(currentMode);
});

el<HTMLSelectElement>("metric-select")?.addEventListener("change", (event) => {
  activeMetric = (event.target as HTMLSelectElement).value as AreaAnalyticsMetricKey;
  clearRangeInputs();
  analyticsModule?.setMetric(activeMetric);
  analyticsModule?.clearFilter();
  renderLegend();
  renderTimeSeries();
});

function applyRangeFilter(): void {
  if (!analyticsModule) return;
  const minRaw = el<HTMLInputElement>("range-min")?.value;
  const maxRaw = el<HTMLInputElement>("range-max")?.value;
  const min = minRaw ? Number(minRaw) : undefined;
  const max = maxRaw ? Number(maxRaw) : undefined;

  if (min === undefined && max === undefined) {
    analyticsModule.clearFilter();
    return;
  }
  analyticsModule.filter({ min, max });
}

el<HTMLInputElement>("range-min")?.addEventListener("input", applyRangeFilter);
el<HTMLInputElement>("range-max")?.addEventListener("input", applyRangeFilter);

el("range-clear")?.addEventListener("click", () => {
  clearRangeInputs();
  analyticsModule?.clearFilter();
});

el("timeseries-toggle")?.addEventListener("click", () => {
  const panel = el("timeseries-panel");
  const toggle = el("timeseries-toggle");
  const nowHidden = panel?.classList.toggle("hidden");
  toggle?.setAttribute("aria-expanded", String(!nowHidden));
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
    showErrorUI("Failed to fetch area analytics");
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
  if (!(viz as any)?.report) {
    setPanelVisible(false);
    showErrorUI("Visualization data expired — re-run the tool");
    return;
  }

  showMapUI();

  map ??= new TomTomMap({
    style: "standardLight",
    mapLibre: { container: "sdk-map", center: [0, 0], zoom: 2 },
  });

  // E2E hook — tiles/hexes are canvas-rendered, not DOM.
  if (!(window as unknown as { __e2e_ml?: unknown }).__e2e_ml) {
    (window as unknown as { __e2e_ml: unknown }).__e2e_ml = map.mapLibreMap;
  }

  currentRequest = viz.request ?? {};

  const normalized = normalizeAreaResponse(viz.report, {
    startDate: currentRequest.startDate,
    endDate: currentRequest.endDate,
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- raw API shape, validated by the SDK parser
  analytics = parseTrafficAreaAnalyticsResponse(normalized as any);

  availableMetrics = analytics.properties.metrics;
  activeMetric = pickMetric(availableMetrics, activeMetric);

  if (!analyticsModule) {
    analyticsModule = await TrafficAreaAnalyticsModule.get(map, {
      displayMode: currentMode,
      activeMetric,
    });
  } else {
    analyticsModule.setMetric(activeMetric);
  }

  if (!hoverBound) {
    analyticsModule.events.on("hover", handleHover);
    map.mapLibreMap.getContainer().addEventListener("mouseleave", hideTooltip);
    hoverBound = true;
  }

  analyticsModule.clearFilter();
  clearRangeInputs();

  await analyticsModule.show(analytics);

  const emptyTiles = !hasTileData(analytics);

  setPanelVisible(true);
  renderHeader(analytics, currentRequest);
  populateModeSelect(currentMode);
  populateMetricSelect(availableMetrics, activeMetric);
  renderLegend();
  renderTimeSeries();
  toggleEmptyState(emptyTiles);

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- bboxFromGeoJSON's HasBBox union doesn't include TrafficAreaAnalytics
    const bbox = bboxFromGeoJSON(analytics as any);
    if (bbox) {
      map.mapLibreMap.fitBounds(bbox, { padding: 40, pitch: 45 });
    }
  } catch (error) {
    console.warn("[area-analytics] Failed to fit map bounds:", error);
  }
};

app.onteardown = async (): Promise<Record<string, never>> => {
  analyticsModule?.setVisible(false);
  return {};
};

async function connectApp(): Promise<void> {
  try {
    await app.connect();
  } catch (error) {
    // Expected when opened standalone (no MCP host) — e.g. local smoke testing.
    console.warn("[area-analytics] Failed to connect to MCP host:", error);
  }
}

void connectApp();
