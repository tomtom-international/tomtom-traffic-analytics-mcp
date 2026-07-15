/*
 * Copyright (C) 2025 TomTom Navigation B.V.
 * Licensed under the Apache License, Version 2.0
 */

import {
  TomTomMap,
  TrafficFlowModule,
  standardStyleIDs,
  type StandardStyleID,
} from "@tomtom-org/maps-sdk/map";
import { exposeMapForE2E } from "./e2e";

export interface MapControlsOptions {
  position?: "top-left" | "top-right" | "bottom-left" | "bottom-right";
  /** Initial style shown in the style selector. @default "standardLight" */
  initialStyle?: StandardStyleID;
  showStyleSelector?: boolean;
  showTrafficToggle?: boolean;
  initialTrafficEnabled?: boolean;
  /** Pass an existing TrafficFlowModule to control instead of creating a new one */
  externalTrafficModule?: TrafficFlowModule;
  /** Called after a style change once the new style has loaded. Use this to re-add custom sources/layers. */
  onStyleChange?: () => void;
}

/**
 * Creates map control widgets: a style selector covering every
 * `standardStyleIDs` option, plus an optional traffic-flow toggle.
 */
export async function createMapControls(
  map: TomTomMap,
  options: MapControlsOptions = {}
): Promise<{
  trafficModule: TrafficFlowModule | null;
  setStyle: (style: StandardStyleID) => void;
  setTrafficVisible: (visible: boolean) => void;
  destroy: () => void;
}> {
  exposeMapForE2E(map);

  const opts = {
    position: options.position ?? ("top-right" as const),
    initialStyle: options.initialStyle ?? ("standardLight" as StandardStyleID),
    showStyleSelector: options.showStyleSelector ?? true,
    showTrafficToggle: options.showTrafficToggle ?? true,
    initialTrafficEnabled: options.initialTrafficEnabled ?? false,
    externalTrafficModule: options.externalTrafficModule,
    onStyleChange: options.onStyleChange,
  };

  let trafficModule: TrafficFlowModule | null = null;
  let trafficEnabled = opts.initialTrafficEnabled;

  // Create container
  const container = document.createElement("div");
  container.className = "map-controls";
  container.setAttribute("data-position", opts.position);

  // Initialize traffic module if needed (use external if provided)
  if (opts.showTrafficToggle) {
    if (opts.externalTrafficModule) {
      trafficModule = opts.externalTrafficModule;
      // Always start with traffic off by default, regardless of external module's current state
      trafficModule.setVisible(opts.initialTrafficEnabled);
    } else {
      trafficModule = await TrafficFlowModule.get(map, { visible: opts.initialTrafficEnabled });
    }
  }

  // Style selector
  let styleSelect: HTMLSelectElement | null = null;
  if (opts.showStyleSelector) {
    styleSelect = document.createElement("select");
    styleSelect.className = "map-control-select style-select";
    styleSelect.title = "Change map style";
    for (const styleId of standardStyleIDs) {
      const option = document.createElement("option");
      option.value = styleId;
      option.textContent = styleId;
      if (styleId === opts.initialStyle) {
        option.selected = true;
      }
      styleSelect.appendChild(option);
    }
    styleSelect.addEventListener("change", () => {
      const styleId = styleSelect!.value as StandardStyleID;
      map.setStyle(styleId);
      if (opts.onStyleChange) {
        map.mapLibreMap.once("style.load", () => opts.onStyleChange!());
      }
    });
    container.appendChild(styleSelect);
  }

  // Traffic toggle button
  let trafficBtn: HTMLButtonElement | null = null;
  if (opts.showTrafficToggle && trafficModule) {
    trafficBtn = document.createElement("button");
    trafficBtn.className = `map-control-btn traffic-btn ${trafficEnabled ? "active" : ""}`;
    trafficBtn.title = "Toggle traffic flow";
    trafficBtn.innerHTML = getTrafficIcon();
    trafficBtn.addEventListener("click", () => {
      trafficEnabled = !trafficEnabled;
      trafficModule!.setVisible(trafficEnabled);
      trafficBtn!.classList.toggle("active", trafficEnabled);
    });
    container.appendChild(trafficBtn);
  }

  // Add to map container
  const mapContainer = map.mapLibreMap.getContainer();
  mapContainer.appendChild(container);

  // Add styles
  injectStyles();

  return {
    trafficModule,
    setStyle: (styleId: StandardStyleID) => {
      map.setStyle(styleId);
      if (styleSelect) {
        styleSelect.value = styleId;
      }
      if (opts.onStyleChange) {
        map.mapLibreMap.once("style.load", () => opts.onStyleChange!());
      }
    },
    setTrafficVisible: (visible: boolean) => {
      trafficEnabled = visible;
      if (trafficModule) {
        trafficModule.setVisible(visible);
      }
      if (trafficBtn) {
        trafficBtn.classList.toggle("active", visible);
      }
    },
    destroy: () => {
      container.remove();
    },
  };
}

function getTrafficIcon(): string {
  return `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <path d="M12 2L2 7l10 5 10-5-10-5z"/>
    <path d="M2 17l10 5 10-5"/>
    <path d="M2 12l10 5 10-5"/>
  </svg>`;
}

let stylesInjected = false;

function injectStyles(): void {
  if (stylesInjected) return;
  stylesInjected = true;

  const style = document.createElement("style");
  style.textContent = `
    .map-controls {
      position: absolute;
      z-index: 1000;
      display: flex;
      flex-direction: column;
      gap: 8px;
      padding: 10px;
    }

    .map-controls[data-position="top-right"] {
      top: 10px;
      right: 10px;
    }

    .map-controls[data-position="top-left"] {
      top: 10px;
      left: 10px;
    }

    .map-controls[data-position="bottom-right"] {
      bottom: 30px;
      right: 10px;
    }

    .map-controls[data-position="bottom-left"] {
      bottom: 30px;
      left: 10px;
    }

    .map-control-select {
      height: 36px;
      border: none;
      border-radius: 8px;
      background: white;
      color: #333;
      padding: 0 8px;
      cursor: pointer;
      box-shadow: 0 2px 6px rgba(0, 0, 0, 0.15);
      font-size: 13px;
    }

    .map-control-btn {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 36px;
      height: 36px;
      border: none;
      border-radius: 8px;
      background: white;
      color: #333;
      cursor: pointer;
      box-shadow: 0 2px 6px rgba(0, 0, 0, 0.15);
      transition: all 0.2s ease;
    }

    .map-control-btn:hover {
      background: #f5f5f5;
      transform: scale(1.05);
    }

    .map-control-btn:active {
      transform: scale(0.95);
    }

    .map-control-btn.active {
      background: #2196F3;
      color: white;
    }

    .map-control-btn.active:hover {
      background: #1976D2;
    }

    .map-control-btn svg {
      width: 20px;
      height: 20px;
    }
  `;
  document.head.appendChild(style);
}
