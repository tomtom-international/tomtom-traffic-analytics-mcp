/*
 * Copyright (C) 2025 TomTom Navigation B.V.
 * Licensed under the Apache License, Version 2.0
 */

import { describe, it, expect, vi } from "vitest";
import { createFeatureStateSetter } from "./feature-state";

function makeHost() {
  const setFeatureState = vi.fn();
  const removeFeatureState = vi.fn();
  const host = {
    map: { mapLibreMap: { setFeatureState, removeFeatureState } },
    geoModule: {
      sourceAndLayerIDs: {
        routes: { sourceID: "src-routes" },
        segments: { sourceID: "src-segments" },
      },
    },
  };
  return { host, setFeatureState, removeFeatureState };
}

describe("createFeatureStateSetter", () => {
  it("flags a feature and clears the previous one for the same (source, state)", () => {
    const { host, setFeatureState, removeFeatureState } = makeHost();
    const setState = createFeatureStateSetter(() => host);

    setState("routes", "1", "hover");
    expect(setFeatureState).toHaveBeenCalledWith(
      { source: "src-routes", id: "1" },
      { hover: true }
    );
    expect(removeFeatureState).not.toHaveBeenCalled();

    setState("routes", "2", "hover");
    expect(removeFeatureState).toHaveBeenCalledWith({ source: "src-routes", id: "1" }, "hover");
    expect(setFeatureState).toHaveBeenCalledWith(
      { source: "src-routes", id: "2" },
      { hover: true }
    );
  });

  it("null id clears the previous feature without setting a new one", () => {
    const { host, setFeatureState, removeFeatureState } = makeHost();
    const setState = createFeatureStateSetter(() => host);

    setState("routes", 7, "selected"); // numeric ids are stringified
    setState("routes", null, "selected");

    expect(removeFeatureState).toHaveBeenCalledWith({ source: "src-routes", id: "7" }, "selected");
    expect(setFeatureState).toHaveBeenCalledTimes(1);
  });

  it("tracks (source, state) pairs independently", () => {
    const { host, removeFeatureState } = makeHost();
    const setState = createFeatureStateSetter(() => host);

    setState("routes", "1", "hover");
    setState("segments", "9", "hover");
    setState("routes", "1", "selected");
    setState("routes", "2", "hover"); // must clear routes/hover "1", not segments or selected

    expect(removeFeatureState).toHaveBeenCalledTimes(1);
    expect(removeFeatureState).toHaveBeenCalledWith({ source: "src-routes", id: "1" }, "hover");
  });

  it("is a no-op when the map or geoModule is not ready", () => {
    const setState = createFeatureStateSetter(() => ({ map: undefined, geoModule: undefined }));
    expect(() => setState("routes", "1", "hover")).not.toThrow();
  });
});
