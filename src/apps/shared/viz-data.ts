/*
 * Copyright (C) 2025 TomTom Navigation B.V.
 * Licensed under the Apache License, Version 2.0
 */

import type { App } from "@modelcontextprotocol/ext-apps";
import { selectEvictionKeys } from "./viz-eviction";

const VIZ_CACHE_PREFIX = "tta-viz-";
const VIZ_CACHE_MAX_ENTRIES = 20;

/** localStorage wrapper: timestamp + payload, so eviction is oldest-first. */
interface CachedViz {
  t: number;
  data: unknown;
}

/**
 * Save visualization data to localStorage for offline/reconnect scenarios.
 * Entries are wrapped with a stored timestamp; eviction removes the oldest
 * entries first. Silently fails if localStorage is unavailable or full.
 */
function saveToLocalCache(vizId: string, data: unknown): void {
  try {
    const wrapper: CachedViz = { t: Date.now(), data };
    localStorage.setItem(VIZ_CACHE_PREFIX + vizId, JSON.stringify(wrapper));

    const entries = Object.keys(localStorage)
      .filter((k) => k.startsWith(VIZ_CACHE_PREFIX))
      .map((key) => {
        try {
          const parsed = JSON.parse(localStorage.getItem(key) ?? "null") as CachedViz | null;
          return { key, t: typeof parsed?.t === "number" ? parsed.t : 0 };
        } catch {
          return { key, t: 0 };
        }
      });
    for (const key of selectEvictionKeys(entries, VIZ_CACHE_MAX_ENTRIES)) {
      localStorage.removeItem(key);
    }
  } catch {
    // localStorage unavailable or quota exceeded — silently continue
  }
}

/**
 * Load visualization data from localStorage.
 * Returns null if not found or localStorage is unavailable.
 */
function loadFromLocalCache(vizId: string): unknown {
  try {
    const raw = localStorage.getItem(VIZ_CACHE_PREFIX + vizId);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CachedViz | unknown;
    // Wrapped entry — unwrap; anything else is a legacy raw payload.
    if (parsed && typeof parsed === "object" && "t" in parsed && "data" in parsed) {
      return (parsed as CachedViz).data;
    }
    return parsed;
  } catch {
    return null;
  }
}

/**
 * Fetch full visualization data from server cache using viz_id
 *
 * @param app - Connected MCP App instance
 * @param vizId - Unique visualization ID from the tool response _meta
 * @returns Promise resolving to the full cached data
 * @throws {Error} If data cannot be fetched
 */
async function fetchVizData(app: App, vizId: string): Promise<unknown> {
  const result = await app.callServerTool({
    name: "tomtom-get-viz-data",
    arguments: { viz_id: vizId },
  });

  if (result.isError) {
    throw new Error("Failed to fetch visualization data from cache");
  }

  if (!result.content || result.content.length === 0) {
    throw new Error("No visualization data returned from server");
  }

  const content = result.content[0];
  if (content.type !== "text" || !content.text) {
    throw new Error("Invalid visualization data response format");
  }

  return JSON.parse(content.text);
}

/**
 * Extract full data from MCP tool response by fetching from server cache.
 * The response contains a viz_id in _meta which is used to retrieve cached data.
 * Falls back to client-side localStorage when server cache is unavailable
 * (e.g. conversation reopened after server restart), and returns `null`
 * when no cached payload can be found anywhere (callers show their
 * data-expired state).
 *
 * @param app - Connected MCP App instance
 * @param agentResponse - The tool response containing _meta.viz_id
 * @returns Promise resolving to the full data for visualization
 */
export async function extractFullData(
  app: App,
  agentResponse: { _meta?: { viz_id?: string } }
): Promise<unknown> {
  const vizId = agentResponse._meta?.viz_id;

  // Primary: fetch from server cache using viz_id
  if (vizId) {
    try {
      const data = await fetchVizData(app, vizId);
      saveToLocalCache(vizId, data);
      return data;
    } catch (e) {
      console.error("Failed to fetch viz data from server cache:", e);

      // Fallback: try client-side localStorage
      const cached = loadFromLocalCache(vizId);
      if (cached) {
        console.log("Loaded viz data from client-side cache for viz_id:", vizId);
        return cached;
      }
    }
  }

  // No cached payload anywhere (server cache expired/restarted AND no local
  // copy). The trimmed tool response can never satisfy an app's payload
  // guard, so return an explicit miss — apps render their "expired" state.
  return null;
}
