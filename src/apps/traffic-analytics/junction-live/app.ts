/*
 * Copyright (C) 2025 TomTom Navigation B.V.
 * Licensed under the Apache License, Version 2.0
 */

import type { App } from "@modelcontextprotocol/ext-apps";
import { TomTomMap, CustomGeoJSONModule } from "@tomtom-org/maps-sdk/map";
import { bboxFromGeoJSON } from "@tomtom-org/maps-sdk/core";
import { polygonRingCentroid } from "@shared/geo";
import { bootstrapVizApp } from "@shared/app-bootstrap";
import { formatDuration } from "@shared/format";
import { el, escapeHtml, clearAndHide } from "@shared/dom";
import { createFeatureStateSetter } from "@shared/feature-state";
import "@shared/controls";
import { LOS_BANDS, losFor, losThresholdLabel } from "./los";
import { loadArrowIcon } from "./arrow-icon";
import { fetchJunctionLive } from "./live-fetch";
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

const NEUTRAL_APPROACH = "#64748b";
const NEUTRAL_EXIT = "#9ca3af";

const STATUS_LABEL: Record<JunctionStatus, { label: string; className: string }> = {
  ACTIVE: { label: "Active", className: "status-active" },
  PREVIEW: { label: "Preview", className: "status-preview" },
  PENDING_UPDATE: { label: "Pending update", className: "status-pending" },
  ERROR: { label: "Error", className: "status-error" },
};

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let map: TomTomMap | undefined;
let appRef: App | undefined;
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

// Live mode state
let liveJunctions: JunctionLiveData[] = [];
let selectedLiveJunctionId: string | null = null;
let selectedApproachId: number | null = null;
let currentLiveById = new Map<number, ApproachLiveData>();
let currentExits: Exit[] = [];
let currentExitById = new Map<number, Exit>();

// ---------------------------------------------------------------------------
// DOM helpers
// ---------------------------------------------------------------------------

function setPanelVisible(visible: boolean): void {
  el("junction-panel")?.classList.toggle("hidden", !visible);
}

function hideDetailCard(): void {
  const card = el("junction-detail-card");
  card?.classList.add("hidden");
  if (card) card.innerHTML = "";
}

// ---------------------------------------------------------------------------
// Geometry helpers
// ---------------------------------------------------------------------------

function junctionCenter(geometry: GeoJSONPointGeom | GeoJSONPolygonGeom): [number, number] | null {
  if (geometry.type === "Point") return geometry.coordinates;
  return polygonRingCentroid(geometry.coordinates[0] ?? []);
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
// Feature-state helpers — shared tracker; at most one feature per
// (source, state) pair is ever flagged.
// ---------------------------------------------------------------------------

const setState = createFeatureStateSetter(() => ({ map, geoModule }));

function setJunctionSelected(id: string | null): void {
  setState("junctions", id, "selected");
}

function setApproachSelected(id: number | null): void {
  setState("approaches", id !== null ? "a-" + id : null, "selected");
}

function setApproachHover(id: number | null): void {
  setState("approaches", id !== null ? "a-" + id : null, "hover");
  syncApproachCardHover(id);
}

function setExitHover(exitId: number | null): void {
  setState("exits", exitId !== null ? "x-" + exitId : null, "hover");
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
    <div class="junction-item-id">${escapeHtml(junction.id)}</div>
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
    empty.textContent = "No junctions found";
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

  const approachTable = model?.approaches.length
    ? `<table class="detail-approach-table">
        <thead><tr><th>Road</th><th>Direction</th><th>FRC</th></tr></thead>
        <tbody>${model.approaches
          .map(
            (a) =>
              `<tr><td>${escapeHtml(a.roadName)}</td><td>${escapeHtml(a.direction)}</td><td>${Number(a.frc)}</td></tr>`
          )
          .join("")}</tbody>
      </table>`
    : "";

  card.innerHTML = `
    <button type="button" class="detail-close" aria-label="Close">&times;</button>
    <div class="detail-title">${escapeHtml(junction.name)}</div>
    <span class="status-badge ${status.className}"><span class="status-dot"></span>${escapeHtml(status.label)}</span>
    <div class="detail-grid">
      <span class="detail-label">Junction ID</span><span class="detail-id">${escapeHtml(junction.id)}</span>
      ${model ? `<span class="detail-label">Country</span><span>${escapeHtml(model.countryCode)}</span>` : ""}
      ${model ? `<span class="detail-label">Signals</span><span>${model.trafficLights ? "Traffic lights" : "No traffic lights"}</span>` : ""}
    </div>
    ${approachTable}
    <button type="button" class="tta-btn detail-live-btn">Load live data</button>
    <div class="detail-live-error hidden"></div>
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
  card
    .querySelector<HTMLButtonElement>(".detail-live-btn")
    ?.addEventListener(
      "click",
      (e) => void loadLiveData(junction, e.currentTarget as HTMLButtonElement)
    );
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

    void geoModule?.show(
      { type: "FeatureCollection" as const, features: approachFeatures },
      "approaches"
    );
    void geoModule?.show({ type: "FeatureCollection" as const, features: exitFeatures }, "exits");
  } else {
    void geoModule?.clear("approaches");
    void geoModule?.clear("exits");
  }

  renderJunctionDetailCard(junction);
}

function renderSearchMode(junctions: JunctionDefinition[]): void {
  searchJunctions = junctions;

  const junctionFeatures = junctions
    .map(buildJunctionFeature)
    .filter((f): f is NonNullable<typeof f> => f !== null);
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
      const exit = currentExitById.get(tr.exitId);
      const label = exit ? exit.roadName || exit.name : `#${tr.exitId}`;
      return `<tr data-exit-id="${Number(tr.exitId)}"><td>${escapeHtml(label)}</td><td>${Math.round(tr.ratioPercent)}%</td><td>${Number(tr.probesCount)}</td></tr>`;
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
    : `Approach ${Number(row.id)}`;

  const bodyRows: string[] = [];
  if (los) {
    bodyRows.push(`<div class="approach-card-row los-qualifier">${los.label}</div>`);
  }
  if (live) {
    bodyRows.push(
      `<div class="approach-card-row">Travel time ${formatDuration(live.travelTimeSec)} (free-flow ${formatDuration(live.freeFlowTravelTimeSec)})</div>`
    );
    bodyRows.push(
      `<div class="approach-card-row">Queue ${Math.round(live.queueLengthMeters)} m</div>`
    );
    bodyRows.push(`<div class="approach-card-row">Stops ${Number(live.stops)}</div>`);
    if (live.volumePerHour !== undefined) {
      bodyRows.push(
        `<div class="approach-card-row">Volume ${Math.round(live.volumePerHour)} veh/h</div>`
      );
    }
  }

  card.innerHTML = `
    <div class="approach-card-header">
      <span class="approach-card-name">${headerLabel}</span>
      ${los ? `<span class="los-badge" style="background:${los.color}">LOS ${los.letter}</span>` : ""}
      ${live ? `<span class="approach-card-delay">delay ${formatDuration(live.delaySec)}</span>` : ""}
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
    empty.textContent = "No approach data for this junction";
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
  currentExitById = new Map(currentExits.map((e) => [e.id, e]));

  if (!model) {
    void geoModule?.clear("approaches");
    void geoModule?.clear("exits");
  } else {
    const approachFeatures = model.approaches
      .map((a) => {
        const live = currentLiveById.get(a.id);
        return buildApproachFeature(
          a,
          losFor(live?.delaySec)?.color ?? NEUTRAL_APPROACH,
          live?.isClosed === true
        );
      })
      .filter(hasGeometry);
    const exitFeatures = model.exits.map(buildExitFeature).filter(hasGeometry);

    void geoModule?.show(
      { type: "FeatureCollection" as const, features: approachFeatures },
      "approaches"
    );
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

  const steps = LOS_BANDS.map(
    (b) => `
      <div class="los-scale-step">
        <span class="los-scale-swatch" style="background:${b.color}"></span>
        <span class="los-scale-letter">${b.letter}</span>
        <span class="los-scale-threshold">${losThresholdLabel(b)}</span>
      </div>`
  ).join("");

  legend.innerHTML = `
    <div class="los-legend-title">Level of Service (intersection delay)</div>
    <div class="los-scale">${steps}</div>
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

function setBackButtonVisible(visible: boolean): void {
  el("live-back")?.classList.toggle("hidden", !visible);
}

async function loadLiveData(junction: JunctionDefinition, btn: HTMLButtonElement): Promise<void> {
  if (!appRef) return;
  const errEl = el("junction-detail-card")?.querySelector<HTMLElement>(".detail-live-error");
  btn.disabled = true;
  btn.textContent = "Loading…";
  errEl?.classList.add("hidden");
  try {
    const live = (await fetchJunctionLive(appRef, [junction.id])) as JunctionLiveData[];
    if (live.length === 0) throw new Error("No live data returned");
    // The app-only tool omits junctionModel — reuse the geometry search already has.
    for (const j of live) {
      j.junctionModel ??= searchJunctions.find((s) => s.id === j.id)?.junctionModel;
    }
    enterLiveFromSearch(live);
  } catch (error) {
    console.error("[tta-junction-live] Failed to load live data:", error);
    if (errEl) {
      errEl.textContent = "Failed to load live data — try again.";
      errEl.classList.remove("hidden");
    }
    btn.disabled = false;
    btn.textContent = "Load live data";
  }
}

function enterLiveFromSearch(junctions: JunctionLiveData[]): void {
  currentMode = "live";
  // Keep searchJunctions/selectedJunctionId for the back path; clear search-only UI/map.
  setJunctionSelected(null);
  hideDetailCard();
  void geoModule?.clear("junctions");
  setBackButtonVisible(true);
  renderLiveMode(junctions);
}

// Unwinds the live-mode state/UI set up by enterLiveFromSearch, mirroring the
// live slice of resetPanelState — keep the two lists in sync if that state grows.
function backToSearch(): void {
  setBackButtonVisible(false);
  setApproachSelected(null);
  setApproachHover(null);
  setExitHover(null);
  void geoModule?.clear("approaches");
  void geoModule?.clear("exits");
  clearAndHide("junction-chips");
  clearAndHide("legend");
  liveJunctions = [];
  selectedLiveJunctionId = null;
  selectedApproachId = null;
  currentLiveById = new Map();
  currentExits = [];
  currentExitById = new Map();

  currentMode = "search";
  renderSearchMode(searchJunctions);
  if (selectedJunctionId) selectJunction(selectedJunctionId);
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
  selectedLiveJunctionId = null;
  selectedApproachId = null;
  currentLiveById = new Map();
  currentExits = [];
  currentExitById = new Map();

  setBackButtonVisible(false);
}

// ---------------------------------------------------------------------------
// MCP App lifecycle — shared bootstrap owns parse/gates/map creation.
// ---------------------------------------------------------------------------

bootstrapVizApp<VizPayload>({
  name: "tta-junction-live",
  panelId: "junction-panel",
  errorMessage: "Failed to fetch junction data",
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- viz shape is unverified after a cache-miss fallback
  validate: (viz): viz is VizPayload => Array.isArray((viz as any)?.junctions),
  resetUI: hideDetailCard,
  render: async ({ app, map: m, viz }) => {
    appRef = app;
    map = m;

    if (!geoModule) {
      const arrowIcon = await loadArrowIcon();

      geoModule = await CustomGeoJSONModule.get(map, {
        images: {
          "approach-arrow": { image: arrowIcon, options: { pixelRatio: 2 } },
        },
        sources: {
          junctions: {
            layers: [
              {
                id: "junction-live-junctions-circle",
                type: "circle",
                paint: {
                  "circle-radius": [
                    "case",
                    ["boolean", ["feature-state", "selected"], false],
                    8,
                    6,
                  ],
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
              {
                id: "junction-live-approaches-arrows",
                type: "symbol",
                filter: ["!=", ["get", "closed"], true],
                layout: {
                  "symbol-placement": "line",
                  "symbol-spacing": 60,
                  "icon-image": "approach-arrow",
                  // Source art points up; +90° clockwise makes it point along the line
                  // direction (approach → junction).
                  "icon-rotate": 90,
                  "icon-rotation-alignment": "map",
                  "icon-pitch-alignment": "map",
                  "icon-allow-overlap": true,
                  "icon-ignore-placement": true,
                },
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
    }

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
  },
  teardown: () => {
    geoModule?.setVisible(false);
  },
});

el("live-back-btn")?.addEventListener("click", backToSearch);
