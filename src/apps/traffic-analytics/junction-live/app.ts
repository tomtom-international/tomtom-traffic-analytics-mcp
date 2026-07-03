/*
 * Copyright (C) 2025 TomTom Navigation B.V.
 * Licensed under the Apache License, Version 2.0
 */

import { App } from "@modelcontextprotocol/ext-apps";
import { TomTomMap, CustomGeoJSONModule } from "@tomtom-org/maps-sdk/map";
import { bboxFromGeoJSON } from "@tomtom-org/maps-sdk/core";
import { ensureTomTomConfigured } from "@shared/sdk-config";
import { extractFullData } from "@shared/viz-data";
import { shouldShowUI, showMapUI, hideMapUI, showErrorUI } from "@shared/ui-visibility";
import "@shared/controls";
// Bundled so map chrome styling never depends on the CDN link the SDK
// injects at runtime (see resourceRegistry.ts APP_RESOURCE_CSP comment).
import "maplibre-gl/dist/maplibre-gl.css";
import "./styles.css";

// ---------------------------------------------------------------------------
// Types — trimmed app-local mirrors of src/services/junction-analytics/types.ts
// (apps don't import server types).
// ---------------------------------------------------------------------------

interface GeoJSONPointGeom {
  type: "Point";
  coordinates: [number, number];
}

interface GeoJSONPolygonGeom {
  type: "Polygon";
  coordinates: number[][][];
}

interface GeoJSONMultiLineStringGeom {
  type: "MultiLineString";
  coordinates: number[][][];
}

interface RawJunctionFeature {
  type: "Feature";
  geometry: GeoJSONPointGeom | GeoJSONPolygonGeom;
}

type ApproachDirection = "SOUTH" | "WEST" | "EAST" | "NORTH" | "CLOCKWISE" | "COUNTER_CLOCKWISE";

interface Approach {
  id: number;
  name: string;
  roadName: string;
  direction: ApproachDirection;
  frc: number;
  segmentedGeometry: GeoJSONMultiLineStringGeom;
}

interface Exit {
  id: number;
  name: string;
  roadName: string;
  segmentedGeometry: GeoJSONMultiLineStringGeom;
}

interface JunctionModel {
  name: string;
  countryCode: string;
  driveOnLeft: boolean;
  trafficLights: boolean;
  approaches: Approach[];
  exits: Exit[];
}

type JunctionStatus = "PREVIEW" | "ACTIVE" | "PENDING_UPDATE" | "ERROR";

interface JunctionDefinition {
  id: string;
  name: string;
  status: JunctionStatus;
  rawJunction: RawJunctionFeature;
  junctionModel?: JunctionModel;
  timeZone: string;
}

interface TurnRatio {
  exitId: number;
  exitIndex: number;
  ratioPercent: number;
  probesCount: number;
}

interface ApproachLiveData {
  id: number;
  travelTimeSec: number;
  freeFlowTravelTimeSec: number;
  delaySec: number;
  usualDelaySec: number;
  stops: number;
  queueLengthMeters: number;
  isClosed: boolean;
  volumePerHour?: number;
  turnRatios: TurnRatio[];
}

interface JunctionLiveData {
  id: string;
  approachesLiveData: ApproachLiveData[];
  junctionModel?: JunctionModel;
}

/** Payload cached by `tomtom-junction-search` or `tomtom-junction-live-data`; discriminated on `tool`. */
interface VizPayload {
  tool: string;
  junctions: JunctionDefinition[] | JunctionLiveData[];
}

/** Row fed to the live-mode approach card renderer — joins junctionModel metadata (when present) with live data. */
interface ApproachRow {
  id: number;
  roadName?: string;
  direction?: ApproachDirection;
  live?: ApproachLiveData;
}

// ---------------------------------------------------------------------------
// LOS bands
// ---------------------------------------------------------------------------

const LOS_BANDS = [
  { letter: "A", max: 10, color: "#2dc653" },
  { letter: "B", max: 20, color: "#8ac926" },
  { letter: "C", max: 35, color: "#f5a623" },
  { letter: "D", max: 55, color: "#e07b39" },
  { letter: "E", max: 80, color: "#e03030" },
  { letter: "F", max: Infinity, color: "#8b0000" },
] as const;
const NEUTRAL_APPROACH = "#64748b";
const NEUTRAL_EXIT = "#9ca3af";

function losFor(delaySec: number | null | undefined): (typeof LOS_BANDS)[number] | undefined {
  if (delaySec == null || !Number.isFinite(delaySec)) return undefined;
  return LOS_BANDS.find((b) => delaySec <= b.max);
}

const STATUS_LABEL: Record<JunctionStatus, { label: string; className: string }> = {
  ACTIVE: { label: "Active", className: "status-active" },
  PREVIEW: { label: "Preview", className: "status-preview" },
  PENDING_UPDATE: { label: "Pending update", className: "status-pending" },
  ERROR: { label: "Error", className: "status-error" },
};

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

const app = new App({ name: "tta-junction-live", version: "1.0.0" });

let map: TomTomMap | undefined;
let geoModule: CustomGeoJSONModule | undefined;
let junctionsClickBound = false;
let approachesClickBound = false;
let approachesHoverBound = false;

// Which mode last rendered onto the shared `approaches`/`exits` sources. Search mode
// draws display-only neutral approach lines onto the same source live mode uses for
// interactive cards, so approach click/hover handlers must gate on this to stay inert
// in search mode.
let currentMode: "search" | "live" | null = null;

// Search mode state
let searchJunctions: JunctionDefinition[] = [];
let selectedJunctionId: string | null = null;
let prevSelectedJunctionFeatureId: string | null = null;

// Live mode state
let liveJunctions: JunctionLiveData[] = [];
let selectedLiveJunctionId: string | null = null;
let selectedApproachId: number | null = null;
let prevSelectedApproachFeatureId: string | null = null;
let prevHoverApproachFeatureId: string | null = null;
let prevHoverExitFeatureId: string | null = null;
let currentLiveById = new Map<number, ApproachLiveData>();
let currentExits: Exit[] = [];

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
  el("junction-panel")?.classList.toggle("hidden", !visible);
}

function hideDetailCard(): void {
  const card = el("junction-detail-card");
  card?.classList.add("hidden");
  if (card) card.innerHTML = "";
}

function clearAndHide(id: string): void {
  const node = el(id);
  if (!node) return;
  node.innerHTML = "";
  node.classList.add("hidden");
}

const _escapeDiv = document.createElement("div");
function escapeHtml(text: string): string {
  _escapeDiv.textContent = text;
  return _escapeDiv.innerHTML;
}

// ---------------------------------------------------------------------------
// Geometry helpers
// ---------------------------------------------------------------------------

function junctionCenter(geometry: GeoJSONPointGeom | GeoJSONPolygonGeom): [number, number] | null {
  if (geometry.type === "Point") return geometry.coordinates;

  const ring = geometry.coordinates[0];
  if (!ring || ring.length === 0) return null;

  let sumLon = 0;
  let sumLat = 0;
  for (const vertex of ring) {
    sumLon += vertex[0];
    sumLat += vertex[1];
  }
  return [sumLon / ring.length, sumLat / ring.length];
}

interface JunctionFeature {
  type: "Feature";
  id: string;
  geometry: GeoJSONPointGeom;
  properties: { id: string; name: string };
}

function buildJunctionFeature(junction: JunctionDefinition): JunctionFeature | null {
  const center = junctionCenter(junction.rawJunction.geometry);
  if (!center) return null;
  return {
    type: "Feature",
    id: junction.id,
    geometry: { type: "Point", coordinates: center },
    properties: { id: junction.id, name: junction.name },
  };
}

interface ApproachFeature {
  type: "Feature";
  id: string;
  geometry: GeoJSONMultiLineStringGeom;
  properties: { id: string; color: string; closed: boolean; name: string; roadName: string };
}

function buildApproachFeature(approach: Approach, color: string, closed: boolean): ApproachFeature {
  const featureId = "a-" + approach.id;
  return {
    type: "Feature",
    id: featureId,
    geometry: approach.segmentedGeometry,
    properties: {
      id: featureId,
      color,
      closed,
      name: approach.name,
      roadName: approach.roadName,
    },
  };
}

interface ExitFeature {
  type: "Feature";
  id: string;
  geometry: GeoJSONMultiLineStringGeom;
  properties: { id: string };
}

function buildExitFeature(exit: Exit): ExitFeature {
  const featureId = "x-" + exit.id;
  return {
    type: "Feature",
    id: featureId,
    geometry: exit.segmentedGeometry,
    properties: { id: featureId },
  };
}

function hasGeometry(feature: { geometry: { coordinates: unknown[] } }): boolean {
  return feature.geometry.coordinates.length > 0;
}

// ---------------------------------------------------------------------------
// Feature-state helpers
// ---------------------------------------------------------------------------

function setJunctionSelected(id: string | null): void {
  if (!map || !geoModule) return;
  const sourceID = geoModule.sourceAndLayerIDs.junctions.sourceID;
  if (prevSelectedJunctionFeatureId !== null) {
    map.mapLibreMap.removeFeatureState({ source: sourceID, id: prevSelectedJunctionFeatureId });
  }
  if (id !== null) {
    map.mapLibreMap.setFeatureState({ source: sourceID, id }, { selected: true });
  }
  prevSelectedJunctionFeatureId = id;
}

function setApproachSelected(id: number | null): void {
  if (!map || !geoModule) return;
  const sourceID = geoModule.sourceAndLayerIDs.approaches.sourceID;
  if (prevSelectedApproachFeatureId !== null) {
    map.mapLibreMap.removeFeatureState({ source: sourceID, id: prevSelectedApproachFeatureId });
  }
  const featureId = id !== null ? "a-" + id : null;
  if (featureId !== null) {
    map.mapLibreMap.setFeatureState({ source: sourceID, id: featureId }, { selected: true });
  }
  prevSelectedApproachFeatureId = featureId;
}

function setApproachHover(id: number | null): void {
  if (map && geoModule) {
    const sourceID = geoModule.sourceAndLayerIDs.approaches.sourceID;
    if (prevHoverApproachFeatureId !== null) {
      map.mapLibreMap.removeFeatureState({ source: sourceID, id: prevHoverApproachFeatureId }, "hover");
    }
    const featureId = id !== null ? "a-" + id : null;
    if (featureId !== null) {
      map.mapLibreMap.setFeatureState({ source: sourceID, id: featureId }, { hover: true });
    }
    prevHoverApproachFeatureId = featureId;
  }
  syncApproachCardHover(id);
}

function setExitHover(exitId: number | null): void {
  if (!map || !geoModule) return;
  const sourceID = geoModule.sourceAndLayerIDs.exits.sourceID;
  if (prevHoverExitFeatureId !== null) {
    map.mapLibreMap.removeFeatureState({ source: sourceID, id: prevHoverExitFeatureId }, "hover");
  }
  const featureId = exitId !== null ? "x-" + exitId : null;
  if (featureId !== null) {
    map.mapLibreMap.setFeatureState({ source: sourceID, id: featureId }, { hover: true });
  }
  prevHoverExitFeatureId = featureId;
}

function parseApproachFeatureId(id: string | number | undefined): number | null {
  if (id === undefined) return null;
  const str = String(id);
  if (!str.startsWith("a-")) return null;
  const n = Number(str.slice(2));
  return Number.isFinite(n) ? n : null;
}

// ---------------------------------------------------------------------------
// Search mode
// ---------------------------------------------------------------------------

function highlightJunctionItem(id: string | null): void {
  const list = el("panel-list");
  if (!list) return;
  for (const item of Array.from(list.querySelectorAll(".junction-item"))) {
    item.classList.toggle("active", item.getAttribute("data-id") === id);
  }
}

function renderJunctionItem(junction: JunctionDefinition): HTMLElement {
  const status = STATUS_LABEL[junction.status] ?? STATUS_LABEL.PREVIEW;

  const item = document.createElement("button");
  item.type = "button";
  item.className = "junction-item" + (junction.id === selectedJunctionId ? " active" : "");
  item.setAttribute("data-id", junction.id);
  item.innerHTML = `
    <div class="junction-item-header">
      <span class="junction-item-name">${escapeHtml(junction.name)}</span>
      <span class="status-badge ${status.className}"><span class="status-dot"></span>${escapeHtml(status.label)}</span>
    </div>
  `;
  item.addEventListener("click", () => selectJunction(junction.id));
  return item;
}

function renderJunctionList(junctions: JunctionDefinition[]): void {
  const list = el("panel-list");
  const empty = el("empty-state");
  if (!list || !empty) return;

  list.innerHTML = "";

  if (junctions.length === 0) {
    empty.classList.remove("hidden");
    return;
  }
  empty.classList.add("hidden");

  for (const junction of junctions) {
    list.appendChild(renderJunctionItem(junction));
  }
}

function renderJunctionDetailCard(junction: JunctionDefinition): void {
  const card = el("junction-detail-card");
  if (!card) return;

  const status = STATUS_LABEL[junction.status] ?? STATUS_LABEL.PREVIEW;
  const model = junction.junctionModel;

  const approachList = model?.approaches.length
    ? `<ul class="detail-approach-list">${model.approaches
        .map((a) => `<li>${escapeHtml(a.roadName)} · ${escapeHtml(a.direction)} · FRC ${a.frc}</li>`)
        .join("")}</ul>`
    : "";

  card.innerHTML = `
    <button type="button" class="detail-close" aria-label="Close">&times;</button>
    <div class="detail-title">${escapeHtml(junction.name)}</div>
    <span class="status-badge ${status.className}"><span class="status-dot"></span>${escapeHtml(status.label)}</span>
    ${model ? `<div class="detail-row">${escapeHtml(model.countryCode)}</div>` : ""}
    ${model ? `<div class="detail-row">${model.trafficLights ? "Traffic lights" : "No traffic lights"}</div>` : ""}
    ${approachList}
    <div class="detail-hint">Run tomtom-junction-live-data with this junction's ID for live metrics.</div>
  `;
  card.classList.remove("hidden");
  card.querySelector(".detail-close")?.addEventListener("click", () => {
    selectedJunctionId = null;
    highlightJunctionItem(null);
    setJunctionSelected(null);
    hideDetailCard();
    void geoModule?.clear("approaches");
    void geoModule?.clear("exits");
  });
}

function selectJunction(id: string): void {
  selectedJunctionId = id;
  highlightJunctionItem(id);
  setJunctionSelected(id);

  const junction = searchJunctions.find((j) => j.id === id);
  if (!junction) {
    hideDetailCard();
    return;
  }

  const center = junctionCenter(junction.rawJunction.geometry);
  if (center && map) {
    map.mapLibreMap.flyTo({ center, zoom: 16, duration: 1000, essential: true });
  }

  if (junction.junctionModel) {
    const approachFeatures = junction.junctionModel.approaches
      .map((a) => buildApproachFeature(a, NEUTRAL_APPROACH, false))
      .filter(hasGeometry);
    const exitFeatures = junction.junctionModel.exits.map(buildExitFeature).filter(hasGeometry);

    void geoModule?.show({ type: "FeatureCollection" as const, features: approachFeatures }, "approaches");
    void geoModule?.show({ type: "FeatureCollection" as const, features: exitFeatures }, "exits");
  } else {
    void geoModule?.clear("approaches");
    void geoModule?.clear("exits");
  }

  renderJunctionDetailCard(junction);
}

function renderSearchMode(junctions: JunctionDefinition[]): void {
  searchJunctions = junctions;

  const junctionFeatures = junctions.map(buildJunctionFeature).filter((f): f is NonNullable<typeof f> => f !== null);
  const fc = { type: "FeatureCollection" as const, features: junctionFeatures };
  void geoModule?.show(fc, "junctions");

  renderJunctionList(junctions);

  const bbox = bboxFromGeoJSON(fc);
  if (bbox && map) {
    map.mapLibreMap.fitBounds(bbox, { padding: 60 });
  }
}

// ---------------------------------------------------------------------------
// Live mode
// ---------------------------------------------------------------------------

function renderJunctionChips(junctions: JunctionLiveData[]): void {
  const container = el("junction-chips");
  if (!container) return;

  container.innerHTML = "";

  if (junctions.length <= 1) {
    container.classList.add("hidden");
    return;
  }

  container.classList.remove("hidden");
  for (const junction of junctions) {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "tta-chip" + (junction.id === selectedLiveJunctionId ? " active" : "");
    chip.textContent = junction.junctionModel?.name ?? junction.id;
    chip.addEventListener("click", () => selectLiveJunction(junction));
    container.appendChild(chip);
  }
}

function buildApproachRows(junction: JunctionLiveData): ApproachRow[] {
  const model = junction.junctionModel;
  if (model) {
    const liveById = new Map(junction.approachesLiveData.map((a) => [a.id, a]));
    return model.approaches.map((a) => ({
      id: a.id,
      roadName: a.roadName,
      direction: a.direction,
      live: liveById.get(a.id),
    }));
  }
  return junction.approachesLiveData.map((a) => ({ id: a.id, live: a }));
}

function syncApproachCardHover(id: number | null): void {
  const list = el("panel-list");
  if (!list) return;
  for (const card of Array.from(list.querySelectorAll<HTMLElement>(".approach-card"))) {
    const cardId = Number(card.getAttribute("data-approach-id"));
    card.classList.toggle("hover", cardId === id);
  }
}

function renderTurnRatioTable(table: HTMLElement, approachId: number): void {
  const live = currentLiveById.get(approachId);
  const turnRatios = [...(live?.turnRatios ?? [])].sort((a, b) => b.ratioPercent - a.ratioPercent);

  if (turnRatios.length === 0) {
    table.innerHTML = `<div class="turn-ratio-empty">No turn ratio data</div>`;
    return;
  }

  const rows = turnRatios
    .map((tr) => {
      const exit = currentExits.find((e) => e.id === tr.exitId);
      const label = exit ? exit.roadName || exit.name : `#${tr.exitId}`;
      return `<tr data-exit-id="${tr.exitId}"><td>${escapeHtml(label)}</td><td>${Math.round(tr.ratioPercent)}%</td><td>${tr.probesCount}</td></tr>`;
    })
    .join("");

  table.innerHTML = `
    <table>
      <thead><tr><th>Exit</th><th>Share</th><th>Probes</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
  `;

  for (const row of Array.from(table.querySelectorAll<HTMLElement>("tbody tr"))) {
    const exitId = Number(row.getAttribute("data-exit-id"));
    row.addEventListener("mouseenter", () => setExitHover(exitId));
    row.addEventListener("mouseleave", () => setExitHover(null));
  }
}

function refreshApproachCardSelection(): void {
  const list = el("panel-list");
  if (!list) return;
  for (const card of Array.from(list.querySelectorAll<HTMLElement>(".approach-card"))) {
    const id = Number(card.getAttribute("data-approach-id"));
    const isSelected = id === selectedApproachId;
    card.classList.toggle("selected", isSelected);

    const table = card.querySelector<HTMLElement>(".turn-ratio-table");
    if (!table) continue;
    if (isSelected) {
      renderTurnRatioTable(table, id);
      table.classList.remove("hidden");
    } else {
      table.classList.add("hidden");
      table.innerHTML = "";
    }
  }
}

function selectApproach(id: number): void {
  selectedApproachId = id;
  setApproachSelected(id);
  refreshApproachCardSelection();
}

function renderApproachCard(row: ApproachRow): HTMLElement {
  const card = document.createElement("div");
  card.className = "approach-card" + (row.id === selectedApproachId ? " selected" : "");
  card.setAttribute("data-approach-id", String(row.id));

  const live = row.live;
  const los = losFor(live?.delaySec);
  const headerLabel = row.roadName
    ? `${escapeHtml(row.roadName)}${row.direction ? " · " + escapeHtml(row.direction) : ""}`
    : `Approach ${row.id}`;

  const bodyRows: string[] = [];
  if (live) {
    bodyRows.push(
      `<div class="approach-card-row">Travel time ${Math.round(live.travelTimeSec)} s (free-flow ${Math.round(live.freeFlowTravelTimeSec)} s)</div>`
    );
    bodyRows.push(`<div class="approach-card-row">Queue ${Math.round(live.queueLengthMeters)} m</div>`);
    bodyRows.push(`<div class="approach-card-row">Stops ${live.stops}</div>`);
    if (live.volumePerHour !== undefined) {
      bodyRows.push(`<div class="approach-card-row">Volume ${Math.round(live.volumePerHour)} veh/h</div>`);
    }
  }

  card.innerHTML = `
    <div class="approach-card-header">
      <span class="approach-card-name">${headerLabel}</span>
      ${los ? `<span class="los-badge" style="background:${los.color}">${los.letter}</span>` : ""}
      ${live ? `<span class="approach-card-delay">delay ${Math.round(live.delaySec)} s</span>` : ""}
      ${live?.isClosed ? `<span class="closed-badge">Closed</span>` : ""}
    </div>
    ${bodyRows.length > 0 ? `<div class="approach-card-body">${bodyRows.join("")}</div>` : ""}
    <div class="turn-ratio-table hidden"></div>
  `;

  card.addEventListener("click", () => selectApproach(row.id));
  card.addEventListener("mouseenter", () => setApproachHover(row.id));
  card.addEventListener("mouseleave", () => setApproachHover(null));
  return card;
}

function renderApproachCards(junction: JunctionLiveData): void {
  const list = el("panel-list");
  const empty = el("empty-state");
  if (!list || !empty) return;

  list.innerHTML = "";

  const rows = buildApproachRows(junction).sort(
    (a, b) => (b.live?.delaySec ?? -Infinity) - (a.live?.delaySec ?? -Infinity)
  );

  if (rows.length === 0) {
    empty.classList.remove("hidden");
    return;
  }
  empty.classList.add("hidden");

  if (!junction.junctionModel) {
    const note = document.createElement("div");
    note.className = "geometry-note";
    note.textContent = "Geometry unavailable for this junction";
    list.appendChild(note);
  }

  for (const row of rows) {
    list.appendChild(renderApproachCard(row));
  }
}

function selectLiveJunction(junction: JunctionLiveData): void {
  selectedLiveJunctionId = junction.id;
  renderJunctionChips(liveJunctions);

  selectedApproachId = null;
  setApproachSelected(null);
  setApproachHover(null);
  setExitHover(null);

  const model = junction.junctionModel;
  currentLiveById = new Map(junction.approachesLiveData.map((a) => [a.id, a]));
  currentExits = model?.exits ?? [];

  if (!model) {
    void geoModule?.clear("approaches");
    void geoModule?.clear("exits");
  } else {
    const approachFeatures = model.approaches
      .map((a) => {
        const live = currentLiveById.get(a.id);
        return buildApproachFeature(a, losFor(live?.delaySec)?.color ?? NEUTRAL_APPROACH, live?.isClosed === true);
      })
      .filter(hasGeometry);
    const exitFeatures = model.exits.map(buildExitFeature).filter(hasGeometry);

    void geoModule?.show({ type: "FeatureCollection" as const, features: approachFeatures }, "approaches");
    void geoModule?.show({ type: "FeatureCollection" as const, features: exitFeatures }, "exits");

    const unionFeatures = [...approachFeatures, ...exitFeatures];
    if (unionFeatures.length > 0 && map) {
      const bbox = bboxFromGeoJSON({ type: "FeatureCollection" as const, features: unionFeatures });
      if (bbox) map.mapLibreMap.fitBounds(bbox, { padding: 60 });
    }
  }

  renderApproachCards(junction);
}

function renderLosLegend(): void {
  const legend = el("legend");
  if (!legend) return;

  const swatches = LOS_BANDS.map(
    (b) => `
      <div class="los-legend-item">
        <span class="los-legend-swatch" style="background:${b.color}"></span>
        <span class="los-legend-letter">${b.letter}</span>
      </div>`
  ).join("");

  legend.innerHTML = `
    <div class="los-legend-title">Level of Service</div>
    <div class="los-legend-row">${swatches}</div>
    <div class="los-legend-caption">A &le;10 s &middot; B &le;20 s &middot; C &le;35 s &middot; D &le;55 s &middot; E &le;80 s &middot; F &gt;80 s</div>
  `;
  legend.classList.remove("hidden");
}

function renderLiveMode(junctions: JunctionLiveData[]): void {
  liveJunctions = junctions;
  renderLosLegend();

  if (junctions.length === 0) {
    renderJunctionChips([]);
    const list = el("panel-list");
    if (list) list.innerHTML = "";
    el("empty-state")?.classList.remove("hidden");
    return;
  }

  selectLiveJunction(junctions[0]);
}

// ---------------------------------------------------------------------------
// Mode-switch reset — ensures search-mode UI (junction list/detail card) and
// live-mode UI (chips/approach cards/legend) never bleed into each other
// across repeated tool calls.
// ---------------------------------------------------------------------------

async function resetPanelState(): Promise<void> {
  // Clear MapLibre feature-state via the setters BEFORE clearing sources.
  // CustomGeoJSONModule.clear() only calls setData() — feature-state lives in a
  // separate MapLibre store keyed by (source, id) and survives setData(), so stale
  // selected/hover flags would otherwise reapply to whatever feature reuses a
  // tracked id (e.g. "a-"+id, "x-"+id are small integers reused across junctions
  // and shared between search/live modes) after the reset.
  setJunctionSelected(null);
  setApproachSelected(null);
  setApproachHover(null);
  setExitHover(null);

  await geoModule?.clear();

  clearAndHide("junction-chips");
  clearAndHide("legend");
  const list = el("panel-list");
  if (list) list.innerHTML = "";
  el("empty-state")?.classList.add("hidden");
  hideDetailCard();

  searchJunctions = [];
  liveJunctions = [];
  selectedJunctionId = null;
  prevSelectedJunctionFeatureId = null;
  selectedLiveJunctionId = null;
  selectedApproachId = null;
  prevSelectedApproachFeatureId = null;
  prevHoverApproachFeatureId = null;
  prevHoverExitFeatureId = null;
  currentLiveById = new Map();
  currentExits = [];
}

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
    hideDetailCard();
    showErrorUI("Failed to fetch junction data");
    return;
  }

  const rawText = (result.content?.[0] as { text?: string } | undefined)?.text ?? "{}";
  const parsedResp = JSON.parse(rawText);

  if (!shouldShowUI(parsedResp)) {
    setPanelVisible(false);
    hideDetailCard();
    hideMapUI();
    return;
  }

  if (!(await ensureTomTomConfigured(app))) {
    setPanelVisible(false);
    hideDetailCard();
    showErrorUI("TOMTOM_API_KEY not configured — map unavailable");
    return;
  }

  const viz = (await extractFullData(app, parsedResp)) as VizPayload;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- viz shape is unverified after a cache-miss fallback
  if (!Array.isArray((viz as any)?.junctions)) {
    setPanelVisible(false);
    hideDetailCard();
    showErrorUI("Visualization data expired — re-run the tool");
    return;
  }

  showMapUI();

  map ??= new TomTomMap({
    style: "standardLight",
    mapLibre: { container: "sdk-map", center: [0, 0], zoom: 2 },
  });

  // E2E hook — junctions/approaches/exits are canvas-rendered, not DOM.
  if (!(window as unknown as { __e2e_ml?: unknown }).__e2e_ml) {
    (window as unknown as { __e2e_ml: unknown }).__e2e_ml = map.mapLibreMap;
  }

  geoModule ??= await CustomGeoJSONModule.get(map, {
    sources: {
      junctions: {
        layers: [
          {
            id: "junction-live-junctions-circle",
            type: "circle",
            paint: {
              "circle-radius": ["case", ["boolean", ["feature-state", "selected"], false], 8, 6],
              "circle-color": "#0a3653",
              "circle-stroke-width": 2,
              "circle-stroke-color": "#ffffff",
            },
          },
          {
            id: "junction-live-junctions-label",
            type: "symbol",
            layout: {
              "text-field": ["get", "name"],
              "text-size": 12,
              "text-anchor": "top",
              "text-offset": [0, 1.1],
            },
            paint: { "text-halo-color": "#ffffff", "text-halo-width": 1.5 },
          },
        ],
      },
      approaches: {
        layers: [
          {
            id: "junction-live-approaches-casing",
            type: "line",
            layout: { "line-join": "round", "line-cap": "round" },
            paint: {
              "line-color": "#ffffff",
              "line-width": [
                "case",
                ["boolean", ["feature-state", "selected"], false],
                11,
                ["boolean", ["feature-state", "hover"], false],
                9,
                7,
              ],
            },
          },
          {
            id: "junction-live-approaches-line",
            type: "line",
            filter: ["!=", ["get", "closed"], true],
            layout: { "line-join": "round", "line-cap": "round" },
            paint: {
              "line-color": ["get", "color"],
              "line-width": [
                "case",
                ["boolean", ["feature-state", "selected"], false],
                7,
                ["boolean", ["feature-state", "hover"], false],
                5.5,
                4,
              ],
            },
          },
          {
            id: "junction-live-approaches-closed",
            type: "line",
            filter: ["==", ["get", "closed"], true],
            layout: { "line-join": "round", "line-cap": "round" },
            paint: { "line-color": "#e03030", "line-width": 4, "line-dasharray": [2, 1.5] },
          },
        ],
      },
      exits: {
        layers: [
          {
            id: "junction-live-exits-line",
            type: "line",
            layout: { "line-join": "round", "line-cap": "round" },
            paint: {
              "line-color": NEUTRAL_EXIT,
              "line-width": ["case", ["boolean", ["feature-state", "hover"], false], 5, 2.5],
            },
          },
        ],
      },
    },
  });

  if (!junctionsClickBound) {
    geoModule.events.junctions.on("click", (f) => selectJunction(String(f.id)));
    junctionsClickBound = true;
  }
  if (!approachesClickBound) {
    geoModule.events.approaches.on("click", (f) => {
      // Search mode renders display-only neutral approach lines onto the same
      // source — ignore clicks there so they don't trigger live-mode selection.
      if (currentMode !== "live") return;
      const id = parseApproachFeatureId(f.id);
      if (id !== null) selectApproach(id);
    });
    approachesClickBound = true;
  }
  if (!approachesHoverBound) {
    geoModule.events.approaches.on("hover", (f) => {
      if (currentMode !== "live") return;
      setApproachHover(parseApproachFeatureId(f?.id));
    });
    approachesHoverBound = true;
  }

  await resetPanelState();
  setPanelVisible(true);

  const mode = viz.tool === "tomtom-junction-live-data" ? "live" : "search";
  currentMode = mode;
  if (mode === "live") {
    renderLiveMode(viz.junctions as JunctionLiveData[]);
  } else {
    renderSearchMode(viz.junctions as JunctionDefinition[]);
  }
};

app.onteardown = async (): Promise<Record<string, never>> => {
  geoModule?.setVisible(false);
  return {};
};

async function connectApp(): Promise<void> {
  try {
    await app.connect();
  } catch (error) {
    // Expected when opened standalone (no MCP host) — e.g. local smoke testing.
    console.warn("[junction-live] Failed to connect to MCP host:", error);
  }
}

void connectApp();
