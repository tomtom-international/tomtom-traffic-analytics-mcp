/*
 * Copyright (C) 2025 TomTom Navigation B.V.
 * Licensed under the Apache License, Version 2.0
 */

import { TomTomMap, TrafficIncidentOverlayModule } from "@tomtom-org/maps-sdk/map";
import { customizeService } from "@tomtom-org/maps-sdk/services";
import type {
  TrafficIncident,
  TrafficIncidentDetails,
  TrafficIncidentProperties,
} from "@tomtom-org/maps-sdk/core";
import { bootstrapVizApp } from "@shared/app-bootstrap";
import { bboxUnion, type Bbox } from "@shared/geo";
import { dedupeBy } from "@shared/collections";
import { el, escapeHtml } from "@shared/dom";
import "@shared/controls";
// Bundled so map chrome styling never depends on the CDN link the SDK
// injects at runtime (see resourceRegistry.ts APP_RESOURCE_CSP comment).
import "maplibre-gl/dist/maplibre-gl.css";
import "./styles.css";

const { parseTrafficIncidentDetailsResponse } = customizeService.trafficIncidentDetails;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A single named area from the `tomtom-traffic-incidents` viz payload. */
interface VizArea {
  name: string;
  bbox: string;
  /** Raw Incident Details API response (`{ incidents: [...] }`). */
  incidents: unknown;
}

interface VizPayload {
  tool: string;
  areas: VizArea[];
}

/** A parsed incident feature tagged with the area it was fetched from. */
type IncidentFeature = TrafficIncident & {
  properties: TrafficIncidentProperties & { areaName: string };
};

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let map: TomTomMap | undefined;
let overlay: TrafficIncidentOverlayModule | undefined;
let overlayClickBound = false;

let allFeatures: IncidentFeature[] = [];
let featuresById = new Map<string, IncidentFeature>();
let areaNames: string[] = [];
let activeAreaFilter: string | null = null;
let focusedId: string | null = null;

// ---------------------------------------------------------------------------
// DOM helpers
// ---------------------------------------------------------------------------

function setPanelVisible(visible: boolean): void {
  el("incident-panel")?.classList.toggle("hidden", !visible);
}

function hideDetailCard(): void {
  el("incident-detail-card")?.classList.add("hidden");
}

// ---------------------------------------------------------------------------
// Category / magnitude labels
// ---------------------------------------------------------------------------

const CATEGORY_LABEL: Record<string, string> = {
  accident: "Accident",
  "animals-on-road": "Animals on Road",
  "broken-down-vehicle": "Broken Down Vehicle",
  danger: "Danger",
  flooding: "Flooding",
  fog: "Fog",
  frost: "Frost",
  jam: "Jam",
  "lane-closed": "Lane Closed",
  "narrow-lanes": "Narrow Lanes",
  other: "Other",
  rain: "Rain",
  "road-closed": "Road Closed",
  roadworks: "Roadworks",
  wind: "Wind",
};

const MAGNITUDE_LABEL: Record<string, { label: string; className: string }> = {
  unknown: { label: "Unknown", className: "magnitude-unknown" },
  minor: { label: "Minor", className: "magnitude-minor" },
  moderate: { label: "Moderate", className: "magnitude-moderate" },
  major: { label: "Major", className: "magnitude-major" },
  indefinite: { label: "Indefinite", className: "magnitude-indefinite" },
};

function categoryLabel(category: string): string {
  return CATEGORY_LABEL[category] ?? category;
}

function magnitudeInfo(magnitude: string): { label: string; className: string } {
  return MAGNITUDE_LABEL[magnitude] ?? MAGNITUDE_LABEL.unknown;
}

function formatDelay(seconds: number | undefined): string | null {
  if (!seconds || seconds <= 0) return null;
  const mins = Math.round(seconds / 60);
  return mins > 0 ? `${mins} min delay` : `${seconds}s delay`;
}

// ---------------------------------------------------------------------------
// Geometry helpers
// ---------------------------------------------------------------------------

function parseBbox(bboxStr: string): Bbox {
  const parts = bboxStr.split(",").map(Number);
  return [parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0, parts[3] ?? 0];
}

function getFeatureCenter(feature: IncidentFeature): [number, number] | null {
  const geom = feature.geometry;
  if (geom.type === "Point") {
    const [lng, lat] = geom.coordinates;
    return [lng, lat];
  }
  if (geom.type === "LineString" && geom.coordinates.length > 0) {
    const mid = geom.coordinates[Math.floor(geom.coordinates.length / 2)];
    return [mid[0], mid[1]];
  }
  return null;
}

function fitMapToAreas(areas: VizArea[]): void {
  if (!map || areas.length === 0) return;
  const [minLon, minLat, maxLon, maxLat] = bboxUnion(areas.map((a) => parseBbox(a.bbox)));
  map.mapLibreMap.fitBounds(
    [
      [minLon, minLat],
      [maxLon, maxLat],
    ],
    { padding: 48, duration: 800, maxZoom: 15 }
  );
}

function flyToFeature(feature: IncidentFeature): void {
  if (!map) return;
  const center = getFeatureCenter(feature);
  if (!center) return;
  map.mapLibreMap.flyTo({ center, zoom: 15, duration: 1000, essential: true });
}

// ---------------------------------------------------------------------------
// Focus / detail card
// ---------------------------------------------------------------------------

function highlightListItem(id: string | null): void {
  const list = el("incident-list");
  if (!list) return;
  for (const item of Array.from(list.querySelectorAll(".incident-item"))) {
    item.classList.toggle("active", item.getAttribute("data-id") === id);
  }
}

function renderDetailCard(feature: IncidentFeature): void {
  const card = el("incident-detail-card");
  if (!card) return;

  const props = feature.properties;
  const magnitude = magnitudeInfo(props.magnitudeOfDelay);
  const delayText = formatDelay(props.delayInSeconds);
  const route = [props.from, props.to].filter(Boolean).join(" → ");
  const events = (props.events ?? []).map((e) => escapeHtml(e.description)).join(", ");

  card.innerHTML = `
    <button type="button" class="detail-close" aria-label="Close">&times;</button>
    <div class="detail-title">${escapeHtml(categoryLabel(props.category))}</div>
    <span class="magnitude-badge ${magnitude.className}">${escapeHtml(magnitude.label)}</span>
    ${route ? `<div class="detail-row">${escapeHtml(route)}</div>` : ""}
    ${delayText ? `<div class="detail-row">${escapeHtml(delayText)}</div>` : ""}
    ${props.lengthInMeters ? `<div class="detail-row">${Math.round(props.lengthInMeters)} m</div>` : ""}
    ${events ? `<div class="detail-row detail-events">${events}</div>` : ""}
  `;
  card.classList.remove("hidden");
  card.querySelector(".detail-close")?.addEventListener("click", clearFocus);
}

function focusIncident(id: string): void {
  focusedId = id;
  overlay?.setFocus([id]);
  highlightListItem(id);

  const feature = featuresById.get(id);
  if (feature) {
    flyToFeature(feature);
    renderDetailCard(feature);
  }
}

function clearFocus(): void {
  focusedId = null;
  overlay?.setFocus(null);
  highlightListItem(null);
  hideDetailCard();
}

function handleOverlayClick(feature: TrafficIncident): void {
  const id = feature.properties?.id;
  if (typeof id === "string") focusIncident(id);
}

// ---------------------------------------------------------------------------
// Incident list + area filter chips
// ---------------------------------------------------------------------------

function renderIncidentItem(feature: IncidentFeature): HTMLElement {
  const props = feature.properties;
  const magnitude = magnitudeInfo(props.magnitudeOfDelay);
  const delayText = formatDelay(props.delayInSeconds);
  const route = [props.from, props.to].filter(Boolean).join(" → ");

  const item = document.createElement("button");
  item.type = "button";
  item.className = "incident-item" + (props.id === focusedId ? " active" : "");
  item.setAttribute("data-id", props.id);
  item.innerHTML = `
    <div class="incident-item-header">
      <span class="incident-category">${escapeHtml(categoryLabel(props.category))}</span>
      <span class="magnitude-badge ${magnitude.className}">${escapeHtml(magnitude.label)}</span>
    </div>
    ${route ? `<div class="incident-route">${escapeHtml(route)}</div>` : ""}
    ${delayText ? `<div class="incident-delay">${escapeHtml(delayText)}</div>` : ""}
  `;
  item.addEventListener("click", () => focusIncident(props.id));
  return item;
}

function renderIncidentList(features: IncidentFeature[]): void {
  const list = el("incident-list");
  const empty = el("empty-state");
  if (!list || !empty) return;

  list.innerHTML = "";

  if (features.length === 0) {
    empty.classList.remove("hidden");
    return;
  }
  empty.classList.add("hidden");

  const byArea = new Map<string, IncidentFeature[]>();
  for (const feature of features) {
    const name = feature.properties.areaName;
    const bucket = byArea.get(name);
    if (bucket) {
      bucket.push(feature);
    } else {
      byArea.set(name, [feature]);
    }
  }

  for (const [areaName, areaFeatures] of byArea) {
    const heading = document.createElement("h3");
    heading.className = "area-heading";
    heading.textContent = `${areaName} (${areaFeatures.length})`;
    list.appendChild(heading);

    for (const feature of areaFeatures) {
      list.appendChild(renderIncidentItem(feature));
    }
  }
}

function renderAreaFilters(names: string[]): void {
  const container = el("area-filters");
  if (!container) return;
  container.innerHTML = "";

  // Only worth showing filter chips when there's more than one area to split by.
  if (names.length <= 1) return;

  const makeChip = (label: string, value: string | null): HTMLButtonElement => {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "area-chip tta-chip" + (activeAreaFilter === value ? " active" : "");
    chip.textContent = label;
    chip.addEventListener("click", () => void selectAreaFilter(value));
    return chip;
  };

  container.appendChild(makeChip("All areas", null));
  for (const name of names) {
    container.appendChild(makeChip(name, name));
  }
}

async function applyFilter(): Promise<void> {
  if (!overlay) return;

  const filtered = activeAreaFilter
    ? allFeatures.filter((f) => f.properties.areaName === activeAreaFilter)
    : allFeatures;

  const collection: TrafficIncidentDetails = {
    type: "FeatureCollection",
    features: filtered,
  };
  await overlay.show(collection);

  if (focusedId && !filtered.some((f) => f.properties.id === focusedId)) {
    clearFocus();
  }

  renderIncidentList(filtered);
}

async function selectAreaFilter(name: string | null): Promise<void> {
  activeAreaFilter = name;
  renderAreaFilters(areaNames);
  await applyFilter();
}

// ---------------------------------------------------------------------------
// MCP App lifecycle — shared bootstrap owns parse/gates/map creation.
// ---------------------------------------------------------------------------

bootstrapVizApp<VizPayload>({
  name: "tta-traffic-incidents",
  panelId: "incident-panel",
  errorMessage: "Failed to fetch traffic incidents",
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- viz shape is unverified after a cache-miss fallback
  validate: (viz): viz is VizPayload => Array.isArray((viz as any)?.areas),
  resetUI: hideDetailCard,
  render: async ({ map: m, viz }) => {
    map = m;

    if (!overlay) {
      overlay = await TrafficIncidentOverlayModule.get(map);
    }
    if (!overlayClickBound && overlay) {
      overlay.events.on("click", handleOverlayClick);
      overlayClickBound = true;
    }

    areaNames = viz.areas.map((a) => a.name);
    activeAreaFilter = null;
    clearFocus();

    // The same incident can be returned by two overlapping bboxes — dedupe by
    // the TomTom-global incident id (first area wins) so MapLibre feature ids
    // stay unique and the list shows each incident once.
    allFeatures = dedupeBy(
      viz.areas.flatMap((area) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- raw API shape, validated by the SDK parser
        const parsed = parseTrafficIncidentDetailsResponse(area.incidents as any);
        return parsed.features.map((f) => ({
          ...f,
          properties: { ...f.properties, areaName: area.name },
        })) as IncidentFeature[];
      }),
      (f) => f.properties.id
    );
    featuresById = new Map(allFeatures.map((f) => [f.properties.id, f]));

    setPanelVisible(true);
    renderAreaFilters(areaNames);
    await applyFilter();
    fitMapToAreas(viz.areas);
  },
  teardown: () => {
    overlay?.setVisible(false);
  },
});
