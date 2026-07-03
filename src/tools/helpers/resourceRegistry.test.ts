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

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

const mockReadFile = vi.fn();

type ResourceResult = {
  contents: { uri: string; mimeType: string; text: string; _meta?: Record<string, unknown> }[];
};
let capturedResourceHandler: (() => Promise<ResourceResult>) | null = null;
const mockRegisterAppResource = vi.fn(
  (
    _server: unknown,
    _uri: string,
    _name: string,
    _opts: unknown,
    handler: () => Promise<ResourceResult>
  ) => {
    capturedResourceHandler = handler;
  }
);

vi.mock("node:fs/promises", () => ({
  default: { readFile: mockReadFile },
}));

vi.mock("@modelcontextprotocol/ext-apps/server", () => ({
  registerAppResource: mockRegisterAppResource,
  RESOURCE_MIME_TYPE: "text/html",
}));

const { registerAppResourceFromPath } = await import("./resourceRegistry");

describe("registerAppResourceFromPath", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    capturedResourceHandler = null;
  });

  it("registers synchronously (returns void, no promise) and passes the URI + mime type", () => {
    const mockServer = {} as McpServer;

    const result = registerAppResourceFromPath(
      mockServer,
      "ui://test/app.html",
      "search",
      "geocode"
    );

    expect(result).toBeUndefined();
    expect(mockRegisterAppResource).toHaveBeenCalledOnce();
    expect(mockRegisterAppResource).toHaveBeenCalledWith(
      mockServer,
      "ui://test/app.html",
      expect.any(String),
      { mimeType: "text/html" },
      expect.any(Function)
    );
  });

  it("serves HTML content with the exact CSP domain lists on read", async () => {
    const mockServer = {} as McpServer;
    const resourceUri = "ui://test/app.html";
    mockReadFile.mockResolvedValue("<html><body>Test App</body></html>");

    registerAppResourceFromPath(mockServer, resourceUri, "search", "geocode");
    const result = await capturedResourceHandler!();

    expect(result.contents[0].uri).toBe(resourceUri);
    expect(result.contents[0].mimeType).toBe("text/html");
    expect(result.contents[0].text).toBe("<html><body>Test App</body></html>");
    expect(result.contents[0]._meta).toEqual({
      ui: {
        csp: {
          connectDomains: [
            "https://api.tomtom.com",
            "https://*.api.tomtom.com",
            "https://unpkg.com",
            "blob:",
          ],
          resourceDomains: [
            "https://api.tomtom.com",
            "https://*.api.tomtom.com",
            "https://unpkg.com",
            "blob:",
            "data:",
          ],
        },
      },
    });
  });

  it("memoizes successfully-read file content: fs.readFile is called once across two reads", async () => {
    const mockServer = {} as McpServer;
    const resourceUri = "ui://test/memo.html";
    mockReadFile.mockResolvedValue("<html>memoized</html>");

    registerAppResourceFromPath(mockServer, resourceUri, "search", "memo-app");

    const first = await capturedResourceHandler!();
    const second = await capturedResourceHandler!();

    expect(mockReadFile).toHaveBeenCalledTimes(1);
    expect(first.contents[0].text).toBe("<html>memoized</html>");
    expect(second.contents[0].text).toBe("<html>memoized</html>");
  });

  it("returns fallback HTML when the file is missing, without throwing", async () => {
    const mockServer = {} as McpServer;
    const resourceUri = "ui://test/missing.html";
    mockReadFile.mockRejectedValue(new Error("ENOENT"));

    registerAppResourceFromPath(mockServer, resourceUri, "search", "missing-app");

    const result = await capturedResourceHandler!();

    expect(result.contents[0].text).toContain("App not found");
    expect(result.contents[0].text).toContain("npm run build:apps");
  });

  it("does not memoize the fallback: a subsequent successful read is served fresh", async () => {
    const mockServer = {} as McpServer;
    const resourceUri = "ui://test/retry.html";
    mockReadFile.mockRejectedValueOnce(new Error("ENOENT"));

    registerAppResourceFromPath(mockServer, resourceUri, "search", "retry-app");

    const failedResult = await capturedResourceHandler!();
    expect(failedResult.contents[0].text).toContain("App not found");

    mockReadFile.mockResolvedValueOnce("<html>rebuilt</html>");
    const successResult = await capturedResourceHandler!();

    expect(successResult.contents[0].text).toBe("<html>rebuilt</html>");
    expect(mockReadFile).toHaveBeenCalledTimes(2);
  });
});
