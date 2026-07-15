/*
 * Shared speed-ratio color scale for MCP apps (traffic-flow, route-details).
 * Ratio domain (0, 1]: 1 = free-flow/typical conditions, lower = slower.
 * Same hues as the area-analytics legend.
 */
import "./speed-colors.css";

export const RATIO_STOPS: ReadonlyArray<readonly [number, string]> = [
  [0.4, "#e03030"], // ≤40% of free-flow — red
  [0.7, "#f5a623"], // amber
  [0.9, "#2dc653"], // ≥90% of free-flow — green
];

export const NO_DATA_COLOR = "#9ca3af";

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
}

function mixHex(c0: string, c1: string, t: number): string {
  const a = hexToRgb(c0);
  const b = hexToRgb(c1);
  const mixed = a.map((v, i) => Math.round(v + (b[i] - v) * t));
  return `#${mixed.map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}

export function ratioToColor(ratio: number | null | undefined): string {
  if (ratio == null || !Number.isFinite(ratio)) return NO_DATA_COLOR;
  if (ratio <= RATIO_STOPS[0][0]) return RATIO_STOPS[0][1];
  const last = RATIO_STOPS[RATIO_STOPS.length - 1];
  if (ratio >= last[0]) return last[1];
  for (let i = 0; i < RATIO_STOPS.length - 1; i++) {
    const [v0, c0] = RATIO_STOPS[i];
    const [v1, c1] = RATIO_STOPS[i + 1];
    if (ratio <= v1) return mixHex(c0, c1, (ratio - v0) / (v1 - v0));
  }
  return last[1];
}

/**
 * Builds the color-stop list of a `linear-gradient()` from value/color stops,
 * normalizing positions by the stop values' own min/max (the stop domain
 * varies: 0–1 fractions for ratio ramps, 0–100 or raw units for analytics
 * metric configs). Zero-span stop lists collapse to position 0%.
 */
export function gradientCss(stops: ReadonlyArray<{ value: number; color: string }>): string {
  if (stops.length === 0) return "";
  const values = stops.map((s) => s.value);
  const min = Math.min(...values);
  const span = Math.max(...values) - min || 1;
  return stops.map((s) => `${s.color} ${(((s.value - min) / span) * 100).toFixed(1)}%`).join(", ");
}

/** Renders the shared green→amber→red ramp legend. `label` must be a static string. */
export function renderRampLegend(container: HTMLElement, label: string): void {
  const gradient = gradientCss(RATIO_STOPS.map(([value, color]) => ({ value, color })));
  container.innerHTML = `
    <div class="ramp-legend-label">${label}</div>
    <div class="ramp-legend-bar" style="background: linear-gradient(to right, ${gradient})"></div>
    <div class="ramp-legend-ends"><span>Slower</span><span>Free flow</span></div>`;
}
