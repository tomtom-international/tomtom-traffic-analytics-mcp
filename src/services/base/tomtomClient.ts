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
 */

import axios, { AxiosInstance } from "axios";
import dotenv from "dotenv";
import { AsyncLocalStorage } from "async_hooks";
import { logger } from "../../utils/logger";

// Load environment variables. `quiet: true` suppresses dotenv's stdout
// tips/warnings, which would otherwise corrupt the MCP JSON-RPC stream
// when the server runs over stdio (e.g. inside an MCPB extension).
dotenv.config({ quiet: true });

/**
 * TomTom API configuration constants
 */
export const CONFIG = {
  VERSION: "1.0.4", // Version from package.json
  BASE_URL: "https://api.tomtom.com",
} as const;

// Variable to track if we're running in HTTP server mode
export let isHttpMode = false;

/**
 * Request context for session-specific API key isolation.
 * Used in HTTP mode to support per-request API keys via AsyncLocalStorage.
 */
interface RequestContext {
  movePortalKey: string;
  apiKey: string;
}

/**
 * AsyncLocalStorage for proper per-request context isolation.
 * Ensures multiple concurrent HTTP sessions don't interfere with each other.
 */
const requestContext = new AsyncLocalStorage<RequestContext>();

/**
 * Get session-specific Move Portal API key from current async context
 */
export function getSessionMovePortalKey(): string | undefined {
  const context = requestContext.getStore();
  return context?.movePortalKey || undefined;
}

/**
 * Get session-specific TomTom API key from current async context
 */
export function getSessionApiKey(): string | undefined {
  const context = requestContext.getStore();
  return context?.apiKey || undefined;
}

/**
 * Run function within a session context (for HTTP requests).
 * Provides per-request API key isolation via AsyncLocalStorage.
 */
export function runWithSessionContext<T>(movePortalKey: string, apiKey: string, fn: () => T): T {
  return requestContext.run({ movePortalKey, apiKey }, fn);
}

/**
 * Gets the MOVE Portal API key from environment variables
 */
function getMovePortalApiKeyFromEnv(): string | undefined {
  const apiKey = process.env.TOMTOM_MOVE_PORTAL_KEY;

  if (!apiKey) {
    const errorMessage = "ERROR: TOMTOM_MOVE_PORTAL_KEY environment variable is not set!";
    logger.error(errorMessage);
    logger.error(
      "Please set your MOVE Portal API key in the .env file or as an environment variable."
    );
    logger.error("You can get a key from https://move.tomtom.com/");
  }

  return apiKey;
}

/**
 * Gets the TomTom API key from environment variables
 */
function getTomTomApiKeyFromEnv(): string | undefined {
  const apiKey = process.env.TOMTOM_API_KEY;

  if (!apiKey) {
    const errorMessage = "ERROR: TOMTOM_API_KEY environment variable is not set!";
    logger.error(errorMessage);
    logger.error("Please set your Traffic API key in the .env file or as an environment variable.");
    logger.error("You can get a key from https://developer.tomtom.com/");
  }

  return apiKey;
}

/**
 * Get the effective Move Portal API key (session context first, then env var fallback)
 */
export function getEffectiveMovePortalKey(): string | undefined {
  return getSessionMovePortalKey() || getMovePortalApiKeyFromEnv();
}

/**
 * Get the effective TomTom API key (session context first, then env var fallback)
 */
export function getEffectiveApiKey(): string | undefined {
  return getSessionApiKey() || getTomTomApiKeyFromEnv();
}

/**
 * Core Axios client for MOVE Portal API requests.
 * API key is injected dynamically via request interceptor (supports per-request keys in HTTP mode).
 */
export const movePortalAPIClient: AxiosInstance = axios.create({
  baseURL: CONFIG.BASE_URL,
  paramsSerializer: { indexes: null },
  headers: {
    "TomTom-User-Agent": `TomTomTrafficMCPSDK/${CONFIG.VERSION}`,
  },
});

// Request interceptor to add Move Portal API key dynamically
movePortalAPIClient.interceptors.request.use(
  (config) => {
    const apiKey = getEffectiveMovePortalKey();
    if (apiKey && !config.params?.key) {
      config.params = { ...config.params, key: apiKey };
    }
    return config;
  },
  (error) => Promise.reject(error)
);

/**
 * Core Axios client for Traffic API requests.
 * API key is injected dynamically via request interceptor (supports per-request keys in HTTP mode).
 */
export const trafficAPIClient: AxiosInstance = axios.create({
  baseURL: CONFIG.BASE_URL,
  paramsSerializer: { indexes: null },
  headers: {
    "TomTom-User-Agent": `TomTomTrafficMCPSDK/${CONFIG.VERSION}`,
  },
});

// Request interceptor to add TomTom API key dynamically
trafficAPIClient.interceptors.request.use(
  (config) => {
    const apiKey = getEffectiveApiKey();
    if (apiKey && !config.params?.key) {
      config.params = { ...config.params, key: apiKey };
    }
    return config;
  },
  (error) => Promise.reject(error)
);

/**
 * Set the mode to HTTP server mode.
 * Updates TomTom-User-Agent headers on both clients.
 */
export function setHttpMode(): void {
  isHttpMode = true;

  const userAgent = `TomTomTrafficMCPSDKHttp/${CONFIG.VERSION}`;

  if (movePortalAPIClient.defaults.headers) {
    movePortalAPIClient.defaults.headers["TomTom-User-Agent"] = userAgent;
  }
  if (trafficAPIClient.defaults.headers) {
    trafficAPIClient.defaults.headers["TomTom-User-Agent"] = userAgent;
  }

  logger.info(`TomTom Traffic MCP client set to HTTP mode (User-Agent: ${userAgent})`);
}

/**
 * Helper function to validate that Move Portal API key exists before making calls
 * @throws {Error} If the Move Portal API key is not set
 */
export function validateMovePortalApiKey(): void {
  const apiKey = getEffectiveMovePortalKey();
  if (!apiKey) {
    throw new Error(
      "Move Portal API key is not set. Please set TOMTOM_MOVE_PORTAL_KEY environment variable."
    );
  }
}

/**
 * Helper function to validate that TomTom API key exists before making calls
 * @throws {Error} If the TomTom API key is not set
 */
export function validateTomTomApiKey(): void {
  const apiKey = getEffectiveApiKey();
  if (!apiKey) {
    throw new Error("TomTom API key is not set. Please set TOMTOM_API_KEY environment variable.");
  }
}

/**
 * Export the getApiKeyFromEnv function for access in other modules
 */
export { getMovePortalApiKeyFromEnv, getTomTomApiKeyFromEnv };

/**
 * API version constants
 * Each API has its own version number which can change independently
 */
export const API_VERSION = {
  SEARCH: 2,
  GEOCODING: 2,
  ROUTING: 1,
  TRAFFIC: 5,
  TRAFFIC_FLOW: 4,
  MAP: 1,
} as const;
