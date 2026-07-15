/*
 * Copyright (C) 2025 TomTom Navigation B.V.
 * Licensed under the Apache License, Version 2.0
 */

import type { App } from "@modelcontextprotocol/ext-apps";

/**
 * Calls the app-only `tomtom-get-junction-live` server tool and parses its
 * `{ junctions: [...] }` payload from content[0].text (same transport shape
 * as tomtom-get-viz-data — see shared/viz-data.ts).
 */
export async function fetchJunctionLive(app: App, junctionIds: string[]): Promise<unknown[]> {
  const result = await app.callServerTool({
    name: "tomtom-get-junction-live",
    arguments: { junctionIds },
  });
  if (result.isError) throw new Error("Server returned error when fetching live data");
  const content = result.content?.[0];
  if (!content || content.type !== "text" || !content.text) {
    throw new Error("Invalid live data response format");
  }
  const parsed = JSON.parse(content.text) as { junctions?: unknown[] };
  if (!parsed || !Array.isArray(parsed.junctions)) {
    throw new Error("Unexpected live data shape");
  }
  return parsed.junctions;
}
