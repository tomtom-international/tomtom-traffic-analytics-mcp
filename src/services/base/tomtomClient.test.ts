/*
 * Copyright (C) 2025 TomTom NV
 * Licensed under the Apache License, Version 2.0
 */

import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from "vitest";

// Save original environment before anything else
const originalEnv = { ...process.env };

// Set environment variables
process.env.TOMTOM_API_KEY = "test-api-key";
process.env.TOMTOM_MOVE_PORTAL_KEY = "test-move-portal-key";

// Mock axios BEFORE importing the module that uses it
vi.mock("axios", async (importOriginal) => {
  const actual = (await importOriginal()) as any;
  const mockInterceptors = {
    request: { use: vi.fn() },
    response: { use: vi.fn() },
  };
  const mockAxiosCreate = vi.fn().mockReturnValue({
    get: vi.fn(),
    post: vi.fn(),
    defaults: {
      baseURL: "https://api.tomtom.com",
      headers: {
        "TomTom-User-Agent": "TomTomTrafficMCPSDK/1.0.4",
      },
    },
    interceptors: mockInterceptors,
  });
  return {
    ...actual,
    create: mockAxiosCreate,
    isAxiosError: vi.fn(),
  };
});

// Now import the module under test
import {
  validateMovePortalApiKey,
  validateTomTomApiKey,
  API_VERSION,
  runWithSessionContext,
  getSessionMovePortalKey,
  getSessionApiKey,
  getEffectiveMovePortalKey,
  getEffectiveApiKey,
  setHttpMode,
  movePortalAPIClient,
  trafficAPIClient,
} from "./tomtomClient";

describe("TomTom Client", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.TOMTOM_API_KEY = "test-api-key";
    process.env.TOMTOM_MOVE_PORTAL_KEY = "test-move-portal-key";
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    process.env.TOMTOM_API_KEY = "test-api-key";
    process.env.TOMTOM_MOVE_PORTAL_KEY = "test-move-portal-key";
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  describe("API key validation", () => {
    it("validates Move Portal API key when key exists", () => {
      expect(() => validateMovePortalApiKey()).not.toThrow();
    });

    it("validates TomTom API key when key exists", () => {
      expect(() => validateTomTomApiKey()).not.toThrow();
    });

    it("throws when Move Portal key is not set and no session context", () => {
      delete process.env.TOMTOM_MOVE_PORTAL_KEY;
      expect(() => validateMovePortalApiKey()).toThrow("Move Portal API key is not set");
    });

    it("throws when TomTom API key is not set and no session context", () => {
      delete process.env.TOMTOM_API_KEY;
      expect(() => validateTomTomApiKey()).toThrow("TomTom API key is not set");
    });
  });

  describe("API version constants", () => {
    it("exports correct API version constants", () => {
      expect(API_VERSION).toEqual({
        SEARCH: 2,
        GEOCODING: 2,
        ROUTING: 1,
        TRAFFIC: 5,
        TRAFFIC_FLOW: 4,
        MAP: 1,
      });
    });
  });

  describe("AsyncLocalStorage session context", () => {
    it("getSessionMovePortalKey returns undefined outside context", () => {
      expect(getSessionMovePortalKey()).toBeUndefined();
    });

    it("getSessionApiKey returns undefined outside context", () => {
      expect(getSessionApiKey()).toBeUndefined();
    });

    it("runWithSessionContext provides keys within callback", () => {
      runWithSessionContext("move-key-123", "api-key-456", () => {
        expect(getSessionMovePortalKey()).toBe("move-key-123");
        expect(getSessionApiKey()).toBe("api-key-456");
      });
    });

    it("session keys are not available after context exits", () => {
      runWithSessionContext("mk", "ak", () => {
        // Inside context
      });
      // After context
      expect(getSessionMovePortalKey()).toBeUndefined();
      expect(getSessionApiKey()).toBeUndefined();
    });

    it("getEffectiveMovePortalKey prefers session key over env var", () => {
      runWithSessionContext("session-move-key", "", () => {
        expect(getEffectiveMovePortalKey()).toBe("session-move-key");
      });
    });

    it("getEffectiveApiKey prefers session key over env var", () => {
      runWithSessionContext("", "session-api-key", () => {
        expect(getEffectiveApiKey()).toBe("session-api-key");
      });
    });

    it("getEffectiveMovePortalKey falls back to env var when no session", () => {
      expect(getEffectiveMovePortalKey()).toBe("test-move-portal-key");
    });

    it("getEffectiveApiKey falls back to env var when no session", () => {
      expect(getEffectiveApiKey()).toBe("test-api-key");
    });
  });

  describe("setHttpMode", () => {
    it("updates User-Agent headers on both clients", () => {
      setHttpMode();

      expect(movePortalAPIClient.defaults.headers["TomTom-User-Agent"]).toContain("Http");
      expect(trafficAPIClient.defaults.headers["TomTom-User-Agent"]).toContain("Http");
    });
  });
});
