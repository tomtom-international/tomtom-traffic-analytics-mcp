/*
 * Copyright (C) 2025 TomTom Navigation B.V.
 * Licensed under the Apache License, Version 2.0
 */

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
import { bootstrapVizApp } from "@shared/app-bootstrap";
import { normalizeAreaResponse } from "@shared/geo";
import { computeBarLayout } from "@shared/chart-layout";
import { el } from "@shared/dom";
import { gradientCss } from "@shared/speed-colors";
import "@shared/controls";
// Bundled so map chrome styling never depends on the CDN link the SDK
// injects at runtime (see resourceRegistry.ts APP_RESOURCE_CSP comment).
import "maplibre-gl/dist/maplibre-gl.css";
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
  // `stop.value` scale depends on the resolved config: preset themes (e.g. "trafficLight")
  // resolve to 0–1 fractions, but the module's *own* getConfig() returns each metric's
  // fully-resolved AreaAnalyticsColorStopsConfig, whose `stops` carry whatever domain the
  // valueType implies (0–100 for the *PCT variants, raw metric units for "raw"). Normalizing
  // by the stop array's own min/max — instead of assuming a fixed 0–1 scale — keeps the
  // gradient correct regardless of which shape resolveColorStops() handed back.
  const gradient = gradientCss(stops);

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

/** Entry timestamp as milliseconds, or `NaN` when `date` is missing/invalid. */
function entryTime(entry: AreaAnalyticsTimedEntry): number {
  if (!entry.date) return NaN;
  const date = entry.date instanceof Date ? entry.date : new Date(entry.date);
  return date.getTime();
}

/** Full label for the native SVG `<title>` hover tooltip. */
function formatTimeLabel(entry: AreaAnalyticsTimedEntry): string {
  const t = entryTime(entry);
  if (Number.isNaN(t)) return "";
  const day = new Date(t).toISOString().slice(0, 10);
  return entry.hour !== undefined ? `${day} ${entry.hour}:00` : day;
}

/** Compact axis label rendered under each bar — day-of-month for daily series, hour for hourly. */
function formatAxisLabel(entry: AreaAnalyticsTimedEntry): string {
  const t = entryTime(entry);
  if (entry.hour !== undefined) return `${entry.hour}h`;
  if (Number.isNaN(t)) return "";
  const date = new Date(t);
  return `${String(date.getUTCMonth() + 1).padStart(2, "0")}/${String(date.getUTCDate()).padStart(2, "0")}`;
}

function renderTimeSeries(): void {
  const chart = el("timeseries-chart");
  if (!chart) return;

  const feature = analytics?.features[0];
  const daily = feature?.properties.timedData.daily;
  const series = [...(daily?.length ? daily : (feature?.properties.timedData.hourly ?? []))];

  if (series.length === 0) {
    chart.innerHTML = `<div class="state-panel timeseries-empty">No time-series data for this metric</div>`;
    return;
  }

  // Entries should already arrive in chronological order, but sort defensively — the
  // API's `days` can be a sparse/non-consecutive list, and nothing here guarantees order.
  series.sort((a, b) => {
    const byTime = entryTime(a) - entryTime(b);
    if (byTime !== 0) return byTime;
    return (a.hour ?? 0) - (b.hour ?? 0);
  });

  const values = series.map((entry) => entry[activeMetric]);
  const finiteValues = values.filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  const max = Math.max(...finiteValues, 0.0001);

  const width = 320;
  const height = 130;
  const topPad = 16; // room for the value label above the tallest bar
  const bottomPad = 20; // room for the axis label below each bar
  const barAreaHeight = height - topPad - bottomPad;
  const { barWidth, barGap } = computeBarLayout(values.length, width, 4);

  // Thin axis labels when there are too many bars for them to stay legible.
  const maxLabels = 8;
  const labelStep = Math.max(1, Math.ceil(series.length / maxLabels));

  const bars = values
    .map((value, i) => {
      const x = i * (barWidth + barGap);
      const hasValue = typeof value === "number" && Number.isFinite(value);
      const barHeight = hasValue ? Math.max(2, (value / max) * barAreaHeight) : 2;
      const y = height - bottomPad - barHeight;
      const tooltipLabel = formatTimeLabel(series[i]);
      const valueText = hasValue ? formatMetricValue(activeMetric, value) : "No data";
      const showLabel = i % labelStep === 0 || i === series.length - 1;
      const axisLabel = showLabel ? formatAxisLabel(series[i]) : "";
      const valueLabel = hasValue && showLabel ? formatMetricValue(activeMetric, value) : "";
      const barClass = hasValue ? "timeseries-bar" : "timeseries-bar timeseries-bar-empty";
      const cx = (x + barWidth / 2).toFixed(1);

      return `<g>
        <rect class="${barClass}" x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barWidth.toFixed(1)}" height="${barHeight.toFixed(1)}" rx="1.5"><title>${tooltipLabel}: ${valueText}</title></rect>
        ${valueLabel ? `<text class="timeseries-value-label" x="${cx}" y="${(y - 4).toFixed(1)}" text-anchor="middle">${valueLabel}</text>` : ""}
        ${axisLabel ? `<text class="timeseries-axis-label" x="${cx}" y="${height - 6}" text-anchor="middle">${axisLabel}</text>` : ""}
      </g>`;
    })
    .join("");

  chart.innerHTML = `
    <svg viewBox="0 0 ${width} ${height}" width="100%" height="${height}" preserveAspectRatio="xMidYMid meet" role="img" aria-label="${METRIC_LABEL[activeMetric]} time series">
      <line class="timeseries-baseline" x1="0" y1="${height - bottomPad}" x2="${width}" y2="${height - bottomPad}" />
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
// MCP App lifecycle — shared bootstrap owns parse/gates/map creation.
// ---------------------------------------------------------------------------

bootstrapVizApp<VizPayload>({
  name: "tta-area-analytics",
  panelId: "analytics-panel",
  errorMessage: "Failed to fetch area analytics",
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- viz shape is unverified after a cache-miss fallback
  validate: (viz): viz is VizPayload => Boolean((viz as any)?.report),
  resetUI: hideTooltip, // panel hide previously also hid the tile tooltip
  render: async ({ map: m, viz }) => {
    map = m;

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
  },
  teardown: () => {
    analyticsModule?.setVisible(false);
  },
});
