/*
 * Copyright (C) 2025 TomTom Navigation B.V.
 * Licensed under the Apache License, Version 2.0
 */

import type { App } from "@modelcontextprotocol/ext-apps";
import { TomTomMap, CustomGeoJSONModule } from "@tomtom-org/maps-sdk/map";
import { bboxFromGeoJSON } from "@tomtom-org/maps-sdk/core";
import { bootstrapVizApp } from "@shared/app-bootstrap";
import { ratioToColor, renderRampLegend } from "@shared/speed-colors";
import { formatDuration, formatConfidence, NO_VALUE } from "@shared/format";
import { el, escapeHtml, clearAndHide } from "@shared/dom";
import { createFeatureStateSetter } from "@shared/feature-state";
import { initDrawer, initCollapsibleLegend } from "@shared/drawer";
import { fetchRouteDetails } from "./fetch-route-details";
import { computeSegmentStripLayout } from "./segment-strip-layout";
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
let appRef: App | undefined;
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
    <span class="route-item-status hidden">Loading&hellip;</span>
    <span class="route-load-error hidden" role="alert"></span>
  `;
  item.addEventListener("click", () => beginRouteDetailsLoad(route.routeId));
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
// Search → details click-through — a row click or a map route-line click both
// load full details for that one route and switch into details mode.
// ---------------------------------------------------------------------------

function setBackButtonVisible(visible: boolean): void {
  el("details-back")?.classList.toggle("hidden", !visible);
}

// Request-generation counter for loadRouteDetails. Stale resolutions must not
// mutate UI: if the user picks another route (new beginRouteDetailsLoad call)
// or a new tool result re-renders the app (resetPanelState) while a fetch is
// in flight, the old promise still settles — bumping the counter makes it a
// no-op.
let routeLoadSeq = 0;

function beginRouteDetailsLoad(routeId: number): void {
  selectSearchRoute(routeId);
  const route = searchRoutes.find((r) => r.routeId === routeId);
  if (!route) return;
  const item =
    el("panel-list")?.querySelector<HTMLButtonElement>(`.route-item[data-id="${routeId}"]`) ?? null;
  void loadRouteDetails(route, item);
}

async function loadRouteDetails(
  route: RouteBasicInfo,
  item: HTMLButtonElement | null
): Promise<void> {
  if (!appRef) return;
  const seq = ++routeLoadSeq;
  const statusEl = item?.querySelector<HTMLElement>(".route-item-status");
  const errEl = item?.querySelector<HTMLElement>(".route-load-error");
  if (item) item.disabled = true;
  statusEl?.classList.remove("hidden");
  errEl?.classList.add("hidden");
  try {
    const details = (await fetchRouteDetails(appRef, [route.routeId])) as RouteDetailedInfo[];
    if (seq !== routeLoadSeq) return; // superseded while awaiting — drop silently
    if (details.length === 0) throw new Error("No route details returned");
    // The details fetch already returns routePathPoints, but fall back to the
    // search geometry defensively if it's ever missing.
    for (const d of details) {
      if (d.routePathPoints.length === 0) {
        d.routePathPoints =
          searchRoutes.find((s) => s.routeId === d.routeId)?.routePathPoints ?? [];
      }
    }
    enterDetailsFromSearch(details);
  } catch (error) {
    if (seq !== routeLoadSeq) return; // superseded — the newer UI owns item/statusEl/errEl now
    console.error("[tta-route-details] Failed to load route details:", error);
    statusEl?.classList.add("hidden");
    if (errEl) {
      errEl.textContent = "Failed to load details — try again.";
      errEl.classList.remove("hidden");
    }
    if (item) item.disabled = false;
  }
}

function enterDetailsFromSearch(routes: RouteDetailedInfo[]): void {
  currentMode = "details";
  setState("routes", null, "hover"); // clear any search-row hover left over from the click
  setBackButtonVisible(true);
  renderDetailsMode(routes);
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
  container.classList.add("tta-switcher");

  const heading = document.createElement("div");
  heading.className = "tta-switcher-heading";
  heading.textContent = `Routes (${routes.length})`;
  container.appendChild(heading);

  for (const route of routes) {
    const row = document.createElement("button");
    row.type = "button";
    row.className = "tta-switcher-item" + (route.routeId === selectedRouteId ? " active" : "");
    row.setAttribute("data-id", String(route.routeId));
    row.innerHTML = `
      <span class="tta-switcher-item-name">${escapeHtml(route.routeName || `Route ${route.routeId}`)}</span>
      <span class="tta-switcher-item-id">ID ${Number(route.routeId)}</span>
    `;
    row.addEventListener("click", () => selectDetailsRoute(route.routeId));
    container.appendChild(row);
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

function highlightSegmentBar(segmentId: number | null): void {
  const list = el("panel-list");
  if (!list) return;
  for (const bar of Array.from(list.querySelectorAll<HTMLElement>(".segment-bar"))) {
    bar.classList.toggle("selected", Number(bar.getAttribute("data-segment-id")) === segmentId);
  }
}

function syncSegmentBarHover(segmentId: number | null): void {
  const list = el("panel-list");
  if (!list) return;
  for (const bar of Array.from(list.querySelectorAll<HTMLElement>(".segment-bar"))) {
    bar.classList.toggle("hover", Number(bar.getAttribute("data-segment-id")) === segmentId);
  }
}

function selectSegment(routeId: number, segmentId: number): void {
  selectedSegmentId = segmentId;
  setState("segments", `${routeId}:${segmentId}`, "selected");
  highlightSegmentBar(segmentId);
}

/** Multi-metric readout for the floating `.segment-tooltip` — mirrors area-analytics' `.tile-tooltip` rows. */
function renderSegmentTooltipContent(seg: RouteSegment, idx: number, total: number): string {
  const ratio = normalizeRelativeSpeed(seg.relativeSpeed);
  const pctText = ratio != null ? `${Math.round(ratio * 100)}%` : NO_VALUE;
  const currentSpeed = seg.currentSpeed != null ? `${Math.round(seg.currentSpeed)} km/h` : NO_VALUE;
  const typicalSpeed = seg.typicalSpeed != null ? `${Math.round(seg.typicalSpeed)} km/h` : NO_VALUE;
  const averageRow =
    seg.averageSpeed != null
      ? `<div class="tooltip-row"><span>Average speed</span><span>${Math.round(seg.averageSpeed)} km/h</span></div>`
      : "";
  const confidenceRow =
    seg.confidence != null
      ? `<div class="tooltip-row"><span>Confidence</span><span>${escapeHtml(formatConfidence(seg.confidence))}</span></div>`
      : "";

  return `
    <div class="tooltip-row"><span>Segment</span><span>#${idx + 1} of ${total}</span></div>
    <div class="tooltip-row"><span>Speed now</span><span>${currentSpeed}</span></div>
    <div class="tooltip-row"><span>Typical speed</span><span>${typicalSpeed}</span></div>
    ${averageRow}
    <div class="tooltip-row"><span>% of typical</span><span>${pctText}</span></div>
    <div class="tooltip-row"><span>Length</span><span>${Math.round(seg.segmentLength)} m</span></div>
    ${confidenceRow}
  `;
}

/** Positions the floating tooltip at the cursor, relative to its offset parent (`.segment-strip-wrap`). */
function positionSegmentTooltip(wrap: HTMLElement, tooltip: HTMLElement, event: MouseEvent): void {
  const rect = wrap.getBoundingClientRect();
  tooltip.style.left = `${event.clientX - rect.left}px`;
  tooltip.style.top = `${event.clientY - rect.top}px`;
}

/**
 * Horizontal speed-profile strip — one SVG bar per segment, width proportional
 * to segment length (via `computeSegmentStripLayout`), colored by the same
 * green→amber→red ramp as the map segment line. Replaces the old per-segment
 * table (unbounded row count for a multi-km route); a native `<title>` gives a
 * baseline tooltip and a floating `.segment-tooltip` panel shows the full
 * multi-metric readout. Both directions of map linkage are preserved: bars
 * dispatch `setState`/`selectSegment` same as the table rows did, and
 * `syncSegmentBarHover`/`highlightSegmentBar` (used by the map hover/select
 * handlers) target `.segment-bar[data-segment-id]` instead of `.segment-row`.
 */
function renderSegmentStrip(route: RouteDetailedInfo | undefined): void {
  const list = el("panel-list");
  if (!list) return;
  list.innerHTML = "";

  const segments = route?.detailedSegments ?? [];
  if (segments.length === 0) {
    const empty = document.createElement("div");
    empty.className = "segment-strip-empty";
    empty.textContent = "No segment data";
    list.appendChild(empty);
    return;
  }

  const width = 320;
  const height = 40;
  const positions = computeSegmentStripLayout(segments, width);

  const bars = segments
    .map((seg, idx) => {
      const pos = positions[idx];
      const ratio = normalizeRelativeSpeed(seg.relativeSpeed);
      const color = ratioToColor(ratio);
      const currentSpeed = seg.currentSpeed != null ? `${Math.round(seg.currentSpeed)}` : NO_VALUE;
      const typicalSpeed = seg.typicalSpeed != null ? `${Math.round(seg.typicalSpeed)}` : NO_VALUE;
      const pctText = ratio != null ? `${Math.round(ratio * 100)}%` : NO_VALUE;
      const selectedClass = seg.segmentId === selectedSegmentId ? " selected" : "";
      const title = escapeHtml(`#${idx + 1} · ${currentSpeed}/${typicalSpeed} km/h · ${pctText}`);
      return `<rect class="segment-bar${selectedClass}" data-segment-id="${seg.segmentId}" x="${pos.x.toFixed(2)}" y="0" width="${pos.width.toFixed(2)}" height="${height}" fill="${color}"><title>${title}</title></rect>`;
    })
    .join("");

  const wrap = document.createElement("div");
  wrap.className = "segment-strip-wrap";
  wrap.innerHTML = `
    <div class="segment-strip-caption">${segments.length} segment${segments.length === 1 ? "" : "s"}</div>
    <svg class="segment-strip" viewBox="0 0 ${width} ${height}" width="100%" height="${height}" preserveAspectRatio="none" role="img" aria-label="Speed profile along the route">
      ${bars}
    </svg>
    <div class="segment-tooltip hidden"></div>
  `;
  list.appendChild(wrap);

  if (!route) return;

  const tooltip = wrap.querySelector<HTMLElement>(".segment-tooltip");
  const barEls = Array.from(wrap.querySelectorAll<HTMLElement>(".segment-bar"));

  segments.forEach((seg, idx) => {
    const barEl = barEls[idx];
    if (!barEl) return;
    const featureId = `${route.routeId}:${seg.segmentId}`;

    barEl.addEventListener("mouseenter", (event) => {
      barEl.classList.add("hover");
      setState("segments", featureId, "hover");
      if (tooltip) {
        tooltip.innerHTML = renderSegmentTooltipContent(seg, idx, segments.length);
        tooltip.classList.remove("hidden");
        positionSegmentTooltip(wrap, tooltip, event);
      }
    });
    barEl.addEventListener("mousemove", (event) => {
      if (tooltip && !tooltip.classList.contains("hidden"))
        positionSegmentTooltip(wrap, tooltip, event);
    });
    barEl.addEventListener("mouseleave", () => {
      barEl.classList.remove("hover");
      setState("segments", null, "hover");
      tooltip?.classList.add("hidden");
    });
    barEl.addEventListener("click", () => selectSegment(route.routeId, seg.segmentId));
  });
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
  renderSegmentStrip(route);
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

// Unwinds the details-mode state/UI set up by enterDetailsFromSearch, mirroring
// the details slice of resetPanelState — keep the two lists in sync if that
// state grows.
function backToSearch(): void {
  routeLoadSeq++; // invalidate any in-flight loadRouteDetails
  setBackButtonVisible(false);
  setState("routes", null, "selected");
  setState("routes", null, "hover");
  setState("segments", null, "selected");
  setState("segments", null, "hover");
  void geoModule?.clear("segments");
  clearAndHide("route-chips");
  clearAndHide("route-stats");
  detailsRoutes = [];
  selectedSegmentId = null;

  currentMode = "search";
  renderSearchMode(searchRoutes);
  if (selectedRouteId != null) selectSearchRoute(selectedRouteId);
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

  routeLoadSeq++; // a new render invalidates any in-flight loadRouteDetails
  setBackButtonVisible(false);
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
  render: async ({ app, map: m, viz }) => {
    appRef = app;
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
          beginRouteDetailsLoad(routeId);
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
        syncSegmentBarHover(parsed ? parsed.segmentId : null);
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

el("details-back-btn")?.addEventListener("click", backToSearch);

// renderSearchMode/renderDetailsMode (declared above) close over this — safe:
// they only ever run from the async `bootstrapVizApp` render callback, which
// fires well after this module-scope const has initialized.
const legendMql = initDrawer({
  asideId: "route-panel",
  getMap: () => map,
  handleLabel: "Routes",
}).mql;
