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

const { mockStoreVizData, mockLoggerError } = vi.hoisted(() => ({
  mockStoreVizData: vi.fn().mockReturnValue("mock-viz-id"),
  mockLoggerError: vi.fn(),
}));
vi.mock("../../services/cache/vizCache", () => ({ storeVizData: mockStoreVizData }));
vi.mock("../../utils/logger", () => ({
  logger: { error: mockLoggerError, info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

import { buildVizMeta } from "./vizMeta";

describe("buildVizMeta", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockStoreVizData.mockReturnValue("mock-viz-id");
  });

  it("stores the payload and returns show_ui true with viz_id by default", () => {
    const payload = { tool: "t", data: 1 };
    expect(buildVizMeta(undefined, "test", () => payload)).toEqual({
      show_ui: true,
      viz_id: "mock-viz-id",
    });
    expect(mockStoreVizData).toHaveBeenCalledWith(payload);
  });

  it("skips caching entirely when show_ui is false", () => {
    const buildPayload = vi.fn();
    expect(buildVizMeta(false, "test", buildPayload)).toEqual({ show_ui: false });
    expect(buildPayload).not.toHaveBeenCalled();
    expect(mockStoreVizData).not.toHaveBeenCalled();
  });

  it("logs and degrades to show_ui false when the cache write throws", () => {
    mockStoreVizData.mockImplementation(() => {
      throw new Error("cache full");
    });
    expect(buildVizMeta(true, "route search", () => ({}))).toEqual({ show_ui: false });
    expect(mockLoggerError).toHaveBeenCalledWith(
      "Failed to cache route search viz payload: cache full"
    );
  });
});
