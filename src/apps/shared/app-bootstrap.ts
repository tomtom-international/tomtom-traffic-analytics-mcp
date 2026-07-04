/*
 * Copyright (C) 2025 TomTom Navigation B.V.
 * Licensed under the Apache License, Version 2.0
 */

import { App } from "@modelcontextprotocol/ext-apps";
import { TomTomMap } from "@tomtom-org/maps-sdk/map";
import { ensureTomTomConfigured } from "./sdk-config";
import { extractFullData } from "./viz-data";
import { shouldShowUI, showMapUI, hideMapUI, showErrorUI } from "./ui-visibility";
import { el, hideWaiting } from "./dom";
import { exposeMapForE2E } from "./e2e";

export const EXPIRED_MESSAGE = "Visualization data expired — re-run the tool";
export const NO_KEY_MESSAGE = "TOMTOM_API_KEY not configured — map unavailable";

export interface VizAppOptions<T> {
  /** App identifier, e.g. "tta-traffic-flow" — App() name and log prefix. */
  name: string;
  /** DOM id of the side panel hidden on error/hidden states. */
  panelId: string;
  /** Message shown when the tool result itself is an error. */
  errorMessage: string;
  /** Type guard for the viz payload; `false` shows the "expired" state. */
  validate: (viz: unknown) => viz is T;
  /** Extra UI cleanup applied on every non-render path (e.g. hide a detail card). */
  resetUI?: () => void;
  /** Renders the payload. `map` is created lazily once and reused across calls. */
  render: (ctx: { app: App; map: TomTomMap; viz: T }) => Promise<void>;
  /** Hides app-specific map modules on host teardown. */
  teardown?: () => void;
}

/**
 * Shared MCP-app lifecycle: parse the tool result, gate on show_ui / API key /
 * payload validity (with the standard error UIs), lazily create the standard
 * map, and hand off to the app's render callback.
 *
 * Registers all hooks before connect() (ext-apps 1.7 rule) and connects —
 * call once at module scope; per-app code is just its renderer.
 */
export function bootstrapVizApp<T>(options: VizAppOptions<T>): App {
  const app = new App({ name: options.name, version: "1.0.0" });
  let map: TomTomMap | undefined;

  const setPanelVisible = (visible: boolean): void => {
    el(options.panelId)?.classList.toggle("hidden", !visible);
  };

  const fail = (message: string): void => {
    setPanelVisible(false);
    options.resetUI?.();
    showErrorUI(message);
  };

  app.ontoolinput = async (): Promise<void> => {
    hideWaiting();
  };

  app.ontoolresult = async (result): Promise<void> => {
    hideWaiting();

    if (result.isError) {
      fail(options.errorMessage);
      return;
    }

    const rawText = (result.content?.[0] as { text?: string } | undefined)?.text ?? "{}";
    const parsedResp = JSON.parse(rawText);

    if (!shouldShowUI(parsedResp)) {
      setPanelVisible(false);
      options.resetUI?.();
      hideMapUI();
      return;
    }

    if (!(await ensureTomTomConfigured(app))) {
      fail(NO_KEY_MESSAGE);
      return;
    }

    const viz = await extractFullData(app, parsedResp);
    if (!options.validate(viz)) {
      fail(EXPIRED_MESSAGE);
      return;
    }

    showMapUI();

    map ??= new TomTomMap({
      style: "standardLight",
      mapLibre: { container: "sdk-map", center: [0, 0], zoom: 2 },
    });
    exposeMapForE2E(map);

    await options.render({ app, map, viz });
  };

  app.onteardown = async (): Promise<Record<string, never>> => {
    options.teardown?.();
    return {};
  };

  void (async () => {
    try {
      await app.connect();
    } catch (error) {
      // Expected when opened standalone (no MCP host) — e.g. local smoke testing.
      console.warn(`[${options.name}] Failed to connect to MCP host:`, error);
    }
  })();

  return app;
}
