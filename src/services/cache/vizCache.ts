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
 * Store visualization data in cache and return unique viz_id
 *
 * @param data - Full API response data to cache
 * @returns Unique viz_id (UUID)
 */
export function storeVizData(data: unknown): string {
  const vizId = randomUUID();
  vizCache.set(vizId, data);
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
  vizCache.flushAll();
  logger.info("Cleared all visualization data from cache");
}
