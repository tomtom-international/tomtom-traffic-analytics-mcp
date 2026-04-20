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

// HTTP entry point for the TomTom Traffic Analytics MCP Server
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createServer } from "./createServer";
import { logger } from "./utils/logger";
import { randomUUID } from "node:crypto";
import express, { Request, Response } from "express";
import cors from "cors";
import { Server } from "http";
import { VERSION } from "./version";
import {
  runWithSessionContext,
  setHttpMode,
  getEffectiveMovePortalKey,
  getEffectiveApiKey,
} from "./services/base/tomtomClient";

export interface HttpServerOptions {
  port?: number;
  allowedOrigins?: string;
}

export interface HttpServerResult {
  app: ReturnType<typeof express>;
  httpServer: Server;
  shutdown: () => Promise<void>;
}

/**
 * Extract Move Portal API key from request header (optional).
 */
function extractMovePortalKey(req: Request): string {
  return req.header("tomtom-move-portal-key")?.trim() || "";
}

/**
 * Extract TomTom API key from request header (optional).
 */
function extractApiKey(req: Request): string {
  return req.header("tomtom-api-key")?.trim() || "";
}

/**
 * Creates and starts the HTTP server. Exported for testing.
 *
 * Each incoming request gets its own McpServer + transport pair, created on-the-fly.
 * This ensures full isolation between concurrent requests — no shared state, no locking.
 * createServer() is lightweight (in-memory tool registration, no network calls).
 */
export async function createHttpServer(options: HttpServerOptions = {}): Promise<HttpServerResult> {
  const {
    port = parseInt(process.env.PORT || "3000", 10),
    allowedOrigins = process.env.ALLOWED_ORIGINS,
  } = options;

  const app = express();
  app.use(express.json());
  app.use(
    cors({
      origin: allowedOrigins?.split(",") || "*",
      methods: ["POST", "GET", "OPTIONS"],
      allowedHeaders: [
        "Content-Type",
        "tomtom-api-key",
        "tomtom-move-portal-key",
        "mcp-protocol-version",
      ],
      maxAge: 86400,
    })
  );

  // POST /mcp — Main MCP protocol endpoint
  app.post("/mcp", async (req: Request, res: Response) => {
    const requestId = randomUUID();

    const movePortalKey = extractMovePortalKey(req);
    const apiKey = extractApiKey(req);

    try {
      // Check that at least one effective key exists (header OR env var).
      // We run this check inside session context so getEffective* sees headers first.
      const hasEffectiveKey = await runWithSessionContext(
        movePortalKey,
        apiKey,
        () => !!(getEffectiveMovePortalKey() || getEffectiveApiKey())
      );

      if (!hasEffectiveKey) {
        logger.warn(`Request ${requestId}: No API keys available (neither header nor env var)`);
        res.status(401).json({
          jsonrpc: "2.0",
          error: { code: -32001, message: "Unauthorized: no API keys provided" },
          id: req.body?.id || null,
        });
        return;
      }

      logger.debug(`Processing MCP request ${requestId}`);

      const server = createServer();
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
      });
      await server.connect(transport);

      res.on("close", () => {
        transport.close();
        server.close();
      });

      await runWithSessionContext(movePortalKey, apiKey, async () => {
        await transport.handleRequest(req, res, req.body);
      });
    } catch (error) {
      logger.error(
        `Request ${requestId} failed: ${error instanceof Error ? error.message : String(error)}`
      );
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: "2.0",
          error: { code: -32603, message: "Internal server error" },
          id: req.body?.id || null,
        });
      }
    }
  });

  // GET /mcp — Method Not Allowed
  app.get("/mcp", (_req: Request, res: Response) => {
    res.status(405).set("Allow", "POST").send("Method Not Allowed");
  });

  // GET /health — Health check endpoint
  app.get("/health", (_req: Request, res: Response) => {
    res.json({
      status: "ok",
      version: VERSION,
    });
  });

  const httpServer = app.listen(port, () => {
    logger.info(`TomTom Traffic Analytics MCP HTTP Server started on port ${port}`);
  });

  const shutdown = async (): Promise<void> => {
    logger.info("Shutting down HTTP server...");
    return new Promise((resolve) => {
      httpServer.close(() => {
        resolve();
      });
    });
  };

  return { app, httpServer, shutdown };
}

async function main(): Promise<void> {
  try {
    setHttpMode();
    const { shutdown } = await createHttpServer();

    process.on("SIGINT", async () => {
      await shutdown();
      process.exit(0);
    });
    process.on("SIGTERM", async () => {
      await shutdown();
      process.exit(0);
    });
  } catch (error) {
    logger.error(
      `Startup failed: ${error instanceof Error ? error.stack || error.message : String(error)}`
    );
    process.exit(1);
  }
}

// Only run main() when not in a test environment
const isTestEnv = process.env.VITEST === "true" || process.env.NODE_ENV === "test";

if (!isTestEnv) {
  main();
}
