/*
 * Copyright (C) 2025 TomTom Navigation B.V.
 * Licensed under the Apache License, Version 2.0
 */

/** LOS delay bands (avg intersection delay, seconds) with plain-language qualifiers. */
export const LOS_BANDS = [
  { letter: "A", max: 10, color: "#2dc653", label: "Free flow" },
  { letter: "B", max: 20, color: "#8ac926", label: "Light delays" },
  { letter: "C", max: 35, color: "#f5a623", label: "Moderate delays" },
  { letter: "D", max: 55, color: "#e07b39", label: "Long delays" },
  { letter: "E", max: 80, color: "#e03030", label: "Heavy congestion" },
  { letter: "F", max: Infinity, color: "#8b0000", label: "Severe congestion" },
] as const;

export type LosBand = (typeof LOS_BANDS)[number];

/** Threshold caption for the legend: "≤10 s" … ">80 s". */
export function losThresholdLabel(band: LosBand): string {
  return band.max === Infinity ? `>${LOS_BANDS[LOS_BANDS.length - 2].max} s` : `≤${band.max} s`;
}

export function losFor(delaySec: number | null | undefined): LosBand | undefined {
  if (delaySec == null || !Number.isFinite(delaySec)) return undefined;
  return LOS_BANDS.find((b) => delaySec <= b.max);
}
