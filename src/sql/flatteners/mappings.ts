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

/**
 * Mappings from TomTom API numeric codes to human-readable names.
 * Used by flatteners to translate codes before loading into DuckDB,
 * so LLMs see descriptive names directly without needing mapping documentation.
 */

/** Traffic incident icon category codes (0-14) */
const ICON_CATEGORY_MAP: Record<number, string> = {
  0: "Accident",
  1: "Fog",
  2: "Dangerous",
  3: "Rain",
  4: "Ice",
  5: "JamLane",
  6: "LaneClosure",
  7: "RoadClosure",
  8: "RoadWorks",
  9: "Wind",
  10: "Flooding",
  11: "Detour",
  14: "Cluster",
};

/** Traffic incident magnitude of delay codes (0-4) */
const MAGNITUDE_OF_DELAY_MAP: Record<number, string> = {
  0: "Unknown",
  1: "Minor",
  2: "Moderate",
  3: "Major",
  4: "Undefined",
};

/** Functional Road Class codes (0-7) for volume data */
const FRC_MAP: Record<number, string> = {
  0: "Motorway",
  1: "Major",
  2: "OtherMajor",
  3: "Secondary",
  4: "LocalConnecting",
  5: "LocalHigh",
  6: "Local",
  7: "LocalMinor",
};

export function mapIconCategory(code: number): string {
  return ICON_CATEGORY_MAP[code] ?? `Unknown(${code})`;
}

export function mapMagnitudeOfDelay(code: number | null): string | null {
  if (code === null || code === undefined) return null;
  return MAGNITUDE_OF_DELAY_MAP[code] ?? `Unknown(${code})`;
}

export function mapFrc(code: number | null): string | null {
  if (code === null || code === undefined) return null;
  return FRC_MAP[code] ?? `Unknown(${code})`;
}
