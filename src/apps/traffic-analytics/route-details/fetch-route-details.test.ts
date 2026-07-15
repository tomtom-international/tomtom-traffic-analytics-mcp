/*
 * Copyright (C) 2025 TomTom Navigation B.V.
 * Licensed under the Apache License, Version 2.0
 */

import { vi } from "vitest";
import type { App } from "@modelcontextprotocol/ext-apps";
import { fetchRouteDetails } from "./fetch-route-details";

function appWith(result: unknown): App {
  return { callServerTool: vi.fn().mockResolvedValue(result) } as unknown as App;
}

describe("fetchRouteDetails", () => {
  it("parses the routes envelope", async () => {
    const app = appWith({
      isError: false,
      content: [{ type: "text", text: JSON.stringify({ routes: [{ routeId: 1 }] }) }],
    });
    await expect(fetchRouteDetails(app, [1])).resolves.toEqual([{ routeId: 1 }]);
    expect(app.callServerTool).toHaveBeenCalledWith({
      name: "tomtom-get-route-details",
      arguments: { routeIds: [1] },
    });
  });

  it("throws on isError results", async () => {
    const app = appWith({ isError: true, content: [{ type: "text", text: "boom" }] });
    await expect(fetchRouteDetails(app, [1])).rejects.toThrow();
  });

  it("throws on non-text content", async () => {
    const app = appWith({ isError: false, content: [{ type: "image" }] });
    await expect(fetchRouteDetails(app, [1])).rejects.toThrow();
  });

  it("throws when the payload has no routes array", async () => {
    const app = appWith({
      isError: false,
      content: [{ type: "text", text: JSON.stringify({ nope: true }) }],
    });
    await expect(fetchRouteDetails(app, [1])).rejects.toThrow();
  });
});
