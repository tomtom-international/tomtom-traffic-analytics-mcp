/*
 * Copyright (C) 2025 TomTom NV
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 *
 * Visualization data cache service using node-cache.
 * Stores full API responses with short TTL for MCP Apps to retrieve.
 * Per-process only: in multi-process/load-balanced HTTP deployments a
 * `tomtom-get-viz-data` call routed to a different process misses the cache
 * and the app falls back to its localStorage copy or the 'expired' state.
 * viz_ids are unguessable UUIDs but not session-bound.
 */

import NodeCache from "node-cache";
import { randomUUID } from "node:crypto";
import { logger } from "../../utils/logger";

/**
 * Cache configuration
 * - stdTTL: Time to live in seconds (5 minutes default)
 * - checkperiod: Automatic delete check interval (1 minute)
 * - useClones: Set to false for performance (we trust our data)
 */
const CACHE_CONFIG = {
  stdTTL: 300, // 5 minutes - short-lived cache for visualization data
  checkperiod: 60, // Check for expired keys every 60 seconds
  useClones: false, // Don't clone objects for better performance
};

/**
 * Singleton cache instance
 * This is shared across all requests in both stdio and HTTP modes
 */
const vizCache = new NodeCache(CACHE_CONFIG);

/**
 * Hard bound on resident entries. Every tool call stores its full raw
 * upstream response (multi-MB for multi-bbox incidents or area reports) for
 * the whole TTL window, and nothing deletes entries on consumption — without
 * a bound, a burst of tool calls retains all of them for 5 minutes.
 * node-cache has no LRU support, so insertion order (FIFO) is tracked here;
 * TTL-expired keys are pruned from the queue lazily via `has()`.
 */
const MAX_VIZ_ENTRIES = 50;
const insertionOrder: string[] = [];

/**
 * Store visualization data in cache and return unique viz_id
 *
 * @param data - Full API response data to cache
 * @returns Unique viz_id (UUID)
 */
export function storeVizData(data: unknown): string {
  const vizId = randomUUID();
  vizCache.set(vizId, data);
  insertionOrder.push(vizId);

  // Drop already-expired keys from the queue, then evict oldest beyond the bound.
  while (insertionOrder.length > 0 && !vizCache.has(insertionOrder[0])) {
    insertionOrder.shift();
  }
  while (insertionOrder.length > MAX_VIZ_ENTRIES) {
    const oldest = insertionOrder.shift();
    if (oldest !== undefined) {
      vizCache.del(oldest);
      logger.debug(`vizCache: evicted ${oldest} (FIFO bound ${MAX_VIZ_ENTRIES})`);
    }
  }

  logger.debug(`vizCache: stored ${vizId}`);
  return vizId;
}

/**
 * Retrieve visualization data from cache by viz_id
 *
 * @param vizId - Unique visualization ID
 * @returns Cached data or undefined if not found/expired
 */
export function getVizData(vizId: string): unknown | undefined {
  return vizCache.get(vizId);
}

/**
 * Delete visualization data from cache
 * Useful for cleanup after app has consumed the data
 *
 * @param vizId - Unique visualization ID
 */
export function deleteVizData(vizId: string): void {
  vizCache.del(vizId);
  // Free the FIFO slot too — a ghost entry would count toward MAX_VIZ_ENTRIES
  // and evict a still-live entry prematurely.
  const queueIndex = insertionOrder.indexOf(vizId);
  if (queueIndex !== -1) {
    insertionOrder.splice(queueIndex, 1);
  }
}

/**
 * Get cache statistics for monitoring
 *
 * @returns Cache statistics object
 */
export function getCacheStats(): NodeCache.Stats {
  return vizCache.getStats();
}

/**
 * Clear all cached visualization data
 * Useful for testing or server shutdown
 */
export function clearVizCache(): void {
  insertionOrder.length = 0;
  vizCache.flushAll();
  logger.info("Cleared all visualization data from cache");
}
