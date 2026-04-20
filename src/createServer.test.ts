/*
 * Copyright (C) 2025 TomTom NV
 * Licensed under the Apache License, Version 2.0
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./tools/areaAnalytics", () => ({ createAreaAnalyticsTools: vi.fn() }));
vi.mock("./tools/junctionAnalytics", () => ({ createJunctionAnalyticsTools: vi.fn() }));
vi.mock("./tools/routeMonitoring", () => ({ createRouteMonitoringTools: vi.fn() }));
vi.mock("./tools/liveTraffic", () => ({ createLiveTrafficTools: vi.fn() }));
vi.mock("./services/base/tomtomClient", () => ({ validateMovePortalApiKey: vi.fn() }));
vi.mock("./utils/logger", () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() },
}));

import { createServer } from "./createServer";
import { createAreaAnalyticsTools } from "./tools/areaAnalytics";
import { createJunctionAnalyticsTools } from "./tools/junctionAnalytics";
import { createRouteMonitoringTools } from "./tools/routeMonitoring";
import { createLiveTrafficTools } from "./tools/liveTraffic";

describe("createServer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("registers all core tools", () => {
    createServer();

    expect(createAreaAnalyticsTools).toHaveBeenCalledTimes(1);
    expect(createJunctionAnalyticsTools).toHaveBeenCalledTimes(1);
    expect(createRouteMonitoringTools).toHaveBeenCalledTimes(1);
    expect(createLiveTrafficTools).toHaveBeenCalledTimes(1);
  });

  it("does not fail when called", () => {
    expect(() => createServer()).not.toThrow();
  });
});
