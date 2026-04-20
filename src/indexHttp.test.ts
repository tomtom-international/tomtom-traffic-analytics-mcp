/*
 * Copyright (C) 2025 TomTom NV
 * Licensed under the Apache License, Version 2.0
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Save and set env vars before any imports
const originalEnv = { ...process.env };
process.env.TOMTOM_MOVE_PORTAL_KEY = "test-move-portal-key";
process.env.TOMTOM_API_KEY = "test-api-key";

// Mock createServer — returns a minimal McpServer-like object
const mockClose = vi.fn();
const mockConnect = vi.fn();
vi.mock("./createServer", () => ({
  createServer: vi.fn(() => ({
    connect: mockConnect,
    close: mockClose,
  })),
}));

// Mock StreamableHTTPServerTransport
const mockHandleRequest = vi.fn();
const mockTransportClose = vi.fn();
vi.mock("@modelcontextprotocol/sdk/server/streamableHttp.js", () => ({
  StreamableHTTPServerTransport: vi.fn(() => ({
    handleRequest: mockHandleRequest,
    close: mockTransportClose,
  })),
}));

vi.mock("./utils/logger", () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

vi.mock("./services/base/tomtomClient", () => ({
  runWithSessionContext: vi.fn((_mk: string, _ak: string, fn: () => any) => fn()),
  setHttpMode: vi.fn(),
  getEffectiveMovePortalKey: vi.fn(() => "test-move-portal-key"),
  getEffectiveApiKey: vi.fn(() => "test-api-key"),
}));

import { createHttpServer, type HttpServerResult } from "./indexHttp";
import { VERSION } from "./version";

describe("indexHttp", () => {
  let serverResult: HttpServerResult;
  const TEST_PORT = 3990;

  beforeEach(async () => {
    vi.clearAllMocks();
    process.env.TOMTOM_MOVE_PORTAL_KEY = "test-move-portal-key";
    process.env.TOMTOM_API_KEY = "test-api-key";
    serverResult = await createHttpServer({
      port: TEST_PORT,
    });
  });

  afterEach(async () => {
    await serverResult.shutdown();
    process.env = { ...originalEnv };
  });

  describe("GET /health", () => {
    it("returns status ok with correct shape", async () => {
      const response = await fetch(`http://localhost:${TEST_PORT}/health`);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body).toEqual({
        status: "ok",
        version: VERSION,
      });
    });
  });

  describe("GET /mcp", () => {
    it("returns 405 Method Not Allowed", async () => {
      const response = await fetch(`http://localhost:${TEST_PORT}/mcp`);
      expect(response.status).toBe(405);
    });
  });

  describe("POST /mcp", () => {
    it("processes request with API key headers", async () => {
      mockHandleRequest.mockImplementation((_req: any, res: any) => {
        res.json({ jsonrpc: "2.0", id: 1, result: {} });
      });

      const response = await fetch(`http://localhost:${TEST_PORT}/mcp`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "tomtom-api-key": "my-api-key",
          "tomtom-move-portal-key": "my-move-key",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "tools/list",
          params: {},
        }),
      });

      expect(response.status).toBe(200);
      expect(mockConnect).toHaveBeenCalled();
      expect(mockHandleRequest).toHaveBeenCalled();
    });

    it("succeeds without headers when env vars are set (fallback)", async () => {
      mockHandleRequest.mockImplementation((_req: any, res: any) => {
        res.json({ jsonrpc: "2.0", id: 1, result: {} });
      });

      const response = await fetch(`http://localhost:${TEST_PORT}/mcp`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "tools/list",
          params: {},
        }),
      });

      expect(response.status).toBe(200);
    });

    it("returns 401 when no keys available at all", async () => {
      // Override mock to return no effective keys
      const { getEffectiveMovePortalKey, getEffectiveApiKey } =
        await import("./services/base/tomtomClient");
      vi.mocked(getEffectiveMovePortalKey).mockReturnValueOnce(undefined);
      vi.mocked(getEffectiveApiKey).mockReturnValueOnce(undefined);

      const response = await fetch(`http://localhost:${TEST_PORT}/mcp`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "tools/list",
          params: {},
        }),
      });

      expect(response.status).toBe(401);
      const body = await response.json();
      expect(body.error.code).toBe(-32001);
    });

    it("returns 500 on internal error", async () => {
      mockConnect.mockRejectedValueOnce(new Error("connection failed"));

      const response = await fetch(`http://localhost:${TEST_PORT}/mcp`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "tomtom-api-key": "my-key",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "tools/list",
          params: {},
        }),
      });

      expect(response.status).toBe(500);
      const body = await response.json();
      expect(body.error.code).toBe(-32603);
    });
  });

  describe("shutdown", () => {
    it("cleanly shuts down the server", async () => {
      // Shutdown is tested implicitly via afterEach, but let's test explicitly
      await serverResult.shutdown();

      // Server should be closed — new connections should fail
      await expect(
        fetch(`http://localhost:${TEST_PORT}/health`).catch(() => "failed")
      ).resolves.toBe("failed");

      // Recreate for afterEach cleanup
      serverResult = await createHttpServer({
        port: TEST_PORT,
      });
    });
  });
});
