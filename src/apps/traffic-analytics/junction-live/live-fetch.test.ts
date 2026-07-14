/*
 * Copyright (C) 2025 TomTom Navigation B.V.
 * Licensed under the Apache License, Version 2.0
 */

import { vi } from "vitest";
import type { App } from "@modelcontextprotocol/ext-apps";
import { fetchJunctionLive } from "./live-fetch";

function appWith(result: unknown): App {
  return { callServerTool: vi.fn().mockResolvedValue(result) } as unknown as App;
}

describe("fetchJunctionLive", () => {
  it("parses the junctions envelope", async () => {
    const app = appWith({
      isError: false,
      content: [{ type: "text", text: JSON.stringify({ junctions: [{ id: "j1" }] }) }],
    });
    await expect(fetchJunctionLive(app, ["j1"])).resolves.toEqual([{ id: "j1" }]);
    expect(app.callServerTool).toHaveBeenCalledWith({
      name: "tomtom-get-junction-live",
      arguments: { junctionIds: ["j1"] },
    });
  });

  it("throws on isError results", async () => {
    const app = appWith({ isError: true, content: [{ type: "text", text: "boom" }] });
    await expect(fetchJunctionLive(app, ["j1"])).rejects.toThrow();
  });

  it("throws on non-text content", async () => {
    const app = appWith({ isError: false, content: [{ type: "image" }] });
    await expect(fetchJunctionLive(app, ["j1"])).rejects.toThrow();
  });

  it("throws when the payload has no junctions array", async () => {
    const app = appWith({
      isError: false,
      content: [{ type: "text", text: JSON.stringify({ nope: true }) }],
    });
    await expect(fetchJunctionLive(app, ["j1"])).rejects.toThrow();
  });
});
