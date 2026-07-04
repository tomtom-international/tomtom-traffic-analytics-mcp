# PR Review Fixes Implementation Plan (feat/mcp-apps-traffic-tools)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the correctness bugs, duplication, cache limitations, and dev-harness security issues found in the code review of PR `feat/mcp-apps-traffic-tools`, with tests.

**Architecture:** Extract pure, node-testable helpers into `src/apps/shared/` (format, collections, chart layout, geo, DOM escape, feature-state, app bootstrap) and migrate the 5 apps onto them; extract a `buildVizMeta` helper for the 7 duplicated handler viz-cache blocks; bound the viz cache; make the resource-registry memoization mtime-aware; harden the dev UI harness.

**Tech Stack:** TypeScript, Vitest (node environment — **no jsdom**), Vite (apps), Playwright (e2e), Express (dev harness), node-cache.

## Global Constraints

- **Work in the worktree** `C:\Users\prietofe\workspace\tta-mcp-apps`, branch `feat/mcp-apps-traffic-tools`. All paths below are relative to that root.
- **Vitest runs in `environment: 'node'`** — new unit tests MUST NOT touch `document`/`window`/`localStorage`. Test pure functions only; DOM behavior is verified by `npm run build:apps` (type/bundle check) and Playwright e2e.
- **MCP stdio hygiene:** never `console.log`/stdout from code loaded by `src/index.ts`. Browser app code (`src/apps/**`, built by Vite, runs in iframe) may use `console.warn`/`console.error`.
- `src/apps/**` is excluded from `tsc` and vitest coverage but its `*.test.ts` files run in `npm test`, and `npm run lint` covers it.
- Unit test style: vitest globals ARE enabled but existing app-shared tests import `{ describe, it, expect }` from "vitest" explicitly — follow the style of the file you're next to. Mocks before import; use `vi.hoisted()` for mock vars used in `vi.mock()` factories.
- Every new source file starts with the repo's short Apache-2.0 header (copy from `src/apps/shared/geo.ts` for app files, from `src/services/cache/vizCache.ts` for server files).
- Commit after each task with a conventional-commit message. Do NOT push.
- E2E (`npm run test:e2e`) auto-skips without `TOMTOM_API_KEY`/`TOMTOM_MOVE_PORTAL_KEY` in `.env`; run it in the final task only (it needs `npm run test:e2e:setup` once).

**Out of scope (documented limitations, do not attempt):** multi-process/tenant-isolated viz cache backend; redesigning the junction-live `show_ui` geometry over-fetch; incremental incident-list DOM updates on filter clicks.

---

### Task 1: Shared formatters (`format.ts`) — unify duplicated/divergent formatters and fix NaN stats

**Files:**
- Create: `src/apps/shared/format.ts`
- Create: `src/apps/shared/format.test.ts`
- Modify: `src/apps/traffic-analytics/traffic-flow/app.ts` (delete local `formatDuration`/`formatConfidence` at lines ~92-110; fix `renderStats` NaN handling at ~116-148)
- Modify: `src/apps/traffic-analytics/route-details/app.ts` (delete local `formatDuration`/`formatConfidence` at lines ~130-151, keep `formatKm`)

**Interfaces:**
- Produces: `formatDuration(totalSeconds: number | undefined | null): string` — `"—"` for non-finite; `"45 s"`, `"3 min"` (whole minutes), `"3 min 20 s"`.
- Produces: `formatConfidence(pct: number | undefined | null): string` — `"—"` for non-finite; percent-scale (0–100) only, fraction-scale callers convert at the call site; returns `"83%"`.
- Produces: `formatSpeed(value: number | undefined | null, unitLabel: string): string` — `"—"` for non-finite; `"52 km/h"`.

- [ ] **Step 1: Write the failing test**

Create `src/apps/shared/format.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { formatDuration, formatConfidence, formatSpeed } from "./format";

describe("formatDuration", () => {
  it("formats seconds-only durations", () => {
    expect(formatDuration(45)).toBe("45 s");
    expect(formatDuration(0)).toBe("0 s");
  });
  it("omits the seconds part for whole minutes", () => {
    expect(formatDuration(180)).toBe("3 min");
  });
  it("formats mixed durations", () => {
    expect(formatDuration(200)).toBe("3 min 20 s");
  });
  it("clamps negatives to zero", () => {
    expect(formatDuration(-5)).toBe("0 s");
  });
  it("returns em dash for non-finite input", () => {
    expect(formatDuration(undefined)).toBe("—");
    expect(formatDuration(null)).toBe("—");
    expect(formatDuration(Number.NaN)).toBe("—");
  });
});

describe("formatConfidence", () => {
  it("formats percent-scale values", () => {
    expect(formatConfidence(83)).toBe("83%");
    expect(formatConfidence(99.6)).toBe("100%");
  });
  it("does NOT misread a legitimate 1% as a fraction", () => {
    expect(formatConfidence(1)).toBe("1%");
    expect(formatConfidence(0.4)).toBe("0%");
  });
  it("returns em dash for non-finite input", () => {
    expect(formatConfidence(undefined)).toBe("—");
    expect(formatConfidence(null)).toBe("—");
    expect(formatConfidence(Number.NaN)).toBe("—");
  });
});

describe("formatSpeed", () => {
  it("rounds and appends the unit", () => {
    expect(formatSpeed(51.7, "km/h")).toBe("52 km/h");
  });
  it("returns em dash for non-finite input", () => {
    expect(formatSpeed(undefined, "km/h")).toBe("—");
    expect(formatSpeed(Number.NaN, "mph")).toBe("—");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/apps/shared/format.test.ts`
Expected: FAIL — cannot resolve `./format`

- [ ] **Step 3: Write the implementation**

Create `src/apps/shared/format.ts`:

```typescript
/*
 * Copyright (C) 2025 TomTom Navigation B.V.
 * Licensed under the Apache License, Version 2.0
 */

/** Placeholder shown when a numeric value is missing/invalid in the payload. */
export const NO_VALUE = "—";

/**
 * Formats a duration in seconds as "3 min 20 s" / "45 s" / "3 min".
 *
 * This is a local helper, not the SDK's `formatDuration` (which only reports
 * minute-level granularity and returns `undefined` under 30 seconds) — the
 * stat cards need second-level precision for short segments and delays.
 * Returns {@link NO_VALUE} when the input is missing or not a finite number
 * (partial API payloads must not render as "NaN s").
 */
export function formatDuration(totalSeconds: number | undefined | null): string {
  if (totalSeconds == null || !Number.isFinite(totalSeconds)) return NO_VALUE;
  const secs = Math.max(0, Math.round(totalSeconds));
  const mins = Math.floor(secs / 60);
  const rem = secs % 60;
  if (mins === 0) return `${rem} s`;
  return rem === 0 ? `${mins} min` : `${mins} min ${rem} s`;
}

/**
 * Formats a percent-scale (0–100) confidence value as "83%". Callers whose
 * API reports a 0–1 fraction (e.g. Flow Segment `confidence`) must convert
 * with `* 100` at the call site — a value-range heuristic here would
 * misrender a legitimate 1% as 100%. Returns {@link NO_VALUE} for
 * non-finite input.
 */
export function formatConfidence(pct: number | undefined | null): string {
  if (pct == null || !Number.isFinite(pct)) return NO_VALUE;
  return `${Math.round(pct)}%`;
}

/** Formats a speed with its unit label, or {@link NO_VALUE} for non-finite input. */
export function formatSpeed(value: number | undefined | null, unitLabel: string): string {
  if (value == null || !Number.isFinite(value)) return NO_VALUE;
  return `${Math.round(value)} ${unitLabel}`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/apps/shared/format.test.ts`
Expected: PASS (all tests)

- [ ] **Step 5: Migrate traffic-flow/app.ts**

In `src/apps/traffic-analytics/traffic-flow/app.ts`:

1. Add to imports: `import { formatDuration, formatConfidence, formatSpeed } from "@shared/format";`
2. Delete the entire "Formatting helpers" section (the local `formatDuration` and `formatConfidence`, lines ~89-110 including their JSDoc).
3. Replace the body of `renderStats` rows construction (currently lines ~130-138) with:

```typescript
  const hasTimes =
    Number.isFinite(seg.currentTravelTime) && Number.isFinite(seg.freeFlowTravelTime);
  const delaySeconds = hasTimes ? seg.currentTravelTime - seg.freeFlowTravelTime : undefined;
  const hasTimes =
    Number.isFinite(seg.currentTravelTime) && Number.isFinite(seg.freeFlowTravelTime);
  const delaySeconds = hasTimes ? seg.currentTravelTime - seg.freeFlowTravelTime : undefined;
  const rows: Array<[string, string]> = [
    ["Current speed", formatSpeed(seg.currentSpeed, unitLabel)],
    ["Free-flow speed", formatSpeed(seg.freeFlowSpeed, unitLabel)],
    ["Current travel time", formatDuration(seg.currentTravelTime)],
    ["Free-flow travel time", formatDuration(seg.freeFlowTravelTime)],
    ["Delay", delaySeconds !== undefined && delaySeconds > 0 ? formatDuration(delaySeconds) : delaySeconds === undefined ? "—" : "None"],
    // Flow Segment confidence is a 0–1 fraction — shared formatter is percent-scale.
    ["Confidence", formatConfidence(seg.confidence * 100)],
  ];
```

- [ ] **Step 6: Migrate route-details/app.ts**

In `src/apps/traffic-analytics/route-details/app.ts`:

1. Add to imports: `import { formatDuration, formatConfidence } from "@shared/format";`
2. Delete the local `formatDuration` (lines ~130-143 incl. JSDoc) and local `formatConfidence` (lines ~149-151). Keep `formatKm`.
3. No call-site changes needed — the shared signatures are compatible (`route.routeConfidence` is 0–100, `> 1`, so `formatConfidence` output is unchanged; whole-minute durations now render "3 min" instead of "3 min 0 s", which is the intended unification).

- [ ] **Step 7: Verify build + tests**

Run: `npx vitest run src/apps && npm run build:apps`
Expected: tests PASS; Vite build succeeds for all 5 apps

- [ ] **Step 8: Commit**

```bash
git add src/apps/shared/format.ts src/apps/shared/format.test.ts src/apps/traffic-analytics/traffic-flow/app.ts src/apps/traffic-analytics/route-details/app.ts
git commit -m "fix(apps): shared defensive formatters; no more NaN stats or divergent duration formats"
```

---

### Task 2: Dedupe incidents across overlapping bboxes

**Files:**
- Create: `src/apps/shared/collections.ts`
- Create: `src/apps/shared/collections.test.ts`
- Modify: `src/apps/traffic-analytics/traffic-incidents/app.ts:415-423`

**Interfaces:**
- Produces: `dedupeBy<T>(items: T[], key: (item: T) => string): T[]` — keeps first occurrence, preserves order.

- [ ] **Step 1: Write the failing test**

Create `src/apps/shared/collections.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { dedupeBy } from "./collections";

describe("dedupeBy", () => {
  it("keeps the first occurrence and preserves order", () => {
    const items = [
      { id: "a", v: 1 },
      { id: "b", v: 2 },
      { id: "a", v: 3 },
      { id: "c", v: 4 },
    ];
    expect(dedupeBy(items, (i) => i.id)).toEqual([
      { id: "a", v: 1 },
      { id: "b", v: 2 },
      { id: "c", v: 4 },
    ]);
  });
  it("returns an empty array unchanged", () => {
    expect(dedupeBy([], () => "x")).toEqual([]);
  });
  it("passes through when all keys are unique", () => {
    const items = [{ id: "a" }, { id: "b" }];
    expect(dedupeBy(items, (i) => i.id)).toEqual(items);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/apps/shared/collections.test.ts`
Expected: FAIL — cannot resolve `./collections`

- [ ] **Step 3: Write the implementation**

Create `src/apps/shared/collections.ts`:

```typescript
/*
 * Copyright (C) 2025 TomTom Navigation B.V.
 * Licensed under the Apache License, Version 2.0
 */

/**
 * Removes items with duplicate keys, keeping the FIRST occurrence and
 * preserving input order. Used to dedupe incidents returned by more than one
 * overlapping bbox query — MapLibre requires unique feature ids for
 * feature-state, and duplicated list rows break focus highlighting.
 */
export function dedupeBy<T>(items: T[], key: (item: T) => string): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const item of items) {
    const k = key(item);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(item);
  }
  return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/apps/shared/collections.test.ts`
Expected: PASS

- [ ] **Step 5: Wire into traffic-incidents/app.ts**

1. Add import: `import { dedupeBy } from "@shared/collections";`
2. Replace lines 415-423 (`allFeatures = viz.areas.flatMap(...)` … `featuresById = new Map(...)`) with:

```typescript
  // The same incident can be returned by two overlapping bboxes — dedupe by
  // the TomTom-global incident id (first area wins) so MapLibre feature ids
  // stay unique and the list shows each incident once.
  allFeatures = dedupeBy(
    viz.areas.flatMap((area) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- raw API shape, validated by the SDK parser
      const parsed = parseTrafficIncidentDetailsResponse(area.incidents as any);
      return parsed.features.map((f) => ({
        ...f,
        properties: { ...f.properties, areaName: area.name },
      })) as IncidentFeature[];
    }),
    (f) => f.properties.id
  );
  featuresById = new Map(allFeatures.map((f) => [f.properties.id, f]));
```

- [ ] **Step 6: Verify build**

Run: `npx vitest run src/apps && npm run build:apps`
Expected: PASS / build succeeds

- [ ] **Step 7: Commit**

```bash
git add src/apps/shared/collections.ts src/apps/shared/collections.test.ts src/apps/traffic-analytics/traffic-incidents/app.ts
git commit -m "fix(apps): dedupe incidents returned by overlapping bboxes"
```

---

### Task 3: Clamp time-series bar width (negative-width SVG bug)

**Files:**
- Create: `src/apps/shared/chart-layout.ts`
- Create: `src/apps/shared/chart-layout.test.ts`
- Modify: `src/apps/traffic-analytics/area-analytics/app.ts:289-290`

**Interfaces:**
- Produces: `computeBarLayout(count: number, width: number, preferredGap?: number): { barWidth: number; barGap: number }` — `barWidth` always `> 0` for `count > 0`; gap drops to 0 when bars get crowded.

- [ ] **Step 1: Write the failing test**

Create `src/apps/shared/chart-layout.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { computeBarLayout } from "./chart-layout";

describe("computeBarLayout", () => {
  it("uses the preferred gap when there is room", () => {
    const { barWidth, barGap } = computeBarLayout(7, 320, 4);
    expect(barGap).toBe(4);
    expect(barWidth).toBeCloseTo((320 - 4 * 6) / 7);
  });
  it("never returns a negative or zero bar width for large series", () => {
    // 168 hourly entries used to produce barWidth ≈ -2 (invalid SVG)
    const { barWidth, barGap } = computeBarLayout(168, 320, 4);
    expect(barWidth).toBeGreaterThan(0);
    expect(barGap).toBe(0);
    expect(barWidth * 168).toBeLessThanOrEqual(320);
  });
  it("handles a single bar", () => {
    const { barWidth } = computeBarLayout(1, 320, 4);
    expect(barWidth).toBe(320);
  });
  it("returns zero width for zero count", () => {
    expect(computeBarLayout(0, 320, 4).barWidth).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/apps/shared/chart-layout.test.ts`
Expected: FAIL — cannot resolve `./chart-layout`

- [ ] **Step 3: Write the implementation**

Create `src/apps/shared/chart-layout.ts`:

```typescript
/*
 * Copyright (C) 2025 TomTom Navigation B.V.
 * Licensed under the Apache License, Version 2.0
 */

/**
 * Computes bar width/gap for an SVG bar chart of `count` bars in `width` px.
 *
 * With many bars (e.g. a week of hourly entries = 168 bars in 320px) the
 * naive `(width - gap*(n-1)) / n` goes NEGATIVE, emitting invalid SVG
 * `<rect width="-…">`. When the preferred gap would leave less than 1px per
 * bar, the gap is dropped entirely and bars share the width exactly.
 */
export function computeBarLayout(
  count: number,
  width: number,
  preferredGap = 4
): { barWidth: number; barGap: number } {
  if (count <= 0) return { barWidth: 0, barGap: preferredGap };
  const withGap = (width - preferredGap * (count - 1)) / count;
  if (withGap >= 1) return { barWidth: withGap, barGap: preferredGap };
  return { barWidth: width / count, barGap: 0 };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/apps/shared/chart-layout.test.ts`
Expected: PASS

- [ ] **Step 5: Wire into area-analytics renderTimeSeries**

In `src/apps/traffic-analytics/area-analytics/app.ts`:

1. Add import: `import { computeBarLayout } from "@shared/chart-layout";`
2. Replace lines 289-290:

```typescript
  const barGap = 4;
  const barWidth = (width - barGap * (values.length - 1)) / values.length;
```

with:

```typescript
  const { barWidth, barGap } = computeBarLayout(values.length, width, 4);
```

- [ ] **Step 6: Verify build**

Run: `npx vitest run src/apps && npm run build:apps`
Expected: PASS / build succeeds

- [ ] **Step 7: Commit**

```bash
git add src/apps/shared/chart-layout.ts src/apps/shared/chart-layout.test.ts src/apps/traffic-analytics/area-analytics/app.ts
git commit -m "fix(apps): clamp time-series bar width — long hourly series rendered invalid negative-width SVG"
```

---

### Task 4: Polygon centroid fix + O(1) exit lookup (junction-live)

**Files:**
- Modify: `src/apps/shared/geo.ts` (add `polygonRingCentroid`)
- Modify: `src/apps/shared/geo.test.ts` (add tests)
- Modify: `src/apps/traffic-analytics/junction-live/app.ts` (`junctionCenter` ~220-233; `renderTurnRatioTable` ~539-568; state ~179; `selectLiveJunction` ~676-677; `resetPanelState` ~776)

**Interfaces:**
- Produces: `polygonRingCentroid(ring: number[][]): [number, number] | null` in `@shared/geo` — vertex-average centroid that ignores the duplicated closing vertex of a closed GeoJSON ring; `null` for an empty ring.

- [ ] **Step 1: Write the failing test**

Append to `src/apps/shared/geo.test.ts` (inside the file, after the existing describes, matching its import style — check the top of the file and extend the import from `./geo` with `polygonRingCentroid`):

```typescript
describe("polygonRingCentroid", () => {
  it("returns null for an empty ring", () => {
    expect(polygonRingCentroid([])).toBeNull();
  });
  it("averages vertices of an open ring", () => {
    expect(polygonRingCentroid([[0, 0], [2, 0], [2, 2], [0, 2]])).toEqual([1, 1]);
  });
  it("ignores the duplicated closing vertex of a closed GeoJSON ring", () => {
    // Closed ring: first == last. Naive averaging counts [0,0] twice and
    // biases the centroid toward that corner.
    const closed = [[0, 0], [2, 0], [2, 2], [0, 2], [0, 0]];
    expect(polygonRingCentroid(closed)).toEqual([1, 1]);
  });
  it("handles a degenerate single-vertex ring", () => {
    expect(polygonRingCentroid([[3, 4]])).toEqual([3, 4]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/apps/shared/geo.test.ts`
Expected: FAIL — `polygonRingCentroid` is not exported

- [ ] **Step 3: Write the implementation**

Append to `src/apps/shared/geo.ts`:

```typescript
/**
 * Vertex-average centroid of a GeoJSON polygon ring.
 *
 * GeoJSON rings are closed (first coordinate repeated as the last); averaging
 * all vertices would count that shared vertex twice and bias the centroid
 * toward it, so the duplicated closing vertex is excluded first.
 *
 * @param ring - Array of [lon, lat] vertices (open or closed)
 * @returns [lon, lat] centroid, or null when the ring is empty
 */
export function polygonRingCentroid(ring: number[][]): [number, number] | null {
  if (ring.length === 0) return null;

  const first = ring[0];
  const last = ring[ring.length - 1];
  const isClosed =
    ring.length > 1 && first[0] === last[0] && first[1] === last[1];
  const vertices = isClosed ? ring.slice(0, -1) : ring;

  let sumLon = 0;
  let sumLat = 0;
  for (const vertex of vertices) {
    sumLon += vertex[0];
    sumLat += vertex[1];
  }
  return [sumLon / vertices.length, sumLat / vertices.length];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/apps/shared/geo.test.ts`
Expected: PASS

- [ ] **Step 5: Wire into junction-live/app.ts + O(1) exit lookup**

In `src/apps/traffic-analytics/junction-live/app.ts`:

1. Extend the `@shared/geo` usage: the file currently doesn't import from geo — add `import { polygonRingCentroid } from "@shared/geo";`
2. Replace the body of `junctionCenter` (lines ~220-233) with:

```typescript
function junctionCenter(geometry: GeoJSONPointGeom | GeoJSONPolygonGeom): [number, number] | null {
  if (geometry.type === "Point") return geometry.coordinates;
  return polygonRingCentroid(geometry.coordinates[0] ?? []);
}
```

3. Next to `let currentExits: Exit[] = [];` (line ~179) add:

```typescript
let currentExitById = new Map<number, Exit>();
```

4. In `selectLiveJunction` immediately after `currentExits = model?.exits ?? [];` (line ~677) add:

```typescript
  currentExitById = new Map(currentExits.map((e) => [e.id, e]));
```

5. In `renderTurnRatioTable` replace `const exit = currentExits.find((e) => e.id === tr.exitId);` (line ~550) with:

```typescript
      const exit = currentExitById.get(tr.exitId);
```

6. In `resetPanelState` after `currentExits = [];` (line ~776) add:

```typescript
  currentExitById = new Map();
```

- [ ] **Step 6: Verify build**

Run: `npx vitest run src/apps && npm run build:apps`
Expected: PASS / build succeeds

- [ ] **Step 7: Commit**

```bash
git add src/apps/shared/geo.ts src/apps/shared/geo.test.ts src/apps/traffic-analytics/junction-live/app.ts
git commit -m "fix(apps): closed-ring-aware junction centroid; O(1) exit lookup in turn-ratio table"
```

---

### Task 5: Shared DOM helpers (`dom.ts`) — kill 5× `el`/`hideWaiting`, 3× `escapeHtml`, 2× `clearAndHide`

**Files:**
- Create: `src/apps/shared/dom.ts`
- Create: `src/apps/shared/dom.test.ts` (escapeHtml only — pure string function)
- Modify: all 5 `src/apps/traffic-analytics/*/app.ts` (delete local copies, import shared)

**Interfaces:**
- Produces: `el<T extends HTMLElement = HTMLElement>(id: string): T | null`
- Produces: `hideWaiting(): void` (hides `#waiting-state`)
- Produces: `clearAndHide(id: string): void`
- Produces: `escapeHtml(text: string): string` — pure string-replace implementation (node-testable, no DOM element trick)

- [ ] **Step 1: Write the failing test**

Create `src/apps/shared/dom.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { escapeHtml } from "./dom";

describe("escapeHtml", () => {
  it("escapes all HTML-significant characters", () => {
    expect(escapeHtml(`<img src=x onerror="alert('xss')">&`)).toBe(
      "&lt;img src=x onerror=&quot;alert(&#39;xss&#39;)&quot;&gt;&amp;"
    );
  });
  it("passes plain text through unchanged", () => {
    expect(escapeHtml("A10 → Amsterdam")).toBe("A10 → Amsterdam");
  });
  it("handles the empty string", () => {
    expect(escapeHtml("")).toBe("");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/apps/shared/dom.test.ts`
Expected: FAIL — cannot resolve `./dom`

- [ ] **Step 3: Write the implementation**

Create `src/apps/shared/dom.ts`:

```typescript
/*
 * Copyright (C) 2025 TomTom Navigation B.V.
 * Licensed under the Apache License, Version 2.0
 */

/** Shorthand for `document.getElementById` with a typed cast. */
export function el<T extends HTMLElement = HTMLElement>(id: string): T | null {
  return document.getElementById(id) as T | null;
}

/** Hides the `#waiting-state` splash shown while the tool call is in flight. */
export function hideWaiting(): void {
  el("waiting-state")?.classList.add("hidden");
}

/** Empties an element's HTML and hides it (panel reset between tool calls). */
export function clearAndHide(id: string): void {
  const node = el(id);
  if (!node) return;
  node.innerHTML = "";
  node.classList.add("hidden");
}

const HTML_ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

/**
 * Escapes text for interpolation into innerHTML template strings.
 * Pure string implementation (no DOM element) so it is unit-testable in the
 * node vitest environment.
 */
export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => HTML_ESCAPES[c]);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/apps/shared/dom.test.ts`
Expected: PASS

- [ ] **Step 5: Migrate all 5 apps**

For each of `traffic-flow`, `traffic-incidents`, `area-analytics`, `route-details`, `junction-live` `app.ts`:

1. Add import (adjust names to what each app uses): `import { el, hideWaiting, escapeHtml, clearAndHide } from "@shared/dom";`
   - traffic-flow uses `el`, `hideWaiting`
   - area-analytics uses `el`, `hideWaiting`
   - traffic-incidents uses `el`, `hideWaiting`, `escapeHtml`
   - route-details uses `el`, `hideWaiting`, `escapeHtml`, `clearAndHide`
   - junction-live uses `el`, `hideWaiting`, `escapeHtml`, `clearAndHide`
2. Delete the local definitions of `el`, `hideWaiting`, `clearAndHide`, and the `_escapeDiv`+`escapeHtml` pair in each file (in the "DOM helpers" section of each app). Keep each app's other local helpers (`setPanelVisible`, `hideDetailCard`, etc.).

- [ ] **Step 6: Verify build + lint**

Run: `npx vitest run src/apps && npm run build:apps && npm run lint`
Expected: PASS / build succeeds / no new lint errors

- [ ] **Step 7: Commit**

```bash
git add src/apps/shared/dom.ts src/apps/shared/dom.test.ts src/apps/traffic-analytics
git commit -m "refactor(apps): shared DOM helpers — dedupe el/hideWaiting/escapeHtml/clearAndHide across 5 apps"
```

---

### Task 6: Single E2E map hook (`exposeMapForE2E`)

**Files:**
- Create: `src/apps/shared/e2e.ts`
- Modify: `src/apps/shared/map-controls.ts:39-40`

(The 5 apps' inline hooks are removed in Tasks 9–10 when the bootstrap takes over; this task creates the single definition and fixes the unconditional-overwrite idiom in map-controls.)

- [ ] **Step 1: Write the implementation** (no unit test — DOM/window; verified by build + e2e)

Create `src/apps/shared/e2e.ts`:

```typescript
/*
 * Copyright (C) 2025 TomTom Navigation B.V.
 * Licensed under the Apache License, Version 2.0
 */

import type { TomTomMap } from "@tomtom-org/maps-sdk/map";

/**
 * Exposes the underlying MapLibre map for Playwright E2E tests — map content
 * (markers, lines, tiles) is canvas-rendered, not DOM, so tests drive the map
 * through this handle. First map wins: never overwritten, so the handle
 * always refers to the app's primary map regardless of module init order.
 */
export function exposeMapForE2E(map: TomTomMap): void {
  const w = window as unknown as { __e2e_ml?: unknown };
  if (!w.__e2e_ml) {
    w.__e2e_ml = map.mapLibreMap;
  }
}
```

- [ ] **Step 2: Use it in map-controls.ts**

In `src/apps/shared/map-controls.ts`:

1. Add import: `import { exposeMapForE2E } from "./e2e";`
2. Replace lines 39-40:

```typescript
  // Expose MapLibre map instance for E2E test automation (markers are canvas-rendered, not DOM)
  (window as any).__e2e_ml = map.mapLibreMap;
```

with:

```typescript
  exposeMapForE2E(map);
```

- [ ] **Step 3: Verify build**

Run: `npm run build:apps`
Expected: build succeeds

- [ ] **Step 4: Commit**

```bash
git add src/apps/shared/e2e.ts src/apps/shared/map-controls.ts
git commit -m "refactor(apps): single guarded exposeMapForE2E helper (was set in 6 places, 2 idioms)"
```

---

### Task 7: Generic feature-state tracker — migrate junction-live's 4 hand-rolled setters

**Files:**
- Create: `src/apps/shared/feature-state.ts`
- Create: `src/apps/shared/feature-state.test.ts`
- Modify: `src/apps/traffic-analytics/route-details/app.ts` (~276-301: replace local `setState` with shared factory)
- Modify: `src/apps/traffic-analytics/junction-live/app.ts` (~166-177, ~297-352, ~745-777: replace 4 setters + 5 `prev*` vars)

**Interfaces:**
- Produces:
```typescript
export interface FeatureStateHost {
  map: { mapLibreMap: MapLibreLike } | undefined;
  geoModule: { sourceAndLayerIDs: Record<string, { sourceID: string }> } | undefined;
}
export function createFeatureStateSetter(
  getHost: () => FeatureStateHost
): (source: string, id: string | number | null, state: string) => void
```
Semantics identical to route-details' current `setState`: removes the previously flagged feature's state for that (source, state) pair, then flags the new id (or nothing when `null`).

- [ ] **Step 1: Write the failing test**

Create `src/apps/shared/feature-state.test.ts` (fake map/geoModule objects — no DOM needed):

```typescript
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/apps/shared/feature-state.test.ts`
Expected: FAIL — cannot resolve `./feature-state`

- [ ] **Step 3: Write the implementation**

Create `src/apps/shared/feature-state.ts`:

```typescript
/*
 * Copyright (C) 2025 TomTom Navigation B.V.
 * Licensed under the Apache License, Version 2.0
 */

/** Structural types so the tracker is testable without the maps SDK. */
interface MapLibreLike {
  setFeatureState(target: { source: string; id: string }, state: Record<string, boolean>): void;
  removeFeatureState(target: { source: string; id: string }, state?: string): void;
}

export interface FeatureStateHost {
  map: { mapLibreMap: MapLibreLike } | undefined;
  geoModule: { sourceAndLayerIDs: Record<string, { sourceID: string }> } | undefined;
}

/**
 * Creates a MapLibre feature-state setter that tracks the previously flagged
 * feature id per (source, state) pair, so at most one feature per pair is
 * ever flagged. Passing `null` clears the pair.
 *
 * `getHost` is read on every call so the tracker can be created at module
 * scope before the map/geoModule exist (calls before init are no-ops).
 */
export function createFeatureStateSetter(
  getHost: () => FeatureStateHost
): (source: string, id: string | number | null, state: string) => void {
  const prev: Record<string, Record<string, string | null>> = {};

  return function setState(source: string, id: string | number | null, state: string): void {
    const { map, geoModule } = getHost();
    if (!map || !geoModule) return;
    const sourceID = geoModule.sourceAndLayerIDs[source].sourceID;

    const prevBySource = (prev[source] ??= {});
    const prevId = prevBySource[state] ?? null;
    if (prevId !== null) {
      map.mapLibreMap.removeFeatureState({ source: sourceID, id: prevId }, state);
    }
    const next = id !== null ? String(id) : null;
    if (next !== null) {
      map.mapLibreMap.setFeatureState({ source: sourceID, id: next }, { [state]: true });
    }
    prevBySource[state] = next;
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/apps/shared/feature-state.test.ts`
Expected: PASS

- [ ] **Step 5: Migrate route-details/app.ts**

1. Add import: `import { createFeatureStateSetter } from "@shared/feature-state";`
2. Replace the "Feature-state helper" section (lines ~276-301: the `StateSource`/`StateName` types, `prevFeatureIds` record, and `setState` function) with:

```typescript
// ---------------------------------------------------------------------------
// Feature-state helper — shared tracker; at most one feature per
// (source, state) pair is ever flagged.
// ---------------------------------------------------------------------------

type StateSource = "routes" | "segments";
type StateName = "hover" | "selected";

const setFeatureStateRaw = createFeatureStateSetter(() => ({ map, geoModule }));

function setState(source: StateSource, id: string | number | null, state: StateName): void {
  setFeatureStateRaw(source, id, state);
}
```

(The typed wrapper preserves the existing narrow call signature; all call sites stay unchanged.)

- [ ] **Step 6: Migrate junction-live/app.ts**

1. Add import: `import { createFeatureStateSetter } from "@shared/feature-state";`
2. Delete the module-state vars `prevSelectedJunctionFeatureId`, `prevSelectedApproachFeatureId`, `prevHoverApproachFeatureId`, `prevHoverExitFeatureId` (lines ~169, 175-177).
3. Replace the whole "Feature-state helpers" section (`setJunctionSelected`, `setApproachSelected`, `setApproachHover`, `setExitHover`, lines ~297-352) with:

```typescript
// ---------------------------------------------------------------------------
// Feature-state helpers — shared tracker; at most one feature per
// (source, state) pair is ever flagged.
// ---------------------------------------------------------------------------

const setState = createFeatureStateSetter(() => ({ map, geoModule }));

function setJunctionSelected(id: string | null): void {
  setState("junctions", id, "selected");
}

function setApproachSelected(id: number | null): void {
  setState("approaches", id !== null ? "a-" + id : null, "selected");
}

function setApproachHover(id: number | null): void {
  setState("approaches", id !== null ? "a-" + id : null, "hover");
  syncApproachCardHover(id);
}

function setExitHover(exitId: number | null): void {
  setState("exits", exitId !== null ? "x-" + exitId : null, "hover");
}
```

4. In `resetPanelState`, delete the four `prev* = null;` reset lines (~769, 772-774) — the tracker state is fully reset by the four `set*(null)` calls at the top of the function, which remain.

Note: `setJunctionSelected` previously called `removeFeatureState` without a state name (removing ALL states); junction points only ever get the `selected` state, so the per-state removal is equivalent.

- [ ] **Step 7: Verify build + tests**

Run: `npx vitest run src/apps && npm run build:apps`
Expected: PASS / build succeeds

- [ ] **Step 8: Commit**

```bash
git add src/apps/shared/feature-state.ts src/apps/shared/feature-state.test.ts src/apps/traffic-analytics/route-details/app.ts src/apps/traffic-analytics/junction-live/app.ts
git commit -m "refactor(apps): shared feature-state tracker replaces 4 hand-rolled setters + 5 tracking vars"
```

---

### Task 8: Shared gradient CSS builder

**Files:**
- Modify: `src/apps/shared/speed-colors.ts` (add `gradientCss`, use in `renderRampLegend`)
- Modify: `src/apps/shared/speed-colors.test.ts` (add tests)
- Modify: `src/apps/traffic-analytics/area-analytics/app.ts:213-218` (use `gradientCss`)

**Interfaces:**
- Produces: `gradientCss(stops: ReadonlyArray<{ value: number; color: string }>): string` — `"#e03030 0.0%, #f5a623 60.0%, #2dc653 100.0%"` (positions normalized by the stops' own min/max; zero span guarded).

- [ ] **Step 1: Write the failing test**

Append to `src/apps/shared/speed-colors.test.ts` (extend the import from `./speed-colors` with `gradientCss`):

```typescript
describe("gradientCss", () => {
  it("normalizes stop positions by the stops' own min/max", () => {
    expect(
      gradientCss([
        { value: 0.4, color: "#e03030" },
        { value: 0.7, color: "#f5a623" },
        { value: 0.9, color: "#2dc653" },
      ])
    ).toBe("#e03030 0.0%, #f5a623 60.0%, #2dc653 100.0%");
  });
  it("guards a zero span (all stops equal)", () => {
    expect(gradientCss([{ value: 5, color: "#111111" }, { value: 5, color: "#222222" }])).toBe(
      "#111111 0.0%, #222222 0.0%"
    );
  });
  it("returns empty string for no stops", () => {
    expect(gradientCss([])).toBe("");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/apps/shared/speed-colors.test.ts`
Expected: FAIL — `gradientCss` not exported

- [ ] **Step 3: Write the implementation**

In `src/apps/shared/speed-colors.ts`:

1. Add before `renderRampLegend`:

```typescript
/**
 * Builds the color-stop list of a `linear-gradient()` from value/color stops,
 * normalizing positions by the stop values' own min/max (the stop domain
 * varies: 0–1 fractions for ratio ramps, 0–100 or raw units for analytics
 * metric configs). Zero-span stop lists collapse to position 0%.
 */
export function gradientCss(
  stops: ReadonlyArray<{ value: number; color: string }>
): string {
  if (stops.length === 0) return "";
  const values = stops.map((s) => s.value);
  const min = Math.min(...values);
  const span = Math.max(...values) - min || 1;
  return stops
    .map((s) => `${s.color} ${(((s.value - min) / span) * 100).toFixed(1)}%`)
    .join(", ");
}
```

2. Replace the gradient computation inside `renderRampLegend` (lines ~43-47):

```typescript
  const min = RATIO_STOPS[0][0];
  const max = RATIO_STOPS[RATIO_STOPS.length - 1][0];
  const gradient = RATIO_STOPS.map(
    ([v, c]) => `${c} ${(((v - min) / (max - min)) * 100).toFixed(1)}%`
  ).join(", ");
```

with:

```typescript
  const gradient = gradientCss(RATIO_STOPS.map(([value, color]) => ({ value, color })));
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/apps/shared/speed-colors.test.ts`
Expected: PASS

- [ ] **Step 5: Use in area-analytics renderLegend**

In `src/apps/traffic-analytics/area-analytics/app.ts`:

1. Add import: `import { gradientCss } from "@shared/speed-colors";`
2. Replace lines ~213-218:

```typescript
  const stopValues = stops.map((s) => s.value);
  const stopMin = Math.min(...stopValues);
  const stopSpan = Math.max(...stopValues) - stopMin || 1;
  const gradient = stops
    .map((s) => `${s.color} ${(((s.value - stopMin) / stopSpan) * 100).toFixed(1)}%`)
    .join(", ");
```

with:

```typescript
  const gradient = gradientCss(stops);
```

(Keep the explanatory comment above about stop-value scales — it documents why normalization is by the stops' own min/max.)

- [ ] **Step 6: Verify build**

Run: `npx vitest run src/apps && npm run build:apps`
Expected: PASS / build succeeds

- [ ] **Step 7: Commit**

```bash
git add src/apps/shared/speed-colors.ts src/apps/shared/speed-colors.test.ts src/apps/traffic-analytics/area-analytics/app.ts
git commit -m "refactor(apps): shared gradientCss builder for ramp + analytics legends"
```

---

### Task 9: `bootstrapVizApp` shared lifecycle + migrate traffic-flow and area-analytics

**Files:**
- Create: `src/apps/shared/app-bootstrap.ts`
- Modify: `src/apps/traffic-analytics/traffic-flow/app.ts`
- Modify: `src/apps/traffic-analytics/area-analytics/app.ts`

**Interfaces:**
- Produces (consumed by Task 10 as well):

```typescript
export interface VizAppOptions<T> {
  name: string;                       // App identifier, e.g. "tta-traffic-flow"
  panelId: string;                    // side panel DOM id hidden on error/hidden states
  errorMessage: string;               // message when the tool result isError
  validate: (viz: unknown) => viz is T;
  resetUI?: () => void;               // extra cleanup on every non-render path
  render: (ctx: { app: App; map: TomTomMap; viz: T }) => Promise<void>;
  teardown?: () => void;              // hide app modules on onteardown
}
export function bootstrapVizApp<T>(options: VizAppOptions<T>): App;
export const EXPIRED_MESSAGE: string;  // "Visualization data expired — re-run the tool"
export const NO_KEY_MESSAGE: string;   // "TOMTOM_API_KEY not configured — map unavailable"
```

No unit test (DOM/App/SDK objects; node env) — verified by `npm run build:apps`, lint, and e2e.

- [ ] **Step 1: Write the implementation**

Create `src/apps/shared/app-bootstrap.ts`:

```typescript
/*
 * Copyright (C) 2025 TomTom Navigation B.V.
 * Licensed under the Apache License, Version 2.0
 */

import { App } from "@modelcontextprotocol/ext-apps";
import { TomTomMap } from "@tomtom-org/maps-sdk/map";
import { ensureTomTomConfigured } from "./sdk-config";
import { extractFullData } from "./viz-data";
import { shouldShowUI, showMapUI, hideMapUI, showErrorUI } from "./ui-visibility";
import { el, hideWaiting } from "./dom";
import { exposeMapForE2E } from "./e2e";

export const EXPIRED_MESSAGE = "Visualization data expired — re-run the tool";
export const NO_KEY_MESSAGE = "TOMTOM_API_KEY not configured — map unavailable";

export interface VizAppOptions<T> {
  /** App identifier, e.g. "tta-traffic-flow" — App() name and log prefix. */
  name: string;
  /** DOM id of the side panel hidden on error/hidden states. */
  panelId: string;
  /** Message shown when the tool result itself is an error. */
  errorMessage: string;
  /** Type guard for the viz payload; `false` shows the "expired" state. */
  validate: (viz: unknown) => viz is T;
  /** Extra UI cleanup applied on every non-render path (e.g. hide a detail card). */
  resetUI?: () => void;
  /** Renders the payload. `map` is created lazily once and reused across calls. */
  render: (ctx: { app: App; map: TomTomMap; viz: T }) => Promise<void>;
  /** Hides app-specific map modules on host teardown. */
  teardown?: () => void;
}

/**
 * Shared MCP-app lifecycle: parse the tool result, gate on show_ui / API key /
 * payload validity (with the standard error UIs), lazily create the standard
 * map, and hand off to the app's render callback.
 *
 * Registers all hooks before connect() (ext-apps 1.7 rule) and connects —
 * call once at module scope; per-app code is just its renderer.
 */
export function bootstrapVizApp<T>(options: VizAppOptions<T>): App {
  const app = new App({ name: options.name, version: "1.0.0" });
  let map: TomTomMap | undefined;

  const setPanelVisible = (visible: boolean): void => {
    el(options.panelId)?.classList.toggle("hidden", !visible);
  };

  const fail = (message: string): void => {
    setPanelVisible(false);
    options.resetUI?.();
    showErrorUI(message);
  };

  app.ontoolinput = async (): Promise<void> => {
    hideWaiting();
  };

  app.ontoolresult = async (result): Promise<void> => {
    hideWaiting();

    if (result.isError) {
      fail(options.errorMessage);
      return;
    }

    const rawText = (result.content?.[0] as { text?: string } | undefined)?.text ?? "{}";
    const parsedResp = JSON.parse(rawText);

    if (!shouldShowUI(parsedResp)) {
      setPanelVisible(false);
      options.resetUI?.();
      hideMapUI();
      return;
    }

    if (!(await ensureTomTomConfigured(app))) {
      fail(NO_KEY_MESSAGE);
      return;
    }

    const viz = await extractFullData(app, parsedResp);
    if (!options.validate(viz)) {
      fail(EXPIRED_MESSAGE);
      return;
    }

    showMapUI();

    map ??= new TomTomMap({
      style: "standardLight",
      mapLibre: { container: "sdk-map", center: [0, 0], zoom: 2 },
    });
    exposeMapForE2E(map);

    await options.render({ app, map, viz });
  };

  app.onteardown = async (): Promise<Record<string, never>> => {
    options.teardown?.();
    return {};
  };

  void (async () => {
    try {
      await app.connect();
    } catch (error) {
      // Expected when opened standalone (no MCP host) — e.g. local smoke testing.
      console.warn(`[${options.name}] Failed to connect to MCP host:`, error);
    }
  })();

  return app;
}
```

- [ ] **Step 2: Migrate traffic-flow/app.ts**

1. Replace the import of `App` and the shared-module imports so the lifecycle imports come from the bootstrap:
   - Remove: `import { App } from "@modelcontextprotocol/ext-apps";`, and remove `ensureTomTomConfigured`, `extractFullData`, `shouldShowUI`/`showMapUI`/`hideMapUI`/`showErrorUI` imports (keep any the render body still uses — after migration the render body uses none of the gating helpers).
   - Add: `import { bootstrapVizApp } from "@shared/app-bootstrap";`
2. Delete `const app = new App({ name: "tta-traffic-flow", version: "1.0.0" });` (line ~65). Keep the `map`/`geoModule`/`flowBackdrop`/`backdropOn` module state.
3. Delete the whole "MCP App lifecycle" section: `app.ontoolinput`, `app.ontoolresult`, `app.onteardown`, `connectApp`, and `void connectApp();` (lines ~167-322).
4. At the end of the file, add (the render body is the existing `ontoolresult` code AFTER the old `showMapUI();`/map-creation/E2E-hook lines, i.e. old lines ~216-304, with these exact substitutions — `viz` is now typed `VizPayload` from the guard, `map` comes from ctx):

```typescript
// ---------------------------------------------------------------------------
// MCP App lifecycle — shared bootstrap owns parse/gates/map creation.
// ---------------------------------------------------------------------------

bootstrapVizApp<VizPayload>({
  name: "tta-traffic-flow",
  panelId: "flow-panel",
  errorMessage: "Failed to fetch traffic flow data",
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- viz shape is unverified after a cache-miss fallback
  validate: (viz): viz is VizPayload => Array.isArray((viz as any)?.segment?.coordinates),
  render: async ({ map: m, viz }) => {
    map = m;

    // >>> PASTE the old ontoolresult body from AFTER the exposeMapForE2E/E2E-hook
    // block through the end of the handler (old lines ~216-304), UNCHANGED:
    // flowBackdrop ??= ...; geoModule ??= ...; const seg = ...; await geoModule.show(...);
    // setPanelVisible(true); renderStats(viz); legend; fitBounds.
  },
  teardown: () => {
    geoModule?.setVisible(false);
    flowBackdrop?.setVisible(false);
  },
});
```

5. `setPanelVisible` stays as the app-local helper (used inside the render body).

- [ ] **Step 3: Migrate area-analytics/app.ts**

Same mechanical transformation:

1. Imports: remove `App`, `ensureTomTomConfigured`, `extractFullData`, `shouldShowUI`/`showMapUI`/`hideMapUI`/`showErrorUI`; add `import { bootstrapVizApp } from "@shared/app-bootstrap";`
2. Delete `const app = new App({ name: "tta-area-analytics", ... });` (line ~66).
3. Delete `app.ontoolinput`, `app.ontoolresult`, `app.onteardown`, `connectApp`, `void connectApp();` (lines ~428-544).
4. Append:

```typescript
// ---------------------------------------------------------------------------
// MCP App lifecycle — shared bootstrap owns parse/gates/map creation.
// ---------------------------------------------------------------------------

bootstrapVizApp<VizPayload>({
  name: "tta-area-analytics",
  panelId: "analytics-panel",
  errorMessage: "Failed to fetch area analytics",
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- viz shape is unverified after a cache-miss fallback
  validate: (viz): viz is VizPayload => Boolean((viz as any)?.report),
  resetUI: hideTooltip, // panel hide previously also hid the tile tooltip
  render: async ({ map: m, viz }) => {
    map = m;

    // >>> PASTE the old ontoolresult body from AFTER the E2E-hook block through
    // the end of the handler (old lines ~477-527), UNCHANGED:
    // currentRequest = viz.request ?? {}; normalized/parse; module init; hover
    // binding; clearFilter; show; setPanelVisible(true); renders; fitBounds try/catch.
  },
  teardown: () => {
    analyticsModule?.setVisible(false);
  },
});
```

Note: the old local `setPanelVisible(false)` also hid `#tile-tooltip`; the bootstrap toggles the panel by id only, so `resetUI: hideTooltip` preserves that behavior on all failure paths. `setPanelVisible` (local) stays for the render body's `setPanelVisible(true)`.

- [ ] **Step 4: Verify build + lint**

Run: `npm run build:apps && npm run lint && npx vitest run src/apps`
Expected: build succeeds, no lint errors, tests pass

- [ ] **Step 5: Commit**

```bash
git add src/apps/shared/app-bootstrap.ts src/apps/traffic-analytics/traffic-flow/app.ts src/apps/traffic-analytics/area-analytics/app.ts
git commit -m "refactor(apps): shared bootstrapVizApp lifecycle; migrate traffic-flow and area-analytics"
```

---

### Task 10: Migrate traffic-incidents, route-details, junction-live to `bootstrapVizApp`

**Files:**
- Modify: `src/apps/traffic-analytics/traffic-incidents/app.ts`
- Modify: `src/apps/traffic-analytics/route-details/app.ts`
- Modify: `src/apps/traffic-analytics/junction-live/app.ts`

**Interfaces:**
- Consumes: `bootstrapVizApp<T>(options: VizAppOptions<T>): App` from Task 9 (exact signature above).

Apply the identical mechanical transformation as Task 9 to each app. Per-app parameters:

| app | name | panelId | errorMessage | validate | resetUI | teardown |
|---|---|---|---|---|---|---|
| traffic-incidents | `tta-traffic-incidents` | `incident-panel` | `Failed to fetch traffic incidents` | `Array.isArray((viz as any)?.areas)` | `hideDetailCard` | `overlay?.setVisible(false)` |
| route-details | `tta-route-details` | `route-panel` | `Failed to fetch route data` | `Array.isArray((viz as any)?.routes)` | — | `geoModule?.setVisible(false)` |
| junction-live | `tta-junction-live` | `junction-panel` | `Failed to fetch junction data` | `Array.isArray((viz as any)?.junctions)` | `hideDetailCard` | `geoModule?.setVisible(false)` |

- [ ] **Step 1: Migrate traffic-incidents/app.ts**

1. Imports: remove `App`, `ensureTomTomConfigured`, `extractFullData`, `shouldShowUI`/`showMapUI`/`hideMapUI`/`showErrorUI`; add `import { bootstrapVizApp } from "@shared/app-bootstrap";`
2. Delete `const app = new App({ name: "tta-traffic-incidents", ... });` (line ~52) — **note:** nothing else in this app references `app` outside the lifecycle, so no further changes.
3. Delete lifecycle section (old lines ~349-445: `ontoolinput`, `ontoolresult`, `onteardown`, `connectApp`, `void connectApp();`).
4. Append:

```typescript
// ---------------------------------------------------------------------------
// MCP App lifecycle — shared bootstrap owns parse/gates/map creation.
// ---------------------------------------------------------------------------

bootstrapVizApp<VizPayload>({
  name: "tta-traffic-incidents",
  panelId: "incident-panel",
  errorMessage: "Failed to fetch traffic incidents",
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- viz shape is unverified after a cache-miss fallback
  validate: (viz): viz is VizPayload => Array.isArray((viz as any)?.areas),
  resetUI: hideDetailCard,
  render: async ({ map: m, viz }) => {
    map = m;

    if (!overlay) {
      overlay = await TrafficIncidentOverlayModule.get(map);
    }
    if (!overlayClickBound && overlay) {
      overlay.events.on("click", handleOverlayClick);
      overlayClickBound = true;
    }

    areaNames = viz.areas.map((a) => a.name);
    activeAreaFilter = null;
    clearFocus();

    // (dedupe block from Task 2 — allFeatures/featuresById — stays here unchanged)

    setPanelVisible(true);
    renderAreaFilters(areaNames);
    await applyFilter();
    fitMapToAreas(viz.areas);
  },
  teardown: () => {
    overlay?.setVisible(false);
  },
});
```

(The render body above is the complete existing post-gate body — carry over the Task 2 dedupe block verbatim where the comment indicates.)

- [ ] **Step 2: Migrate route-details/app.ts**

1. Imports as in Step 1; delete `const app = new App(...)` (line ~157) and lifecycle (old lines ~679-877).
2. Append — the render body is the old post-E2E-hook body (geoModule init with the full sources/layers config, the four event bindings, `await resetPanelState(); setPanelVisible(true);` and mode dispatch), moved UNCHANGED:

```typescript
// ---------------------------------------------------------------------------
// MCP App lifecycle — shared bootstrap owns parse/gates/map creation.
// ---------------------------------------------------------------------------

bootstrapVizApp<VizPayload>({
  name: "tta-route-details",
  panelId: "route-panel",
  errorMessage: "Failed to fetch route data",
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- viz shape is unverified after a cache-miss fallback
  validate: (viz): viz is VizPayload => Array.isArray((viz as any)?.routes),
  render: async ({ map: m, viz }) => {
    map = m;

    // >>> PASTE old lines ~728-860 UNCHANGED: geoModule ??= CustomGeoJSONModule.get(...)
    // with the full routes/segments layer config; the routesClick/routesHover/
    // segmentsClick/segmentsHover bindings; await resetPanelState();
    // setPanelVisible(true); currentMode dispatch to renderDetailsMode/renderSearchMode.
  },
  teardown: () => {
    geoModule?.setVisible(false);
  },
});
```

- [ ] **Step 3: Migrate junction-live/app.ts**

1. Imports as above; delete `const app = new App(...)` (line ~152) and lifecycle (old lines ~783-971).
2. Append:

```typescript
// ---------------------------------------------------------------------------
// MCP App lifecycle — shared bootstrap owns parse/gates/map creation.
// ---------------------------------------------------------------------------

bootstrapVizApp<VizPayload>({
  name: "tta-junction-live",
  panelId: "junction-panel",
  errorMessage: "Failed to fetch junction data",
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- viz shape is unverified after a cache-miss fallback
  validate: (viz): viz is VizPayload => Array.isArray((viz as any)?.junctions),
  resetUI: hideDetailCard,
  render: async ({ map: m, viz }) => {
    map = m;

    // >>> PASTE old lines ~836-954 UNCHANGED: geoModule ??= CustomGeoJSONModule.get(...)
    // with junctions/approaches/exits layer config; junctionsClick/approachesClick/
    // approachesHover bindings; await resetPanelState(); setPanelVisible(true);
    // currentMode dispatch to renderLiveMode/renderSearchMode.
  },
  teardown: () => {
    geoModule?.setVisible(false);
  },
});
```

- [ ] **Step 4: Confirm no dangling references**

Grep each migrated app for `app\.` and `connectApp` — the only remaining `app` usages must be inside `bootstrapVizApp` (there should be none at module scope; `ensureTomTomConfigured`/`extractFullData` imports must be gone).

Run: `npm run build:apps && npm run lint && npx vitest run src/apps`
Expected: build succeeds, no lint errors (including unused-import errors), tests pass

- [ ] **Step 5: Commit**

```bash
git add src/apps/traffic-analytics
git commit -m "refactor(apps): migrate incidents, route-details, junction-live to bootstrapVizApp — 5 copies of the lifecycle become 1"
```

---

### Task 11: `buildVizMeta` handler helper + handler efficiency fixes

**Files:**
- Create: `src/handlers/helpers/vizMeta.ts`
- Create: `src/handlers/helpers/vizMeta.test.ts`
- Modify: `src/handlers/areaAnalyticsHandler.ts` (1 site, ~75-97)
- Modify: `src/handlers/liveTrafficHandler.ts` (2 sites, ~78-98 and ~243-261; merge loop ~223-229; stringify ~121, ~283)
- Modify: `src/handlers/routeMonitoringHandler.ts` (2 sites, ~84-98 and ~211-225; merge loop ~191-197; stringify ~118, ~246)
- Modify: `src/handlers/junctionAnalyticsHandler.ts` (2 sites, ~89-103 and ~223-237; merge loop ~203-209; stringify in both success paths)

**Interfaces:**
- Produces:

```typescript
export interface VizMeta { show_ui: boolean; viz_id?: string }
export function buildVizMeta(
  show_ui: boolean | undefined,
  label: string,
  buildPayload: () => unknown
): VizMeta
```

Behavior: `show_ui === false` → `{ show_ui: false }` without calling `buildPayload`; otherwise stores the payload and returns `{ show_ui: true, viz_id }`; a `storeVizData` throw is logged as `` `Failed to cache ${label} viz payload: ${message}` `` and returns `{ show_ui: false }`.

- [ ] **Step 1: Write the failing test**

Create `src/handlers/helpers/vizMeta.test.ts`:

```typescript
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/handlers/helpers/vizMeta.test.ts`
Expected: FAIL — cannot resolve `./vizMeta`

- [ ] **Step 3: Write the implementation**

Create `src/handlers/helpers/vizMeta.ts` (with the standard Apache header):

```typescript
import { logger } from "../../utils/logger";
import { storeVizData } from "../../services/cache/vizCache";

export interface VizMeta {
  show_ui: boolean;
  viz_id?: string;
}

/**
 * Caches a raw API payload for the MCP App to render and returns the `_meta`
 * block for the tool response. One code path for all handlers: skips caching
 * when the caller disabled the UI, and degrades to `show_ui: false` (logged)
 * when the cache write fails so the text/SQL response is never blocked by
 * visualization plumbing.
 *
 * @param show_ui - The tool's `show_ui` parameter (undefined = enabled)
 * @param label - Human label for the failure log, e.g. "route search"
 * @param buildPayload - Lazily builds the payload; not called when disabled
 */
export function buildVizMeta(
  show_ui: boolean | undefined,
  label: string,
  buildPayload: () => unknown
): VizMeta {
  if (show_ui === false) {
    return { show_ui: false };
  }
  try {
    return { show_ui: true, viz_id: storeVizData(buildPayload()) };
  } catch (error) {
    logger.error(`Failed to cache ${label} viz payload: ${(error as Error).message}`);
    return { show_ui: false };
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/handlers/helpers/vizMeta.test.ts`
Expected: PASS

- [ ] **Step 5: Replace all 7 handler viz blocks**

In each handler, add `import { buildVizMeta } from "./helpers/vizMeta";`, remove the now-unused `import { storeVizData } from "../services/cache/vizCache";`, and replace each `let vizMeta ... if (show_ui !== false) { try { ... } catch ... } else { ... }` block with a single `const vizMeta = buildVizMeta(...)` call. Exact replacements (payload expressions unchanged from current code):

`src/handlers/areaAnalyticsHandler.ts` (~75-97):

```typescript
      // 6. Cache the raw report for the MCP App to render, unless disabled
      const vizMeta = buildVizMeta(show_ui, "Area Analytics", () => ({
        tool: "tomtom-area-analytics-stats",
        request: {
          name: request.name,
          startDate: request.startDate,
          endDate: request.endDate,
          dataTypes: request.dataTypes,
          hours: request.hours,
          frcs: request.frcs,
        },
        report: rawResult,
      }));
```

`src/handlers/liveTrafficHandler.ts` flow (~77-98):

```typescript
      // 6. Cache the raw segment for the MCP App to render, unless disabled
      const vizMeta = buildVizMeta(show_ui, "traffic flow", () => ({
        tool: "tomtom-traffic-flow-segment",
        request: {
          point: request.point,
          style: request.style,
          zoom: request.zoom,
          unit: request.unit,
        },
        segment: rawResult,
      }));
```

`src/handlers/liveTrafficHandler.ts` incidents (~242-261):

```typescript
      // 6. Cache the raw per-area results for the MCP App to render, unless disabled
      const vizMeta = buildVizMeta(show_ui, "traffic incidents", () => ({
        tool: "tomtom-traffic-incidents",
        areas: rawResults.map(({ areaName, bbox, data }) => ({
          name: areaName,
          bbox,
          incidents: data,
        })),
      }));
```

`src/handlers/routeMonitoringHandler.ts` search (~83-98):

```typescript
      // 6. Cache the raw route list for the MCP App to render, unless disabled
      const vizMeta = buildVizMeta(show_ui, "route search", () => ({
        tool: "tomtom-route-search",
        routes: allRoutes,
      }));
```

`src/handlers/routeMonitoringHandler.ts` details (~210-225):

```typescript
      // 6. Cache the raw route details for the MCP App to render, unless disabled
      const vizMeta = buildVizMeta(show_ui, "route details", () => ({
        tool: "tomtom-route-monitoring-details",
        routes: rawResults,
      }));
```

`src/handlers/junctionAnalyticsHandler.ts` search (~88-103):

```typescript
      // 7. Cache the raw junction catalog for the MCP App to render, unless disabled
      const vizMeta = buildVizMeta(show_ui, "junction search", () => ({
        tool: "tomtom-junction-search",
        junctions: allJunctions,
      }));
```

`src/handlers/junctionAnalyticsHandler.ts` live (~222-237):

```typescript
      // 6. Cache the raw (unstripped) junctions for the MCP App to render, unless disabled
      const vizMeta = buildVizMeta(show_ui, "junction live data", () => ({
        tool: "tomtom-junction-live-data",
        junctions: rawResults,
      }));
```

- [ ] **Step 6: Fix the O(n²) table merges (3 sites)**

In `liveTrafficHandler.ts` (~223-229), `routeMonitoringHandler.ts` (~191-197), and `junctionAnalyticsHandler.ts` (~203-209), replace the merge loop body:

```typescript
        for (const [tableName, rows] of flattened.tables) {
          const existing = mergedTables.get(tableName) ?? [];
          mergedTables.set(tableName, [...existing, ...rows]);
        }
```

with:

```typescript
        for (const [tableName, rows] of flattened.tables) {
          const existing = mergedTables.get(tableName);
          if (existing) {
            existing.push(...rows);
          } else {
            mergedTables.set(tableName, [...rows]);
          }
        }
```

- [ ] **Step 7: Drop pretty-printing on machine-consumed responses**

In all four handlers, replace every success/error `JSON.stringify(response, null, 2)` and `JSON.stringify({ error: ... }, null, 2)` with `JSON.stringify(response)` / `JSON.stringify({ error: error.message })`. (Grep: `stringify\(.*null, 2\)` under `src/handlers/` — replace every hit. The responses are parsed by the LLM host and the apps; the 2-space indent is pure wire cost.)

- [ ] **Step 8: Run handler + full unit tests**

Run: `npx vitest run src/handlers && npx vitest run`
Expected: PASS. If any handler test asserts on pretty-printed text (rather than `JSON.parse`-ing it), update the assertion to parse instead.

- [ ] **Step 9: Commit**

```bash
git add src/handlers
git commit -m "refactor(handlers): buildVizMeta collapses 7 duplicated viz-cache blocks; linear table merge; compact JSON responses"
```

---

### Task 12: Bound the viz cache (FIFO eviction)

**Files:**
- Modify: `src/services/cache/vizCache.ts`
- Modify: `src/services/cache/vizCache.test.ts` (add tests)

**Interfaces:**
- `storeVizData` unchanged externally; internally evicts the oldest entry beyond `MAX_VIZ_ENTRIES = 50`.

- [ ] **Step 1: Write the failing test**

Append to `src/services/cache/vizCache.test.ts`:

```typescript
  describe("entry bound (FIFO eviction)", () => {
    it("evicts the oldest entry once more than 50 entries are stored", () => {
      const ids: string[] = [];
      for (let i = 0; i < 51; i++) {
        ids.push(storeVizData({ i }));
      }
      // Oldest evicted, newest 50 retained
      expect(getVizData(ids[0])).toBeUndefined();
      expect(getVizData(ids[1])).toEqual({ i: 1 });
      expect(getVizData(ids[50])).toEqual({ i: 50 });
      expect(getCacheStats().keys).toBe(50);
    });

    it("does not evict anything at exactly the bound", () => {
      const ids: string[] = [];
      for (let i = 0; i < 50; i++) {
        ids.push(storeVizData({ i }));
      }
      expect(getVizData(ids[0])).toEqual({ i: 0 });
      expect(getCacheStats().keys).toBe(50);
    });
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/services/cache/vizCache.test.ts`
Expected: FAIL — 51 keys retained, oldest still present

- [ ] **Step 3: Write the implementation**

In `src/services/cache/vizCache.ts`:

1. After `const vizCache = new NodeCache(CACHE_CONFIG);` add:

```typescript
/**
 * Hard bound on resident entries. Every tool call stores its full raw
 * upstream response (multi-MB for multi-bbox incidents or area reports) for
 * the whole TTL window, and nothing deletes entries on consumption — without
 * a bound, a burst of tool calls retains all of them for 5 minutes.
 * node-cache has no LRU support, so insertion order (FIFO) is tracked here;
 * TTL-expired keys are pruned from the queue lazily via `has()`.
 */
const MAX_VIZ_ENTRIES = 50;
const insertionOrder: string[] = [];
```

2. Replace `storeVizData` with:

```typescript
export function storeVizData(data: unknown): string {
  const vizId = randomUUID();
  vizCache.set(vizId, data);
  insertionOrder.push(vizId);

  // Drop already-expired keys from the queue, then evict oldest beyond the bound.
  while (insertionOrder.length > 0 && !vizCache.has(insertionOrder[0])) {
    insertionOrder.shift();
  }
  while (insertionOrder.length > MAX_VIZ_ENTRIES) {
    const oldest = insertionOrder.shift();
    if (oldest !== undefined) {
      vizCache.del(oldest);
      logger.debug(`vizCache: evicted ${oldest} (FIFO bound ${MAX_VIZ_ENTRIES})`);
    }
  }

  logger.debug(`vizCache: stored ${vizId}`);
  return vizId;
}
```

3. In `clearVizCache`, add `insertionOrder.length = 0;` before `vizCache.flushAll();`.
4. Extend the module doc comment (lines 36-39) to note the known limitation: *"Per-process only: in multi-process/load-balanced HTTP deployments a `tomtom-get-viz-data` call routed to a different process misses the cache and the app falls back to its localStorage copy or the 'expired' state. viz_ids are unguessable UUIDs but not session-bound."*

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/services/cache/vizCache.test.ts`
Expected: PASS (all, including pre-existing)

- [ ] **Step 5: Commit**

```bash
git add src/services/cache/vizCache.ts src/services/cache/vizCache.test.ts
git commit -m "fix(cache): bound viz cache to 50 entries (FIFO) — raw API payloads no longer accumulate unbounded"
```

---

### Task 13: mtime-aware resource memoization + no path disclosure

**Files:**
- Modify: `src/tools/helpers/resourceRegistry.ts`
- Modify: `src/tools/helpers/resourceRegistry.test.ts`

Behavior change: the header comment currently PROMISES `npm run build:apps` is picked up without a restart, but memoization makes that true only until the first successful read. Fix by storing `{ html, mtimeMs }` and `fs.stat`-ing before serving from cache. Also stop echoing the absolute server path into the client-visible error HTML (server layout disclosure) — keep it in the server-side log only.

- [ ] **Step 1: Update the tests first**

In `src/tools/helpers/resourceRegistry.test.ts`:

1. Extend the fs mock (line ~20 and ~38-40) with `stat`:

```typescript
const mockReadFile = vi.fn();
const mockStat = vi.fn();
```
```typescript
vi.mock("node:fs/promises", () => ({
  default: { readFile: mockReadFile, stat: mockStat },
}));
```

2. In `beforeEach`, default the stat mock: `mockStat.mockResolvedValue({ mtimeMs: 1000 });`
3. Replace the memoization test (lines ~108-121) with:

```typescript
  it("memoizes by mtime: unchanged file is read once, changed file is re-read", async () => {
    const mockServer = {} as McpServer;
    const resourceUri = "ui://test/memo.html";
    mockStat.mockResolvedValue({ mtimeMs: 1000 });
    mockReadFile.mockResolvedValue("<html>v1</html>");

    registerAppResourceFromPath(mockServer, resourceUri, "search", "memo-app");

    const first = await capturedResourceHandler!();
    const second = await capturedResourceHandler!();
    expect(mockReadFile).toHaveBeenCalledTimes(1);
    expect(first.contents[0].text).toBe("<html>v1</html>");
    expect(second.contents[0].text).toBe("<html>v1</html>");

    // A rebuild bumps the mtime — the next read must serve the new HTML
    mockStat.mockResolvedValue({ mtimeMs: 2000 });
    mockReadFile.mockResolvedValue("<html>v2</html>");
    const third = await capturedResourceHandler!();
    expect(third.contents[0].text).toBe("<html>v2</html>");
    expect(mockReadFile).toHaveBeenCalledTimes(2);
  });
```

4. Extend the missing-file test (lines ~123-134): add an assertion that the served error HTML does NOT contain the filesystem path:

```typescript
    expect(result.contents[0].text).not.toContain("dist");
    expect(result.contents[0].text).not.toMatch(/[A-Za-z]:\\|\/home\//);
```

Also make that test set `mockStat.mockRejectedValue(new Error("ENOENT"));` (stat fails before read for a missing file).
5. In the "does not memoize the fallback" test, use `mockStat.mockRejectedValueOnce(new Error("ENOENT"));` for the failed read and `mockStat.mockResolvedValue({ mtimeMs: 1000 })` before the successful one.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/tools/helpers/resourceRegistry.test.ts`
Expected: FAIL (stat not used; path still echoed)

- [ ] **Step 3: Update the implementation**

In `src/tools/helpers/resourceRegistry.ts`:

1. Change the cache to `const htmlCache = new Map<string, { html: string; mtimeMs: number }>();` and update its doc comment: memoization is validated against the file's mtime on every read (one cheap `fs.stat` instead of a full read), so `npm run build:apps` IS picked up without a restart.
2. Replace the read handler body (lines ~109-134) with:

```typescript
    async (): Promise<ReadResourceResult> => {
      try {
        const stat = await fs.stat(htmlPath);
        const cached = htmlCache.get(resourceUri);
        if (cached && cached.mtimeMs === stat.mtimeMs) {
          return buildResult(resourceUri, cached.html);
        }
        const html = await fs.readFile(htmlPath, "utf-8");
        htmlCache.set(resourceUri, { html, mtimeMs: stat.mtimeMs });
        return buildResult(resourceUri, html);
      } catch (error) {
        logger.warn(
          `Failed to load app resource "${resourceUri}" from "${htmlPath}": ${String(error)}`
        );
        return {
          contents: [
            {
              uri: resourceUri,
              mimeType: RESOURCE_MIME_TYPE,
              text: `<!DOCTYPE html><html><head><title>Error</title></head><body><p>App UI not available. Run <code>npm run build:apps</code> and retry.</p></body></html>`,
            },
          ],
        };
      }
    }
```

3. Update the file-header "Deviations" comment (lines ~24-28) to describe the mtime-validated memoization.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/tools/helpers/resourceRegistry.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/tools/helpers/resourceRegistry.ts src/tools/helpers/resourceRegistry.test.ts
git commit -m "fix(resources): mtime-validated HTML memoization (rebuilds picked up live); stop echoing server paths to clients"
```

---

### Task 14: viz-data client — honest fallback + timestamp-ordered eviction

**Files:**
- Modify: `src/apps/shared/viz-data.ts`
- Create: `src/apps/shared/viz-eviction.ts`
- Create: `src/apps/shared/viz-eviction.test.ts`

Two fixes: (1) the "final fallback: return the trimmed response" can never satisfy any app's payload guard — make the miss explicit by returning `null` (all five apps' guards already handle it, showing the "expired" state); (2) localStorage eviction sorts UUID keys lexicographically (its own comment admits eviction is arbitrary) — store `{ t, data }` wrappers and evict oldest-by-timestamp via a pure, tested helper.

**Interfaces:**
- Produces: `selectEvictionKeys(entries: Array<{ key: string; t: number }>, maxEntries: number): string[]` in `@shared/viz-eviction` — keys to remove, oldest-first, so that `entries.length - result.length <= maxEntries`.
- Changes: `extractFullData(app, agentResponse): Promise<unknown>` now returns `null` when no cached payload can be found anywhere (previously returned the trimmed response).

- [ ] **Step 1: Write the failing test**

Create `src/apps/shared/viz-eviction.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { selectEvictionKeys } from "./viz-eviction";

describe("selectEvictionKeys", () => {
  it("returns empty when under the bound", () => {
    expect(selectEvictionKeys([{ key: "a", t: 1 }], 20)).toEqual([]);
  });
  it("evicts the OLDEST entries first, regardless of key order", () => {
    const entries = [
      { key: "zz-newest", t: 300 },
      { key: "aa-oldest", t: 100 },
      { key: "mm-middle", t: 200 },
    ];
    expect(selectEvictionKeys(entries, 2)).toEqual(["aa-oldest"]);
    expect(selectEvictionKeys(entries, 1)).toEqual(["aa-oldest", "mm-middle"]);
  });
  it("treats missing timestamps as oldest (legacy unwrapped entries)", () => {
    const entries = [
      { key: "new", t: 100 },
      { key: "legacy", t: 0 },
    ];
    expect(selectEvictionKeys(entries, 1)).toEqual(["legacy"]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/apps/shared/viz-eviction.test.ts`
Expected: FAIL — cannot resolve `./viz-eviction`

- [ ] **Step 3: Write the implementation**

Create `src/apps/shared/viz-eviction.ts`:

```typescript
/*
 * Copyright (C) 2025 TomTom Navigation B.V.
 * Licensed under the Apache License, Version 2.0
 */

/**
 * Picks which cached viz entries to evict so at most `maxEntries` remain,
 * oldest-first by stored timestamp. Pure so the ordering is unit-testable —
 * the previous implementation sorted uuid-suffixed KEYS lexicographically,
 * which evicted arbitrary entries rather than the oldest.
 */
export function selectEvictionKeys(
  entries: Array<{ key: string; t: number }>,
  maxEntries: number
): string[] {
  if (entries.length <= maxEntries) return [];
  return [...entries]
    .sort((a, b) => a.t - b.t)
    .slice(0, entries.length - maxEntries)
    .map((e) => e.key);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/apps/shared/viz-eviction.test.ts`
Expected: PASS

- [ ] **Step 5: Rewrite viz-data.ts save/load + fallback**

In `src/apps/shared/viz-data.ts`:

1. Add import: `import { selectEvictionKeys } from "./viz-eviction";`
2. Replace `saveToLocalCache` and `loadFromLocalCache` with:

```typescript
/** localStorage wrapper: timestamp + payload, so eviction is oldest-first. */
interface CachedViz {
  t: number;
  data: unknown;
}

/**
 * Save visualization data to localStorage for offline/reconnect scenarios.
 * Entries are wrapped with a stored timestamp; eviction removes the oldest
 * entries first. Silently fails if localStorage is unavailable or full.
 */
function saveToLocalCache(vizId: string, data: unknown): void {
  try {
    const wrapper: CachedViz = { t: Date.now(), data };
    localStorage.setItem(VIZ_CACHE_PREFIX + vizId, JSON.stringify(wrapper));

    const entries = Object.keys(localStorage)
      .filter((k) => k.startsWith(VIZ_CACHE_PREFIX))
      .map((key) => {
        try {
          const parsed = JSON.parse(localStorage.getItem(key) ?? "null") as CachedViz | null;
          return { key, t: typeof parsed?.t === "number" ? parsed.t : 0 };
        } catch {
          return { key, t: 0 };
        }
      });
    for (const key of selectEvictionKeys(entries, VIZ_CACHE_MAX_ENTRIES)) {
      localStorage.removeItem(key);
    }
  } catch {
    // localStorage unavailable or quota exceeded — silently continue
  }
}

/**
 * Load visualization data from localStorage.
 * Returns null if not found or localStorage is unavailable.
 */
function loadFromLocalCache(vizId: string): unknown {
  try {
    const raw = localStorage.getItem(VIZ_CACHE_PREFIX + vizId);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CachedViz | unknown;
    // Wrapped entry — unwrap; anything else is a legacy raw payload.
    if (parsed && typeof parsed === "object" && "t" in parsed && "data" in parsed) {
      return (parsed as CachedViz).data;
    }
    return parsed;
  } catch {
    return null;
  }
}
```

3. In `extractFullData`, replace the final fallback (lines ~114-115):

```typescript
  // Final fallback: use the response as-is (trimmed data)
  return agentResponse;
```

with:

```typescript
  // No cached payload anywhere (server cache expired/restarted AND no local
  // copy). The trimmed tool response can never satisfy an app's payload
  // guard, so return an explicit miss — apps render their "expired" state.
  return null;
```

4. Update `extractFullData`'s JSDoc: replace "and finally to the trimmed response itself if no cached data can be found anywhere" with "returns `null` when no cached payload can be found anywhere (callers show their data-expired state)".

- [ ] **Step 6: Verify build + tests**

Run: `npx vitest run src/apps && npm run build:apps`
Expected: PASS / build succeeds

- [ ] **Step 7: Commit**

```bash
git add src/apps/shared/viz-data.ts src/apps/shared/viz-eviction.ts src/apps/shared/viz-eviction.test.ts
git commit -m "fix(apps): explicit null on total viz-cache miss; oldest-first localStorage eviction (was arbitrary uuid sort)"
```

---

### Task 15: Derive resource URIs from the app name (`registerTrafficAnalyticsApp`)

**Files:**
- Modify: `src/tools/helpers/resourceRegistry.ts` (replace `registerAppResourceFromPath`)
- Modify: `src/tools/helpers/resourceRegistry.test.ts`
- Modify: `src/tools/liveTraffic.ts`, `src/tools/areaAnalytics.ts`, `src/tools/junctionAnalytics.ts`, `src/tools/routeMonitoring.ts`
- Modify: `src/tools/liveTraffic.test.ts`, `src/tools/areaAnalytics.test.ts`, `src/tools/junctionAnalytics.test.ts`, `src/tools/routeMonitoring.test.ts`

Today each tool file hand-writes the `ui://tomtom-traffic-analytics/<app>/app.html` string AND passes the category `"traffic-analytics"` and app dir separately — three restatements of one identity; a typo silently breaks the app link. Replace with one function that derives the URI and returns it.

**Interfaces:**
- Produces: `registerTrafficAnalyticsApp(server: McpServer, appName: string): string` — registers the resource from `dist/apps/traffic-analytics/<appName>/app.html` under URI `` `ui://tomtom-traffic-analytics/${appName}/app.html` `` and returns that URI.
- Removes: `registerAppResourceFromPath` (no callers remain).

- [ ] **Step 1: Update resourceRegistry tests**

In `src/tools/helpers/resourceRegistry.test.ts`, change the import to `registerTrafficAnalyticsApp` and update every call site from

```typescript
registerAppResourceFromPath(mockServer, "ui://test/app.html", "search", "geocode");
```

to

```typescript
const uri = registerTrafficAnalyticsApp(mockServer, "geocode");
```

asserting `uri === "ui://tomtom-traffic-analytics/geocode/app.html"` and using `uri` in the existing expectations (replace the hardcoded `resourceUri` variables). The first test's expectation becomes:

```typescript
    expect(mockRegisterAppResource).toHaveBeenCalledWith(
      mockServer,
      "ui://tomtom-traffic-analytics/geocode/app.html",
      expect.any(String),
      { mimeType: "text/html" },
      expect.any(Function)
    );
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/tools/helpers/resourceRegistry.test.ts`
Expected: FAIL — `registerTrafficAnalyticsApp` not exported

- [ ] **Step 3: Update the implementation**

In `src/tools/helpers/resourceRegistry.ts`, replace the `registerAppResourceFromPath` signature/JSDoc (keep the handler body from Task 13):

```typescript
/** All MCP apps in this server live under one category directory. */
const APP_CATEGORY = "traffic-analytics";

/**
 * Registers an MCP App resource and returns its `ui://` URI, derived from the
 * app directory name so the URI, the on-disk path, and the tool `_meta`
 * reference can never drift apart.
 *
 * @param server - MCP server instance
 * @param appName - App directory name under dist/apps/traffic-analytics/
 * @returns The registered resource URI (bind it to the tool's `_meta`)
 */
export function registerTrafficAnalyticsApp(server: McpServer, appName: string): string {
  const resourceUri = `ui://tomtom-${APP_CATEGORY}/${appName}/app.html`;
  const htmlPath = path.join(APP_BASE_PATH, APP_CATEGORY, appName, "app.html");

  registerAppResource(
    server,
    resourceUri,
    resourceUri,
    { mimeType: RESOURCE_MIME_TYPE },
    /* handler unchanged from Task 13 */
  );

  return resourceUri;
}
```

(Note the derived URI is `ui://tomtom-traffic-analytics/...` — identical to the current hand-written strings.)

- [ ] **Step 4: Update the 4 tool files**

Pattern for each (exact appName per tool):

`src/tools/liveTraffic.ts` — delete the two `*_RESOURCE_URI` consts; change the import to `registerTrafficAnalyticsApp`; then:

```typescript
export function createLiveTrafficTools(server: McpServer): void {
  const trafficFlowUri = registerTrafficAnalyticsApp(server, "traffic-flow");

  registerAppTool(
    server,
    "tomtom-traffic-flow-segment",
    {
      description: `...unchanged...`,
      inputSchema: trafficFlowDataSchema,
      _meta: { [RESOURCE_URI_META_KEY]: trafficFlowUri },
    },
    getFlowSegmentDataHandler()
  );

  const trafficIncidentsUri = registerTrafficAnalyticsApp(server, "traffic-incidents");

  registerAppTool(
    server,
    "tomtom-traffic-incidents",
    { /* description/inputSchema unchanged */ _meta: { [RESOURCE_URI_META_KEY]: trafficIncidentsUri } },
    createTrafficIncidentsHandler()
  );
}
```

Apply the same change in:
- `src/tools/areaAnalytics.ts`: `registerTrafficAnalyticsApp(server, "area-analytics")` → `_meta` of `tomtom-area-analytics-stats`.
- `src/tools/junctionAnalytics.ts`: ONE call `registerTrafficAnalyticsApp(server, "junction-live")`; its returned URI goes into the `_meta` of BOTH `tomtom-junction-search` and `tomtom-junction-live-data`.
- `src/tools/routeMonitoring.ts`: ONE call `registerTrafficAnalyticsApp(server, "route-details")`; its URI goes into the `_meta` of BOTH `tomtom-route-search` and `tomtom-route-monitoring-details`.

(Verify against the current files: each file today calls `registerAppResourceFromPath` once per app — keep exactly the same number of resource registrations, only the derivation changes.)

- [ ] **Step 5: Update the 4 tool test files**

Each tool test mocks `./helpers/resourceRegistry`. Change the mock to:

```typescript
const mockRegisterTrafficAnalyticsApp = vi.fn(
  (_server: unknown, appName: string) => `ui://tomtom-traffic-analytics/${appName}/app.html`
);
vi.mock("./helpers/resourceRegistry", () => ({
  registerTrafficAnalyticsApp: mockRegisterTrafficAnalyticsApp,
}));
```

and update assertions that referenced `mockRegisterAppResourceFromPath` to assert `mockRegisterTrafficAnalyticsApp` was called with `(mockServer, "<app-name>")`. Assertions on `config._meta["ui/resourceUri"]` values are unchanged (same URIs).

- [ ] **Step 6: Run tests**

Run: `npx vitest run src/tools && npm run build`
Expected: PASS / full build succeeds

- [ ] **Step 7: Commit**

```bash
git add src/tools
git commit -m "refactor(tools): derive ui:// resource URIs from the app name — one identity, no drift"
```

---

### Task 16: Dev-harness security hardening (ui/)

**Files:**
- Modify: `ui/serve.ts` (remove wildcard CORS; scheme-filter CSP domains)
- Modify: `ui/src/sandbox.ts:66` (pin relay target origin)
- Modify: `ui/src/implementation.ts:290-293` (http/https allowlist for openLink)

Context: `ui/` is a dev-only harness (not in the npm `files` list), but `/api/config` returns BOTH TomTom keys and `cors()` makes that readable by any website while the harness runs (`fetch('http://127.0.0.1:8080/api/config')` from any origin). All traffic between the host page (8080), sandbox (8081), and MCP server (3000) is same-origin fetch + iframe embedding + postMessage — none of it needs CORS headers from these two Express apps.

- [ ] **Step 1: serve.ts — remove CORS, harden the CSP sanitizer**

1. Delete `import cors from "cors";` (line 12), `hostApp.use(cors());` (line 34), and `sandboxApp.use(cors());` (line 66). Add a comment where the host app is created:

```typescript
// NOTE: deliberately NO cors() here. /api/config returns real API keys; the
// UI fetches it same-origin, and browsers' same-origin policy is what stops
// arbitrary websites from reading it off the running dev harness.
```

2. Replace `sanitizeCspDomains` (lines 68-71):

```typescript
/**
 * Only forward well-formed origins/schemes into the CSP header. The csp query
 * param is attacker-influenceable, so this is an allowlist of shapes (https/
 * wss origins and the blob:/data: schemes the apps need), not a char filter.
 */
const CSP_DOMAIN_PATTERN = /^(https:\/\/[^\s;'"]+|wss:\/\/[^\s;'"]+|blob:|data:)$/;

function sanitizeCspDomains(domains?: string[]): string[] {
  if (!domains) return [];
  return domains.filter((d) => typeof d === "string" && CSP_DOMAIN_PATTERN.test(d));
}
```

- [ ] **Step 2: sandbox.ts — pin the inner-frame relay origin**

Replace line 66:

```typescript
        inner.contentWindow.postMessage(event.data, "*");
```

with:

```typescript
        // Pin the target origin: the inner document is written via
        // document.write from this page, so it shares this origin. If the
        // frame ever ends up on a different origin, host payloads (tool
        // results, model context) must not be delivered there.
        inner.contentWindow.postMessage(event.data, OWN_ORIGIN);
```

- [ ] **Step 3: implementation.ts — scheme allowlist for openLink**

Replace lines 290-293:

```typescript
  appBridge.onopenlink = async (params) => {
    window.open(params.url, "_blank", "noopener,noreferrer");
    return {};
  };
```

with:

```typescript
  appBridge.onopenlink = async (params) => {
    // Apps are untrusted content: only allow web URLs (no javascript:, file:, data:).
    let protocol: string;
    try {
      protocol = new URL(params.url).protocol;
    } catch {
      log.warn("Blocked openLink with unparseable URL:", params.url);
      return {};
    }
    if (protocol !== "https:" && protocol !== "http:") {
      log.warn("Blocked openLink with disallowed scheme:", params.url);
      return {};
    }
    window.open(params.url, "_blank", "noopener,noreferrer");
    return {};
  };
```

(Check the top of `implementation.ts` for the actual logger object name — it logs via `log.info` elsewhere in the file; use the same object. If only `log.info` exists, use `log.info`.)

- [ ] **Step 4: Verify the harness builds**

Run: `cd ui && npm install && npm run build`
Expected: Vite build succeeds. Then `cd ..`.

- [ ] **Step 5: Commit**

```bash
git add ui/serve.ts ui/src/sandbox.ts ui/src/implementation.ts
git commit -m "fix(ui-harness): no wildcard CORS on the key-serving config endpoint; scheme-filtered CSP + openLink; pinned sandbox relay origin"
```

---

### Task 17: Update CLAUDE.md Apps Layer section

**Files:**
- Modify: `.claude/CLAUDE.md:45-47`

The Apps Layer paragraph (added by this same branch) still says TWO tools / two apps use `registerAppTool`; the branch ships SEVEN tools and FIVE apps, and this plan adds shared modules worth listing.

- [ ] **Step 1: Replace the Apps Layer paragraph**

Replace the paragraph under `### Apps Layer (src/apps/)` (line 47) with:

```markdown
Seven tools (`tomtom-traffic-incidents`, `tomtom-traffic-flow-segment`, `tomtom-area-analytics-stats`, `tomtom-junction-search`, `tomtom-junction-live-data`, `tomtom-route-search`, `tomtom-route-monitoring-details`) are registered via `registerAppTool` (from `@modelcontextprotocol/ext-apps/server`) instead of plain `server.registerTool`, and bind a `ui://` resource so ext-apps-capable hosts render an interactive map. Five apps back them under `src/apps/traffic-analytics/<app-name>/` (junction-search + junction-live-data share `junction-live`; route-search + route-monitoring-details share `route-details`). Resource URIs are derived from the app name by `registerTrafficAnalyticsApp` (`src/tools/helpers/resourceRegistry.ts`) — never hand-write a `ui://` string. Handler responses add `_meta: { show_ui, viz_id }` via `buildVizMeta` (`src/handlers/helpers/vizMeta.ts`); the app fetches the full raw payload from the app-only tool `tomtom-get-viz-data` (5-minute in-memory cache bounded to 50 entries, `src/services/cache/vizCache.ts`) and the TomTom API key from `tomtom-get-api-key` (`src/tools/appTools.ts`) — both hidden from the LLM via `_meta.ui.visibility: ["app"]`. Each app is a renderer plugged into `bootstrapVizApp` (`src/apps/shared/app-bootstrap.ts`), which owns the tool-result parse, show_ui/API-key/payload gates, standard error states, and lazy map creation. Other cross-app helpers live in `src/apps/shared/` (dom, format, geo, collections, chart-layout, feature-state, speed-colors, viz-data, map controls). **`src/apps/**` is excluded from `tsc` (built separately by Vite via `npm run build:apps`) and from vitest coverage** — but `*.test.ts` files under `src/apps/` still run as part of `npm test`.
```

- [ ] **Step 2: Commit**

```bash
git add .claude/CLAUDE.md
git commit -m "docs: CLAUDE.md Apps Layer reflects 7 app tools / 5 apps and the shared helpers"
```

---

### Task 18: Full verification

- [ ] **Step 1: Full unit suite + lint + build**

Run: `npm test && npm run lint && npm run build`
Expected: all tests pass (coverage thresholds hold — new server-side helpers are covered by their new tests), no lint errors, full build (tsc + rollup + apps) succeeds.

- [ ] **Step 2: E2E (only if `.env` has both API keys)**

Run: `npm run test:e2e:setup` (once), then `npm run test:e2e`
Expected: Playwright suite passes (it auto-skips without keys — report which case happened; if it skipped, say so explicitly rather than claiming e2e passed).

- [ ] **Step 3: Token metrics sanity check** (descriptions unchanged, so this is a no-regression check)

Run: `node tests/test-comprehensive.js --metrics-only`
Expected: wire costs unchanged vs. main-branch numbers for tool descriptions.

- [ ] **Step 4: Final commit if anything is outstanding, then summarize**

Report: tests run + results, e2e run-or-skipped, build status, and the list of review findings fixed vs. explicitly de-scoped (multi-process cache backend, junction geometry over-fetch redesign, incident-list incremental DOM updates).
