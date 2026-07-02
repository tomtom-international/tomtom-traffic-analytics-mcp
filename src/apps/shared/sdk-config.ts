/*
 * Copyright (C) 2025 TomTom Navigation B.V.
 * Licensed under the Apache License, Version 2.0
 */

import type { App } from "@modelcontextprotocol/ext-apps";
import { TomTomConfig } from "@tomtom-org/maps-sdk/core";
import { getAPIKey } from "./api-key";

/**
 * Track whether TomTom config has been initialized
 */
let configInitialized = false;

/**
 * Ensures TomTom SDK config is initialized, fetching the API key if necessary.
 *
 * @param app - Connected MCP App instance
 * @returns `true` once the SDK is configured; `false` if the API key could
 *   not be fetched, in which case the caller should render a "map
 *   unavailable" state instead of attempting to create a map.
 */
export async function ensureTomTomConfigured(app: App): Promise<boolean> {
  if (configInitialized) {
    return true;
  }

  try {
    const apiKey = await getAPIKey(app);
    TomTomConfig.instance.put({ apiKey, language: "en-GB" });
    configInitialized = true;
    return true;
  } catch (error) {
    console.error("Failed to configure TomTom SDK:", error);
    return false;
  }
}
