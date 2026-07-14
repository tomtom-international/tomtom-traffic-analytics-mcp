/*
 * Copyright (C) 2025 TomTom Navigation B.V.
 * Licensed under the Apache License, Version 2.0
 */

import { TomTomMap, CustomGeoJSONModule } from "@tomtom-org/maps-sdk/map";
import { bboxFromGeoJSON } from "@tomtom-org/maps-sdk/core";
import { bootstrapVizApp } from "@shared/app-bootstrap";
import { ratioToColor, renderRampLegend } from "@shared/speed-colors";
import { formatDuration, formatConfidence, NO_VALUE } from "@shared/format";
import { el, escapeHtml, clearAndHide } from "@shared/dom";
import { createFeatureStateSetter } from "@shared/feature-state";
import { initDrawer, initCollapsibleLegend } from "@shared/drawer";
import "@shared/controls";
import "@shared/app-shell.css";
// Bundled so map chrome styling never depends on the CDN link the SDK
// injects at runtime (see resourceRegistry.ts APP_RESOURCE_CSP comment).
import "maplibre-gl/dist/maplibre-gl.css";
import "./styles.css";

// ---------------------------------------------------------------------------
// Types — trimmed app-local mirrors of src/services/route-monitoring/types.ts
// (apps don't import server types).
// ---------------------------------------------------------------------------

interface PathPoint {
  latitude: number;
  longitude: number;
}

interface RouteBasicInfo {
  routeId: number;
  routeName: string;
  routeStatus: string;
  routePathPoints: PathPoint[];
  travelTime?: number;
  typicalTravelTime?: number;
  delayTime?: number;
  passable?: boolean;
  routeLength: number;
  completeness?: number;
}

interface RouteSegment {
  segmentId: number;
  segmentIdStr: string;
  averageSpeed?: number;
  typicalSpeed?: number;
  segmentLength: number;
  currentSpeed?: number;
  relativeSpeed?: number;
  confidence?: number;
  shape?: PathPoint[];
}

interface RouteDetailedInfo extends RouteBasicInfo {
  routeConfidence?: number;
  detailedSegments?: RouteSegment[];
}

/** Payload cached by `tomtom-route-search` or `tomtom-route-monitoring-details`; discriminated on `tool`. */
interface VizPayload {
  tool: string;
  routes: RouteBasicInfo[] | RouteDetailedInfo[];
}

// ---------------------------------------------------------------------------
// GeoJSON feature shapes shown on the "routes" / "segments" sources
// ---------------------------------------------------------------------------

interface RouteFeature {
  type: "Feature";
  id: string;
  geometry: { type: "LineString"; coordinates: [number, number][] };
  properties: { id: string; color: string; impassable: boolean; name: string };
}

interface SegmentFeature {
  type: "Feature";
  id: string;
  geometry: { type: "LineString"; coordinates: [number, number][] };
  properties: { id: string; color: string; routeId: string; segmentId: number };
}

// ---------------------------------------------------------------------------
// Status / delay labels
// ---------------------------------------------------------------------------

const ROUTE_STATUS_LABEL: Record<string, string> = {
  NEW: "New",
  ACTIVE: "Active",
  UPDATING: "Updating",
  FAILED: "Failed",
  ARCHIVED: "Archived",
};

function statusLabel(status: string): string {
  return ROUTE_STATUS_LABEL[status] ?? status;
}

/**
 * Delay severity threshold (seconds) used to color-band the delay badge/text
 * amber vs red. Not specified by the API — a local UX judgement call, mirroring
 * the graduated-severity pattern used elsewhere in the app (LOS bands, ratio colors).
 */
const DELAY_AMBER_MAX_SEC = 300;

function delayClass(delaySeconds: number): "amber" | "red" {
  return delaySeconds <= DELAY_AMBER_MAX_SEC ? "amber" : "red";
}

// ---------------------------------------------------------------------------
// Ratio helpers
// ---------------------------------------------------------------------------

/** relativeSpeed arrives either as a fraction (0.83) or a percent (83) depending on API tier — normalize to fraction. */
function normalizeRelativeSpeed(v: number | null | undefined): number | undefined {
  if (v == null || !Number.isFinite(v)) return undefined;
  return v > 3 ? v / 100 : v;
}

/** Route-level ratio for search mode: typical/actual travel time ≈ relative speed. */
function routeRatio(r: { travelTime?: number; typicalTravelTime?: number }): number | undefined {
  if (!r.travelTime || !r.typicalTravelTime || r.travelTime <= 0) return undefined;
  return Math.min(1, r.typicalTravelTime / r.travelTime);
}

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

function formatKm(meters: number): string {
  return `${(meters / 1000).toFixed(1)} km`;
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let map: TomTomMap | undefined;
let geoModule: CustomGeoJSONModule | undefined;
let routesClickBound = false;
let routesHoverBound = false;
let segmentsClickBound = false;
let segmentsHoverBound = false;

// Which mode last rendered onto the shared `routes` source. Both modes draw onto
// it (search: every route; details: every non-selected route, plus the selected
// route itself when it has no usable segment shapes), so the click handler must
// gate on this to dispatch to the right per-mode selection behavior.
let currentMode: "search" | "details" | null = null;

// Search mode state
let searchRoutes: RouteBasicInfo[] = [];

// Details mode state
let detailsRoutes: RouteDetailedInfo[] = [];
let selectedSegmentId: number | null = null;

// Shared — "the currently active route", regardless of mode (search: the clicked
// row, if any; details: the chip-selected route, always set once data loads).
let selectedRouteId: number | null = null;

// ---------------------------------------------------------------------------
// DOM helpers
// ---------------------------------------------------------------------------

function setPanelVisible(visible: boolean): void {
  el("route-panel")?.classList.toggle("hidden", !visible);
}

// ---------------------------------------------------------------------------
// Geometry helpers
// ---------------------------------------------------------------------------

function pathToLine(points: PathPoint[]): [number, number][] {
  return points.map((p) => [p.longitude, p.latitude]);
}

function hasUsableShape(seg: RouteSegment): boolean {
  return (seg.shape?.length ?? 0) >= 2;
}

function buildRouteFeature(route: RouteBasicInfo): RouteFeature | null {
  if (route.routePathPoints.length < 2) return null;
  const id = String(route.routeId);
  return {
    type: "Feature",
    id,
    geometry: { type: "LineString", coordinates: pathToLine(route.routePathPoints) },
    properties: {
      id,
      color: ratioToColor(routeRatio(route)),
      impassable: route.passable === false,
      name: route.routeName,
    },
  };
}

function buildSegmentFeature(routeId: number, seg: RouteSegment): SegmentFeature | null {
  if (!hasUsableShape(seg)) return null;
  const id = `${routeId}:${seg.segmentId}`;
  return {
    type: "Feature",
    id,
    // hasUsableShape guarantees seg.shape is present with >=2 points.
    geometry: { type: "LineString", coordinates: pathToLine(seg.shape as PathPoint[]) },
    properties: {
      id,
      color: ratioToColor(normalizeRelativeSpeed(seg.relativeSpeed)),
      routeId: String(routeId),
      segmentId: seg.segmentId,
    },
  };
}

function parseRouteFeatureId(id: string | number | undefined): number | null {
  if (id === undefined) return null;
  const n = Number(id);
  return Number.isFinite(n) ? n : null;
}

function parseSegmentFeatureId(
  id: string | number | undefined
): { routeId: number; segmentId: number } | null {
  if (id === undefined) return null;
  const str = String(id);
  const sep = str.indexOf(":");
  if (sep === -1) return null;
  const routeId = Number(str.slice(0, sep));
  const segmentId = Number(str.slice(sep + 1));
  if (!Number.isFinite(routeId) || !Number.isFinite(segmentId)) return null;
  return { routeId, segmentId };
}

// ---------------------------------------------------------------------------
// Feature-state helper — shared tracker; at most one feature per
// (source, state) pair is ever flagged.
// ---------------------------------------------------------------------------

type StateSource = "routes" | "segments";
type StateName = "hover" | "selected";

const setFeatureStateRaw = createFeatureStateSetter(() => ({ map, geoModule }));

function setState(source: StateSource, id: string | number | null, state: StateName): void {
  setFeatureStateRaw(source, id, state);
}

// ---------------------------------------------------------------------------
// Search mode
// ---------------------------------------------------------------------------

function highlightRouteItem(id: number | null): void {
  const list = el("panel-list");
  if (!list) return;
  for (const item of Array.from(list.querySelectorAll<HTMLElement>(".route-item"))) {
    item.classList.toggle("selected", Number(item.getAttribute("data-id")) === id);
  }
}

function syncRouteItemHover(id: number | null): void {
  const list = el("panel-list");
  if (!list) return;
  for (const item of Array.from(list.querySelectorAll<HTMLElement>(".route-item"))) {
    item.classList.toggle("hover", Number(item.getAttribute("data-id")) === id);
  }
}

function renderRouteItem(route: RouteBasicInfo): HTMLElement {
  const item = document.createElement("button");
  item.type = "button";
  item.className = "route-item" + (route.routeId === selectedRouteId ? " selected" : "");
  item.setAttribute("data-id", String(route.routeId));

  const delay = route.delayTime;
  const delayHtml =
    delay != null && delay > 0
      ? `<span class="metric"><span class="tta-tag--label">Delay</span> <span class="tta-tag tta-tag--${delayClass(delay)}">+${escapeHtml(formatDuration(delay))}</span></span>`
      : "";
  const travelTimeHtml =
    route.travelTime != null
      ? `<span class="metric"><span class="tta-tag--label">Travel time</span> ${escapeHtml(formatDuration(route.travelTime))}</span>`
      : "";
  const impassableHtml =
    route.passable === false
      ? `<span class="tta-tag tta-tag--solid tta-tag--danger">Impassable</span>`
      : "";

  item.innerHTML = `
    <div class="route-item-header">
      <span class="route-item-name">${escapeHtml(route.routeName)}</span>
      <span class="tta-tag tta-tag--dot"><span class="tta-tag__dot"></span>${escapeHtml(statusLabel(route.routeStatus))}</span>
    </div>
    <div class="route-item-id">ID ${Number(route.routeId)}</div>
    <div class="route-item-row">
      <span class="metric"><span class="tta-tag--label">Length</span> ${formatKm(route.routeLength)}</span>
      ${travelTimeHtml}
      ${delayHtml}
      ${impassableHtml}
    </div>
  `;
  item.addEventListener("click", () => selectSearchRoute(route.routeId));
  item.addEventListener("mouseenter", () => setState("routes", route.routeId, "hover"));
  item.addEventListener("mouseleave", () => setState("routes", null, "hover"));
  return item;
}

function renderRouteList(routes: RouteBasicInfo[]): void {
  const list = el("panel-list");
  const empty = el("empty-state");
  if (!list || !empty) return;

  list.innerHTML = "";

  if (routes.length === 0) {
    empty.classList.remove("hidden");
    return;
  }
  empty.classList.add("hidden");

  for (const route of routes) {
    list.appendChild(renderRouteItem(route));
  }
}

function selectSearchRoute(routeId: number): void {
  selectedRouteId = routeId;
  highlightRouteItem(routeId);
  setState("routes", routeId, "selected");

  const route = searchRoutes.find((r) => r.routeId === routeId);
  const feature = route ? buildRouteFeature(route) : null;
  if (feature && map) {
    const bbox = bboxFromGeoJSON({ type: "FeatureCollection" as const, features: [feature] });
    if (bbox) map.mapLibreMap.fitBounds(bbox, { padding: 80, maxZoom: 16 });
  }
}

function renderSearchMode(routes: RouteBasicInfo[]): void {
  searchRoutes = routes;

  const features = routes.map(buildRouteFeature).filter((f): f is RouteFeature => f !== null);
  const fc = { type: "FeatureCollection" as const, features };
  void geoModule?.show(fc, "routes");
  void geoModule?.clear("segments");

  renderRouteList(routes);

  const bbox = bboxFromGeoJSON(fc);
  if (bbox && map) {
    map.mapLibreMap.fitBounds(bbox, { padding: 60 });
  }

  const legendEl = el("legend");
  if (legendEl) {
    renderRampLegend(legendEl, "Travel time vs typical");
    legendEl.classList.remove("hidden");
    initCollapsibleLegend("legend", legendMql);
  }
}

// ---------------------------------------------------------------------------
// Details mode
// ---------------------------------------------------------------------------

function renderRouteChips(routes: RouteDetailedInfo[]): void {
  const container = el("route-chips");
  if (!container) return;

  container.innerHTML = "";

  if (routes.length <= 1) {
    container.classList.add("hidden");
    return;
  }

  container.classList.remove("hidden");
  for (const route of routes) {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "tta-chip" + (route.routeId === selectedRouteId ? " active" : "");
    chip.textContent = route.routeName || `Route ${route.routeId}`;
    chip.addEventListener("click", () => selectDetailsRoute(route.routeId));
    container.appendChild(chip);
  }
}

function renderRouteStats(route: RouteDetailedInfo | undefined): void {
  const container = el("route-stats");
  if (!container) return;

  if (!route) {
    container.innerHTML = "";
    container.classList.add("hidden");
    return;
  }
  container.classList.remove("hidden");

  const delay = route.delayTime;
  const delayModifier = delay != null && delay > 0 ? ` tta-tag--${delayClass(delay)}` : "";
  const delayText = delay == null ? NO_VALUE : delay > 0 ? `+${formatDuration(delay)}` : "None";

  const passableBadge =
    route.passable === false
      ? `<span class="tta-tag tta-tag--solid tta-tag--danger">Impassable</span>`
      : `<span class="tta-tag tta-tag--solid tta-tag--muted">Passable</span>`;

  container.innerHTML = `
    <div class="route-stats-header">
      <span class="route-stats-name">${escapeHtml(route.routeName)}</span>
      <span class="tta-tag tta-tag--dot"><span class="tta-tag__dot"></span>${escapeHtml(statusLabel(route.routeStatus))}</span>
    </div>
    <div class="route-stats-grid">
      <span class="stats-label">Travel time now</span><span>${escapeHtml(formatDuration(route.travelTime))}</span>
      <span class="stats-label">Typical travel time</span><span>${escapeHtml(formatDuration(route.typicalTravelTime))}</span>
      <span class="stats-label">Delay vs typical</span><span class="tta-tag${delayModifier}">${escapeHtml(delayText)}</span>
      <span class="stats-label">Length</span><span>${formatKm(route.routeLength)}</span>
      <span class="stats-label" title="How much of the route is covered by live traffic measurements">Data confidence</span><span>${escapeHtml(formatConfidence(route.routeConfidence))}</span>
      <span class="stats-label">Status</span>${passableBadge}
    </div>
  `;
}

function highlightSegmentRow(segmentId: number | null, scrollIntoView: boolean): void {
  const list = el("panel-list");
  if (!list) return;
  for (const row of Array.from(list.querySelectorAll<HTMLElement>(".segment-row"))) {
    const isMatch = Number(row.getAttribute("data-segment-id")) === segmentId;
    row.classList.toggle("selected", isMatch);
  }
  if (scrollIntoView && segmentId !== null) {
    list
      .querySelector<HTMLElement>(`.segment-row[data-segment-id="${segmentId}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }
}

function syncSegmentRowHover(segmentId: number | null): void {
  const list = el("panel-list");
  if (!list) return;
  for (const row of Array.from(list.querySelectorAll<HTMLElement>(".segment-row"))) {
    const isMatch = Number(row.getAttribute("data-segment-id")) === segmentId;
    row.classList.toggle("hover", isMatch);
    if (isMatch) row.scrollIntoView({ block: "nearest" });
  }
}

function selectSegment(routeId: number, segmentId: number): void {
  selectedSegmentId = segmentId;
  setState("segments", `${routeId}:${segmentId}`, "selected");
  highlightSegmentRow(segmentId, false);
}

function renderSegmentTable(route: RouteDetailedInfo | undefined): void {
  const list = el("panel-list");
  if (!list) return;
  list.innerHTML = "";

  const segments = route?.detailedSegments ?? [];
  if (segments.length === 0) {
    const empty = document.createElement("div");
    empty.className = "segment-table-empty";
    empty.textContent = "No segment data";
    list.appendChild(empty);
    return;
  }

  const table = document.createElement("table");
  table.className = "segment-table";
  table.innerHTML = `
    <thead>
      <tr>
        <th title="Segment number along the route">#</th>
        <th>Length</th>
        <th title="Current speed / typical speed for this time of day">Speed km/h<br />now / typical</th>
        <th title="Current speed as a percentage of typical — lower means slower than usual">% of<br />typical</th>
      </tr>
    </thead>
    <tbody></tbody>
  `;
  const tbody = table.querySelector("tbody");
  if (!tbody) return;

  segments.forEach((seg, idx) => {
    const row = document.createElement("tr");
    row.className = "segment-row" + (seg.segmentId === selectedSegmentId ? " selected" : "");
    row.setAttribute("data-segment-id", String(seg.segmentId));

    const ratio = normalizeRelativeSpeed(seg.relativeSpeed);
    const ratioText = ratio != null ? `${Math.round(ratio * 100)}%` : NO_VALUE;
    const dotColor = ratioToColor(ratio);
    const currentSpeed = seg.currentSpeed != null ? `${Math.round(seg.currentSpeed)}` : NO_VALUE;
    const typicalSpeed = seg.typicalSpeed != null ? `${Math.round(seg.typicalSpeed)}` : NO_VALUE;

    row.innerHTML = `
      <td>${idx + 1}</td>
      <td>${Math.round(seg.segmentLength)} m</td>
      <td>${currentSpeed} / ${typicalSpeed}</td>
      <td><span class="ratio-dot" style="background:${dotColor}"></span>${ratioText}</td>
    `;

    if (route) {
      const featureId = `${route.routeId}:${seg.segmentId}`;
      row.addEventListener("mouseenter", () => {
        row.classList.add("hover");
        setState("segments", featureId, "hover");
      });
      row.addEventListener("mouseleave", () => {
        row.classList.remove("hover");
        setState("segments", null, "hover");
      });
      row.addEventListener("click", () => selectSegment(route.routeId, seg.segmentId));
    }

    tbody.appendChild(row);
  });

  list.appendChild(table);
}

function renderDetailsMap(route: RouteDetailedInfo | undefined): void {
  if (!geoModule) return;

  const others = detailsRoutes.filter((r) => r.routeId !== selectedRouteId);
  const otherFeatures = others.map(buildRouteFeature).filter((f): f is RouteFeature => f !== null);

  const usableSegments = (route?.detailedSegments ?? []).filter(hasUsableShape);

  let focusFeatures: Array<RouteFeature | SegmentFeature> = [];

  if (route && usableSegments.length > 0) {
    const segFeatures = usableSegments
      .map((seg) => buildSegmentFeature(route.routeId, seg))
      .filter((f): f is SegmentFeature => f !== null);
    void geoModule.show({ type: "FeatureCollection" as const, features: segFeatures }, "segments");
    void geoModule.show({ type: "FeatureCollection" as const, features: otherFeatures }, "routes");
    setState("routes", null, "selected");
    focusFeatures = segFeatures;
  } else {
    const routeFeatures = [...otherFeatures];
    const selfFeature = route ? buildRouteFeature(route) : null;
    if (selfFeature) routeFeatures.push(selfFeature);
    void geoModule.show({ type: "FeatureCollection" as const, features: [] }, "segments");
    void geoModule.show({ type: "FeatureCollection" as const, features: routeFeatures }, "routes");
    setState("routes", route ? route.routeId : null, "selected");
    focusFeatures = selfFeature ? [selfFeature] : [];
  }

  if (map && focusFeatures.length > 0) {
    const bbox = bboxFromGeoJSON({ type: "FeatureCollection" as const, features: focusFeatures });
    if (bbox) map.mapLibreMap.fitBounds(bbox, { padding: 80, maxZoom: 16 });
  }
}

function selectDetailsRoute(routeId: number): void {
  selectedRouteId = routeId;
  renderRouteChips(detailsRoutes);

  selectedSegmentId = null;
  setState("routes", null, "hover");
  setState("segments", null, "selected");
  setState("segments", null, "hover");

  const route = detailsRoutes.find((r) => r.routeId === routeId);
  renderDetailsMap(route);
  renderRouteStats(route);
  renderSegmentTable(route);
}

function renderDetailsMode(routes: RouteDetailedInfo[]): void {
  detailsRoutes = routes;

  const legendEl = el("legend");
  if (legendEl) {
    renderRampLegend(legendEl, "Current vs typical speed");
    legendEl.classList.remove("hidden");
    initCollapsibleLegend("legend", legendMql);
  }

  if (routes.length === 0) {
    renderRouteChips(routes);
    const list = el("panel-list");
    if (list) list.innerHTML = "";
    el("empty-state")?.classList.remove("hidden");
    el("route-stats")?.classList.add("hidden");
    return;
  }
  el("empty-state")?.classList.add("hidden");

  selectDetailsRoute(routes[0].routeId);
}

// ---------------------------------------------------------------------------
// Mode-switch reset — ensures search-mode UI (route list) and details-mode UI
// (chips/stats/segment table/legend) never bleed into each other across
// repeated tool calls.
// ---------------------------------------------------------------------------

async function resetPanelState(): Promise<void> {
  // Clear MapLibre feature-state via the setters BEFORE clearing sources.
  // CustomGeoJSONModule.clear() only calls setData() — feature-state lives in a
  // separate MapLibre store keyed by (source, id) and survives setData(), so stale
  // selected/hover flags would otherwise reapply to whatever feature reuses a
  // tracked id (route/segment ids are small integers reused across tool calls and
  // shared between search/details modes) after the reset.
  setState("routes", null, "selected");
  setState("routes", null, "hover");
  setState("segments", null, "selected");
  setState("segments", null, "hover");

  await geoModule?.clear();

  clearAndHide("route-chips");
  clearAndHide("route-stats");
  clearAndHide("legend");
  const list = el("panel-list");
  if (list) list.innerHTML = "";
  el("empty-state")?.classList.add("hidden");

  searchRoutes = [];
  detailsRoutes = [];
  selectedRouteId = null;
  selectedSegmentId = null;
}

// ---------------------------------------------------------------------------
// MCP App lifecycle — shared bootstrap owns parse/gates/map creation.
// ---------------------------------------------------------------------------

bootstrapVizApp<VizPayload>({
  name: "tta-route-details",
  panelId: "route-panel",
  errorMessage: "Failed to fetch route data",
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- viz shape is unverified after a cache-miss fallback
  validate: (viz): viz is VizPayload => Array.isArray((viz as any)?.routes),
  render: async ({ map: m, viz }) => {
    map = m;

    geoModule ??= await CustomGeoJSONModule.get(map, {
      sources: {
        routes: {
          layers: [
            {
              id: "route-details-routes-casing",
              type: "line",
              layout: { "line-join": "round", "line-cap": "round" },
              paint: {
                "line-color": "#ffffff",
                "line-width": [
                  "case",
                  ["boolean", ["feature-state", "selected"], false],
                  9,
                  ["boolean", ["feature-state", "hover"], false],
                  8,
                  7,
                ],
              },
            },
            {
              id: "route-details-routes-line",
              type: "line",
              filter: ["!=", ["get", "impassable"], true],
              layout: { "line-join": "round", "line-cap": "round" },
              paint: {
                "line-color": ["get", "color"],
                "line-width": [
                  "case",
                  ["boolean", ["feature-state", "selected"], false],
                  6,
                  ["boolean", ["feature-state", "hover"], false],
                  5,
                  4,
                ],
              },
            },
            {
              id: "route-details-routes-impassable",
              type: "line",
              filter: ["==", ["get", "impassable"], true],
              layout: { "line-join": "round", "line-cap": "round" },
              paint: { "line-color": "#e03030", "line-width": 4, "line-dasharray": [2, 1.5] },
            },
          ],
        },
        segments: {
          layers: [
            {
              id: "route-details-segments-casing",
              type: "line",
              layout: { "line-join": "round", "line-cap": "round" },
              paint: {
                "line-color": "#ffffff",
                "line-width": [
                  "case",
                  ["boolean", ["feature-state", "selected"], false],
                  10,
                  ["boolean", ["feature-state", "hover"], false],
                  9,
                  7,
                ],
              },
            },
            {
              id: "route-details-segments-line",
              type: "line",
              layout: { "line-join": "round", "line-cap": "round" },
              paint: {
                "line-color": ["get", "color"],
                "line-width": [
                  "case",
                  ["boolean", ["feature-state", "selected"], false],
                  7,
                  ["boolean", ["feature-state", "hover"], false],
                  6,
                  4.5,
                ],
              },
            },
          ],
        },
      },
    });

    if (!routesClickBound) {
      geoModule.events.routes.on("click", (f) => {
        const routeId = parseRouteFeatureId(f.id);
        if (routeId === null) return;
        if (currentMode === "search") {
          selectSearchRoute(routeId);
        } else if (currentMode === "details") {
          selectDetailsRoute(routeId);
        }
      });
      routesClickBound = true;
    }
    if (!routesHoverBound) {
      geoModule.events.routes.on("hover", (f) => {
        const routeId = parseRouteFeatureId(f?.id);
        setState("routes", routeId, "hover");
        if (currentMode === "search") syncRouteItemHover(routeId);
      });
      routesHoverBound = true;
    }
    if (!segmentsClickBound) {
      geoModule.events.segments.on("click", (f) => {
        if (currentMode !== "details") return;
        const parsed = parseSegmentFeatureId(f.id);
        if (parsed) selectSegment(parsed.routeId, parsed.segmentId);
      });
      segmentsClickBound = true;
    }
    if (!segmentsHoverBound) {
      geoModule.events.segments.on("hover", (f) => {
        if (currentMode !== "details") return;
        const parsed = parseSegmentFeatureId(f?.id);
        setState("segments", parsed ? `${parsed.routeId}:${parsed.segmentId}` : null, "hover");
        syncSegmentRowHover(parsed ? parsed.segmentId : null);
      });
      segmentsHoverBound = true;
    }

    await resetPanelState();
    setPanelVisible(true);

    const mode = viz.tool === "tomtom-route-monitoring-details" ? "details" : "search";
    currentMode = mode;
    if (mode === "details") {
      renderDetailsMode(viz.routes as RouteDetailedInfo[]);
    } else {
      renderSearchMode(viz.routes as RouteBasicInfo[]);
    }
  },
  teardown: () => {
    geoModule?.setVisible(false);
  },
});

// renderSearchMode/renderDetailsMode (declared above) close over this — safe:
// they only ever run from the async `bootstrapVizApp` render callback, which
// fires well after this module-scope const has initialized.
const legendMql = initDrawer({
  asideId: "route-panel",
  getMap: () => map,
  handleLabel: "Routes",
}).mql;
