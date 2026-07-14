/*
 * Copyright (C) 2025 TomTom Navigation B.V.
 * Licensed under the Apache License, Version 2.0
 */

import type { App } from "@modelcontextprotocol/ext-apps";

/**
 * Calls the app-only `tomtom-get-route-details` server tool and parses its
 * `{ routes: [...] }` payload from content[0].text (same transport shape
 * as tomtom-get-viz-data — see shared/viz-data.ts).
 */
export async function fetchRouteDetails(app: App, routeIds: number[]): Promise<unknown[]> {
  const result = await app.callServerTool({
    name: "tomtom-get-route-details",
    arguments: { routeIds },
  });
  if (result.isError) throw new Error("Server returned error when fetching route details");
  const content = result.content?.[0];
  if (!content || content.type !== "text" || !content.text) {
    throw new Error("Invalid route details response format");
  }
  const parsed = JSON.parse(content.text) as { routes?: unknown[] };
  if (!parsed || !Array.isArray(parsed.routes)) {
    throw new Error("Unexpected route details shape");
  }
  return parsed.routes;
}
