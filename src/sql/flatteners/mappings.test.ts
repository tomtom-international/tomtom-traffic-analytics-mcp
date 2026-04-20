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

import { describe, it, expect } from "vitest";
import { mapIconCategory, mapMagnitudeOfDelay, mapFrc } from "./mappings";

describe("mapIconCategory", () => {
  it("maps all known icon category codes", () => {
    expect(mapIconCategory(0)).toBe("Accident");
    expect(mapIconCategory(1)).toBe("Fog");
    expect(mapIconCategory(2)).toBe("Dangerous");
    expect(mapIconCategory(3)).toBe("Rain");
    expect(mapIconCategory(4)).toBe("Ice");
    expect(mapIconCategory(5)).toBe("JamLane");
    expect(mapIconCategory(6)).toBe("LaneClosure");
    expect(mapIconCategory(7)).toBe("RoadClosure");
    expect(mapIconCategory(8)).toBe("RoadWorks");
    expect(mapIconCategory(9)).toBe("Wind");
    expect(mapIconCategory(10)).toBe("Flooding");
    expect(mapIconCategory(11)).toBe("Detour");
    expect(mapIconCategory(14)).toBe("Cluster");
  });

  it("returns Unknown(N) for unmapped codes", () => {
    expect(mapIconCategory(12)).toBe("Unknown(12)");
    expect(mapIconCategory(13)).toBe("Unknown(13)");
    expect(mapIconCategory(99)).toBe("Unknown(99)");
  });
});

describe("mapMagnitudeOfDelay", () => {
  it("maps all known magnitude codes", () => {
    expect(mapMagnitudeOfDelay(0)).toBe("Unknown");
    expect(mapMagnitudeOfDelay(1)).toBe("Minor");
    expect(mapMagnitudeOfDelay(2)).toBe("Moderate");
    expect(mapMagnitudeOfDelay(3)).toBe("Major");
    expect(mapMagnitudeOfDelay(4)).toBe("Undefined");
  });

  it("returns null for null input", () => {
    expect(mapMagnitudeOfDelay(null)).toBeNull();
  });

  it("returns Unknown(N) for unmapped codes", () => {
    expect(mapMagnitudeOfDelay(5)).toBe("Unknown(5)");
    expect(mapMagnitudeOfDelay(99)).toBe("Unknown(99)");
  });
});

describe("mapFrc", () => {
  it("maps all known FRC codes", () => {
    expect(mapFrc(0)).toBe("Motorway");
    expect(mapFrc(1)).toBe("Major");
    expect(mapFrc(2)).toBe("OtherMajor");
    expect(mapFrc(3)).toBe("Secondary");
    expect(mapFrc(4)).toBe("LocalConnecting");
    expect(mapFrc(5)).toBe("LocalHigh");
    expect(mapFrc(6)).toBe("Local");
    expect(mapFrc(7)).toBe("LocalMinor");
  });

  it("returns null for null input", () => {
    expect(mapFrc(null)).toBeNull();
  });

  it("returns Unknown(N) for unmapped codes", () => {
    expect(mapFrc(8)).toBe("Unknown(8)");
    expect(mapFrc(99)).toBe("Unknown(99)");
  });
});
