# MCP Apps for Remaining Traffic Tools — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add three MCP apps (`traffic-flow`, `junction-live`, `route-details`) covering the five remaining geometry-bearing tools, extending PR #26 on branch `feat/mcp-apps-traffic-tools` using the infrastructure already landed for traffic-incidents and area-analytics.

**Architecture:** Each tool's handler caches its raw pre-SQL API payload in the existing `vizCache` and attaches `_meta: { show_ui, viz_id }`; tools switch from `server.registerTool` to `registerAppTool` bound to a `ui://` resource (one shared app per tool family). Apps are vanilla-TS single-file Vite bundles using `CustomGeoJSONModule` for all polyline/point rendering (GeometriesModule is polygon-only). Lifecycle spine is duplicated per app (deliberate — no refactor of the two shipped apps); the only new shared module is `speed-colors.ts`.

**Tech Stack:** already installed — `@modelcontextprotocol/ext-apps` ^1.7.4, `@tomtom-org/maps-sdk` ^0.49.1, `maplibre-gl`, Vite 7 + `vite-plugin-singlefile`, vitest, Playwright. **No new dependencies.**

**Spec:** `docs/superpowers/specs/2026-07-03-remaining-traffic-apps-design.md` (approved).

## Global Constraints

- Worktree: `C:\Users\prietofe\workspace\tta-mcp-apps`, branch `feat/mcp-apps-traffic-tools`. All work happens there. Push target: same branch (updates PR #26). Push requires gh account `carlosprietofernandez-tomtom`.
- **stdio hygiene:** nothing loaded by the stdio entry point writes to stdout. Server-side code logs via `src/utils/logger.ts` only.
- Zod schemas are plain exported objects (NOT wrapped in `z.object()`).
- App resource URIs: `ui://tomtom-traffic-analytics/<app>/app.html`. CSP is inherited from `registerAppResourceFromPath` — do not add per-app CSP; do not remove `https://unpkg.com` from `APP_RESOURCE_CSP` (the SDK runtime-injects maplibre CSS + RTL plugin from unpkg).
- Each app.ts: `import "maplibre-gl/dist/maplibre-gl.css"` (bundled); lifecycle hooks (`ontoolinput`/`ontoolresult`/`onteardown`) registered **before** `await app.connect()`; guard the viz payload shape after `extractFullData` and call `showErrorUI("Visualization data expired — re-run the tool")` **before** `showMapUI()` on mismatch; guarded `window.__e2e_ml = map.mapLibreMap` right after map creation.
- CSS: three-layer rule. Shared `ui-visibility.css` (never re-declare), shared `.tta-*` classes from `@shared/controls` for ALL card/control chrome, per-app `styles.css` only for positioning/typography using `var(--token, fallback)`. Every wrapper with `min-height` needs an `html.ui-hidden` collapse rule. Copy the styles.css preamble verbatim from `src/apps/traffic-analytics/area-analytics/styles.css:1-37` (the gold-standard reference).
- Apps render the **raw pre-SQL data** — visuals reflect request params, not SQL results (by design).
- All harness/E2E URLs use `127.0.0.1`, never `localhost`.
- `npm run build:mcpb` only works from PowerShell (Git Bash tar breaks it).
- Claude cannot read/edit `.env` (ask the user); live keys already in worktree `.env` with `ALLOWED_ORIGINS=http://127.0.0.1:8080`.
- Commit after every task (conventional commits). End commit messages with `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
- Coverage thresholds must stay green (`src/apps/**` excluded from coverage; node-safe app modules still run as tests, uncounted).

## File Structure (delta)

```
src/apps/shared/speed-colors.ts                     [new]  ratio→color + legend (node-testable)
src/apps/shared/speed-colors.css                    [new]  .ramp-legend-* styles (side-effect import)
src/apps/shared/speed-colors.test.ts                [new]
src/schemas/live-traffic/liveTrafficSchema.ts       [edit] + show_ui on trafficFlowDataSchema
src/schemas/junction-analytics/junctionAnalyticsSchema.ts [edit] + show_ui on search + liveData schemas
src/schemas/route-monitoring/routeMonitoringSchema.ts     [edit] + show_ui on both schemas
src/handlers/liveTrafficHandler.ts                  [edit] flow handler viz block
src/handlers/junctionAnalyticsHandler.ts            [edit] search + live viz blocks; geometry fetch/strip rule
src/handlers/routeMonitoringHandler.ts              [edit] search + details viz blocks
src/tools/liveTraffic.ts                            [edit] flow → registerAppTool + traffic-flow resource
src/tools/junctionAnalytics.ts                      [edit] search+live → registerAppTool, ONE junction-live resource
src/tools/routeMonitoring.ts                        [edit] both → registerAppTool, ONE route-details resource
src/handlers/{liveTraffic,junctionAnalytics,routeMonitoring}Handler.test.ts [edit] viz tests
src/tools/{liveTraffic,junctionAnalytics,routeMonitoring}.test.ts           [edit] registration tests
src/apps/traffic-analytics/traffic-flow/{app.html,app.ts,styles.css}   [new]
src/apps/traffic-analytics/junction-live/{app.html,app.ts,styles.css}  [new]
src/apps/traffic-analytics/route-details/{app.html,app.ts,styles.css}  [new]
e2e/apps.spec.ts                                    [edit] +5 specs
ui/src/index.tsx                                    [edit] EXAMPLE_INPUTS show_ui for 5 tools
README.md                                           [edit] apps list
```

`scripts/build-apps.ts` needs NO changes — it auto-discovers `src/apps/traffic-analytics/*/app.html`.

---

### Task 1: `speed-colors` shared module

**Files:**
- Create: `src/apps/shared/speed-colors.ts`, `src/apps/shared/speed-colors.css`, `src/apps/shared/speed-colors.test.ts`

**Interfaces — Produces (consumed by Tasks 3 and 9):**
- `ratioToColor(ratio: number | null | undefined): string` — hex color for a speed ratio in (0, 1]; gray `NO_DATA_COLOR` for null/NaN.
- `NO_DATA_COLOR = "#9ca3af"`, `RATIO_STOPS` (0.4 → `#e03030`, 0.7 → `#f5a623`, 0.9 → `#2dc653`).
- `renderRampLegend(container: HTMLElement, label: string): void` — fills a legend card with label + gradient bar + "Slower"/"Free flow" end labels. Only static string labels are passed (no user data).

- [ ] **Step 1: Write the failing test** — `src/apps/shared/speed-colors.test.ts` (node-safe, pure functions only; `renderRampLegend` is DOM code covered by E2E):

```ts
import { describe, it, expect } from "vitest";
import { ratioToColor, NO_DATA_COLOR, RATIO_STOPS } from "./speed-colors";

describe("ratioToColor", () => {
  it("returns exact stop colors at stop values", () => {
    for (const [value, color] of RATIO_STOPS) {
      expect(ratioToColor(value)).toBe(color);
    }
  });
  it("clamps below the first stop and above the last", () => {
    expect(ratioToColor(0)).toBe(RATIO_STOPS[0][1]);
    expect(ratioToColor(0.1)).toBe(RATIO_STOPS[0][1]);
    expect(ratioToColor(1)).toBe(RATIO_STOPS[RATIO_STOPS.length - 1][1]);
    expect(ratioToColor(1.5)).toBe(RATIO_STOPS[RATIO_STOPS.length - 1][1]);
  });
  it("interpolates between stops to a valid hex that is neither endpoint", () => {
    const mid = ratioToColor(0.55); // between 0.4 (red) and 0.7 (amber)
    expect(mid).toMatch(/^#[0-9a-f]{6}$/);
    expect(mid).not.toBe(RATIO_STOPS[0][1]);
    expect(mid).not.toBe(RATIO_STOPS[1][1]);
  });
  it("returns NO_DATA_COLOR for null, undefined, and NaN", () => {
    expect(ratioToColor(null)).toBe(NO_DATA_COLOR);
    expect(ratioToColor(undefined)).toBe(NO_DATA_COLOR);
    expect(ratioToColor(Number.NaN)).toBe(NO_DATA_COLOR);
  });
});
```

- [ ] **Step 2: Run test to verify it fails** — `npx vitest run src/apps/shared/speed-colors.test.ts` → FAIL (module missing).
- [ ] **Step 3: Implement** `src/apps/shared/speed-colors.ts`:

```ts
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

/** Renders the shared green→amber→red ramp legend. `label` must be a static string. */
export function renderRampLegend(container: HTMLElement, label: string): void {
  const min = RATIO_STOPS[0][0];
  const max = RATIO_STOPS[RATIO_STOPS.length - 1][0];
  const gradient = RATIO_STOPS.map(
    ([v, c]) => `${c} ${(((v - min) / (max - min)) * 100).toFixed(1)}%`
  ).join(", ");
  container.innerHTML = `
    <div class="ramp-legend-label">${label}</div>
    <div class="ramp-legend-bar" style="background: linear-gradient(to right, ${gradient})"></div>
    <div class="ramp-legend-ends"><span>Slower</span><span>Free flow</span></div>`;
}
```

And `src/apps/shared/speed-colors.css` (token-based, mirroring the area-analytics legend styling):

```css
/* Ramp legend used by traffic-flow and route-details apps. */
.ramp-legend-label {
  font-size: var(--font-text-sm-size, 12px);
  font-weight: var(--font-weight-semibold, 600);
  color: var(--color-text-primary, #111827);
  margin-bottom: 6px;
}
.ramp-legend-bar {
  height: 10px;
  border-radius: var(--border-radius-full, 999px);
}
.ramp-legend-ends {
  display: flex;
  justify-content: space-between;
  font-size: var(--font-text-xs-size, 11px);
  color: var(--color-text-secondary, #6b7280);
  margin-top: 2px;
}
```

- [ ] **Step 4: Run test to verify it passes** — `npx vitest run src/apps/shared/speed-colors.test.ts` → PASS. Also `npx tsc -p src/apps/tsconfig.json --noEmit` → clean.
- [ ] **Step 5: Commit** — `feat(apps): shared speed-ratio color scale + ramp legend`

### Task 2: traffic-flow vertical (schema + handler + tool)

**Files:**
- Modify: `src/schemas/live-traffic/liveTrafficSchema.ts:72-90` (`trafficFlowDataSchema`), `src/handlers/liveTrafficHandler.ts:39-115` (`getFlowSegmentDataHandler`), `src/tools/liveTraffic.ts:35-59`
- Test: `src/handlers/liveTrafficHandler.test.ts`, `src/tools/liveTraffic.test.ts`

**Interfaces:**
- Consumes: `storeVizData` from `src/services/cache/vizCache` (already imported in this handler file), `registerAppTool`/`RESOURCE_URI_META_KEY` from `@modelcontextprotocol/ext-apps/server`, `registerAppResourceFromPath` from `./helpers/resourceRegistry` (both already imported in `src/tools/liveTraffic.ts`).
- Produces: viz payload `{ tool: "tomtom-traffic-flow-segment", request: { point, style, zoom, unit }, segment: TrafficFlowSegmentResponse }`; response `_meta: { show_ui: boolean, viz_id?: string }`; resource URI `ui://tomtom-traffic-analytics/traffic-flow/app.html` (Task 3's app reads this payload).

- [ ] **Step 1: Schema** — add to `trafficFlowDataSchema` (after `openLr`):

```ts
  show_ui: z
    .boolean()
    .optional()
    .describe("Render the interactive flow segment map app (default true). Set false for text-only analysis."),
```

- [ ] **Step 2: Write failing handler tests** — in `src/handlers/liveTrafficHandler.test.ts`, follow the existing incidents viz test block style in the same file (vizCache is already mocked there via `vi.mock("../services/cache/vizCache")`). Add a `describe("getFlowSegmentDataHandler viz cache", ...)` with four tests:
  - default (`show_ui` undefined) → `storeVizData` called once with `{ tool: "tomtom-traffic-flow-segment", request: { point, style, zoom, unit }, segment: <mocked raw result> }`; parsed response `_meta` equals `{ show_ui: true, viz_id: "<mocked id>" }`.
  - `show_ui: false` → `storeVizData` NOT called; `_meta` = `{ show_ui: false }`; **and** the service mock (`getFlowSegmentData`) received a request object WITHOUT `show_ui` in it (assert `expect(getFlowSegmentData).toHaveBeenCalledWith(expect.not.objectContaining({ show_ui: expect.anything() }))`).
  - `storeVizData` throws → response still succeeds, `_meta` = `{ show_ui: false }`.
  - missing `sql_queries` (error path) → `isError: true`, `storeVizData` NOT called.
- [ ] **Step 3: Run to verify FAIL** — `npx vitest run src/handlers/liveTrafficHandler.test.ts`.
- [ ] **Step 4: Implement in `getFlowSegmentDataHandler`**. Change line 43 destructure and add the viz block after step 5 (row counts, ~line 75), mirroring the incidents block at `liveTrafficHandler.ts:218-253`:

```ts
    const { sql_queries, show_ui, ...requestParams } = params;
    const request = requestParams as TrafficFlowSegmentRequest;
```

```ts
      // 6. Cache the raw segment for the MCP App to render, unless disabled
      let vizMeta: { show_ui: boolean; viz_id?: string };
      if (show_ui !== false) {
        try {
          const vizId = storeVizData({
            tool: "tomtom-traffic-flow-segment",
            request: {
              point: request.point,
              style: request.style,
              zoom: request.zoom,
              unit: request.unit,
            },
            segment: rawResult,
          });
          vizMeta = { show_ui: true, viz_id: vizId };
        } catch (error: any) {
          logger.error(`Failed to cache traffic flow viz payload: ${error.message}`);
          vizMeta = { show_ui: false };
        }
      } else {
        vizMeta = { show_ui: false };
      }
```

Add `_meta: vizMeta,` to the `SqlFilteredResponse` object (after `aggregated_data`). Run tests → PASS.
- [ ] **Step 5: Write failing tool tests** — in `src/tools/liveTraffic.test.ts` (ext-apps server + resourceRegistry are already mocked for the incidents assertions — extend the same mocks): assert `tomtom-traffic-flow-segment` is now registered via `registerAppTool` with `_meta[RESOURCE_URI_META_KEY] === "ui://tomtom-traffic-analytics/traffic-flow/app.html"`, and `registerAppResourceFromPath(server, "ui://tomtom-traffic-analytics/traffic-flow/app.html", "traffic-analytics", "traffic-flow")` was called. Run → FAIL.
- [ ] **Step 6: Implement in `src/tools/liveTraffic.ts`** — add near the existing incidents URI const:

```ts
const TRAFFIC_FLOW_RESOURCE_URI = "ui://tomtom-traffic-analytics/traffic-flow/app.html";
```

Then replace the `server.registerTool("tomtom-traffic-flow-segment", {...}, ...)` call with:

```ts
  registerAppResourceFromPath(server, TRAFFIC_FLOW_RESOURCE_URI, "traffic-analytics", "traffic-flow");

  registerAppTool(
    server,
    "tomtom-traffic-flow-segment",
    {
      description: `<UNCHANGED existing description>`,
      inputSchema: trafficFlowDataSchema,
      _meta: { [RESOURCE_URI_META_KEY]: TRAFFIC_FLOW_RESOURCE_URI },
    },
    getFlowSegmentDataHandler()
  );
```

(Keep the description text byte-identical — tests assert on it.)
- [ ] **Step 7: Full suite** — `npx vitest run` → all pass (if `createServer.test.ts` counts `server.registerTool` calls, update its expectations for one fewer plain registration). `npm run lint` → 0 errors.
- [ ] **Step 8: Commit** — `feat(flow): bind flow-segment tool to MCP app, cache raw segment`

### Task 3: traffic-flow app

**Files:**
- Create: `src/apps/traffic-analytics/traffic-flow/app.html`, `app.ts`, `styles.css`

**Interfaces:**
- Consumes: viz payload from Task 2; `ratioToColor`/`renderRampLegend`/`NO_DATA_COLOR` from `@shared/speed-colors` (Task 1); shared utils `ensureTomTomConfigured`, `extractFullData`, `shouldShowUI`/`showMapUI`/`hideMapUI`/`showErrorUI`; SDK `TomTomMap`, `CustomGeoJSONModule`, `TrafficFlowModule` from `@tomtom-org/maps-sdk/map`, `bboxFromCoordsArray` from `@tomtom-org/maps-sdk/core`.
- Produces: E2E contract — `#sdk-map.visible`, `#flow-panel` toggles `hidden`, `window.__e2e_ml`, custom layer ids containing `traffic-flow-segment` (consumed by Task 10).

Reference for the lifecycle spine, import order, `el()`/`escapeHtml()` helpers, and `connectApp()` wrapper: `src/apps/traffic-analytics/area-analytics/app.ts` (copy the spine, not the domain logic).

- [ ] **Step 1: `app.html`** — same head/boot skeleton as the existing apps (`color-scheme` meta, transparent backgrounds, `data:,` favicon, `./styles.css` link, module script last):

```html
<body style="background: transparent">
  <div id="app-root">
    <div id="waiting-state" class="state-panel">Waiting for tool result…</div>
    <div id="sdk-map"></div>
    <div id="flow-panel" class="hidden">
      <div id="stat-card" class="stat-card tta-panel">
        <header class="stat-card-header">
          <h1 id="road-class"></h1>
          <span id="closure-badge" class="closure-badge hidden">Road closed</span>
        </header>
        <dl id="stat-grid" class="stat-grid"></dl>
      </div>
      <div id="control-bar" class="control-bar">
        <button id="backdrop-toggle" class="tta-chip active" aria-pressed="true">Traffic backdrop</button>
      </div>
      <div id="legend" class="legend tta-panel"></div>
    </div>
  </div>
  <script type="module" src="./app.ts"></script>
</body>
```

- [ ] **Step 2: `app.ts`** — full lifecycle spine (imports in the established order; hooks before connect; `App({ name: "tta-traffic-flow", version: "1.0.0" })`). Core logic:

```ts
interface VizPayload {
  tool: string;
  request: { point?: { latitude: number; longitude: number }; style?: string; zoom?: number; unit?: string };
  segment: {
    frc: string; currentSpeed: number; freeFlowSpeed: number;
    currentTravelTime: number; freeFlowTravelTime: number;
    confidence: number; roadClosure: boolean;
    coordinates: Array<{ latitude: number; longitude: number }>;
  };
}

const FRC_LABELS: Record<string, string> = {
  FRC0: "Motorway", FRC1: "Major road", FRC2: "Other major road", FRC3: "Secondary road",
  FRC4: "Local connecting road", FRC5: "Local road (high importance)", FRC6: "Local road",
};

const CLOSED_COLOR = "#e03030";

let map: TomTomMap | undefined;
let geoModule: CustomGeoJSONModule | undefined;
let flowBackdrop: TrafficFlowModule | undefined;
```

In `ontoolresult` (after the standard parse → `shouldShowUI` → `ensureTomTomConfigured` → `extractFullData` sequence), guard `if (!Array.isArray((viz as any)?.segment?.coordinates)) { setPanelVisible(false); showErrorUI("Visualization data expired — re-run the tool"); return; }`, then `showMapUI()`, lazy-create the map, set `__e2e_ml`, then:

```ts
  // Backdrop FIRST so the queried segment's layers draw on top of it
  flowBackdrop ??= await TrafficFlowModule.get(map, { visible: backdropOn });
  geoModule ??= await CustomGeoJSONModule.get(map, {
    sources: {
      segment: {
        layers: [
          { id: "traffic-flow-segment-casing", type: "line",
            layout: { "line-join": "round", "line-cap": "round" },
            paint: { "line-color": "#ffffff", "line-width": 9 } },
          { id: "traffic-flow-segment-line", type: "line",
            filter: ["!=", ["get", "closed"], true],
            layout: { "line-join": "round", "line-cap": "round" },
            paint: { "line-color": ["get", "color"], "line-width": 5 } },
          { id: "traffic-flow-segment-closed", type: "line",
            filter: ["==", ["get", "closed"], true],
            layout: { "line-join": "round", "line-cap": "round" },
            paint: { "line-color": CLOSED_COLOR, "line-width": 5, "line-dasharray": [2, 1.5] } },
        ],
      },
      point: {
        layers: [
          { id: "traffic-flow-point-circle", type: "circle",
            paint: { "circle-radius": 5, "circle-color": "#0a3653",
                     "circle-stroke-width": 2, "circle-stroke-color": "#ffffff" } },
        ],
      },
    },
  });

  const seg = viz.segment;
  const ratio = seg.freeFlowSpeed > 0 ? seg.currentSpeed / seg.freeFlowSpeed : undefined;
  const lineCoords = seg.coordinates.map((c) => [c.longitude, c.latitude]);
  await geoModule.show({
    type: "FeatureCollection",
    features: [{
      type: "Feature", id: "segment", geometry: { type: "LineString", coordinates: lineCoords },
      properties: { id: "segment", color: ratioToColor(ratio), closed: seg.roadClosure === true },
    }],
  }, "segment");
  const pt = viz.request?.point;
  await geoModule.show({
    type: "FeatureCollection",
    features: pt ? [{ type: "Feature", id: "query-point",
      geometry: { type: "Point", coordinates: [pt.longitude, pt.latitude] },
      properties: { id: "query-point" } }] : [],
  }, "point");

  renderStats(viz);
  renderRampLegend(el("legend"), "Current vs free-flow speed");
  const bbox = bboxFromCoordsArray(lineCoords);
  if (bbox) map.mapLibreMap.fitBounds(bbox, { padding: 80, maxZoom: 16 });
```

Supporting functions:
- `renderStats(viz)` — builds `#stat-grid` `<dt>/<dd>` pairs: Current speed / Free-flow speed (formatted with `unit === "mph" ? "mph" : "km/h"`), Current travel time / Free-flow travel time (`formatDuration(sec)` → `"3 min 20 s"` / `"45 s"`), Delay (`currentTravelTime - freeFlowTravelTime`, "None" when ≤ 0), Confidence (`Math.round(confidence * 100)` when ≤ 1, else `Math.round(confidence)`, suffixed `%`). Sets `#road-class` text to `FRC_LABELS[seg.frc] ?? seg.frc`; toggles `#closure-badge` `hidden` on `!seg.roadClosure`. All text set via `textContent` (no user HTML).
- `backdropOn` module-level boolean (default `true`); `#backdrop-toggle` click handler (wired once at module top level) flips it, calls `flowBackdrop?.setVisible(backdropOn)`, toggles the chip's `active` class and `aria-pressed`.
- `onteardown` → `geoModule?.setVisible(false); flowBackdrop?.setVisible(false); return {};`

- [ ] **Step 3: `styles.css`** — copy the preamble from `area-analytics/styles.css:1-37` verbatim (reset, `html,body` with `min-height:600px`, `.hidden`, `#app-root`, `#sdk-map`, `html.ui-hidden #app-root` collapse). Then positioning-only rules: `#flow-panel { position: absolute; inset: 0; pointer-events: none; z-index: 900; }` with children re-enabling `pointer-events: auto`; `.stat-card` top-left (`position:absolute; top:16px; left:16px; max-width:280px; padding:14px 16px;`); `.control-bar` top-right; `.legend` bottom-left (`width:220px; padding:10px 14px;`); `.stat-grid` as a two-column `dt/dd` grid with `var(--color-text-secondary, #6b7280)` labels; `.closure-badge` red pill (`background:#e03030; color:#fff; border-radius:var(--border-radius-full,999px); font-size:var(--font-text-xs-size,11px); padding:2px 8px;`). No chrome that `.tta-panel`/`.tta-chip` already provide.
- [ ] **Step 4: Build + standalone smoke** — `npm run build:apps` → `dist/apps/traffic-analytics/traffic-flow/app.html` exists, single-file. Open it directly in a browser: shows "Waiting for tool result…", no console errors. `npx tsc -p src/apps/tsconfig.json --noEmit` → clean.
- [ ] **Step 5: Commit** — `feat(flow): interactive flow segment map app`

### Task 4: junction-search vertical (schema + handler + tool)

**Files:**
- Modify: `src/schemas/junction-analytics/junctionAnalyticsSchema.ts:89-98` (`junctionSearchSchema`), `src/handlers/junctionAnalyticsHandler.ts:43-116` (`getJunctionSearchHandler`), `src/tools/junctionAnalytics.ts:32-60`
- Test: `src/handlers/junctionAnalyticsHandler.test.ts`, `src/tools/junctionAnalytics.test.ts`

**Interfaces:**
- Consumes: `storeVizData` (add `import { storeVizData } from "../services/cache/vizCache";` to this handler file), same tool-registration imports as Task 2 (add to `src/tools/junctionAnalytics.ts`).
- Produces: viz payload `{ tool: "tomtom-junction-search", junctions: JunctionDefinition[] }` (raw, includes `rawJunction` + `junctionModel` — the handler already fetches with `includeGeometry: true`); resource URI `ui://tomtom-traffic-analytics/junction-live/app.html` registered ONCE (Task 5's tool reuses the same const WITHOUT another `registerAppResourceFromPath` call).

- [ ] **Step 1: Schema** — add to `junctionSearchSchema`:

```ts
  show_ui: z
    .boolean()
    .optional()
    .describe("Render the interactive junction map app (default true). Set false for text-only analysis."),
```

- [ ] **Step 2: Write failing handler tests** — in `src/handlers/junctionAnalyticsHandler.test.ts`: add `vi.mock("../services/cache/vizCache", () => ({ storeVizData: vi.fn(() => "test-viz-id") }));` (top-level, hoisted — follow the mock style used in `src/handlers/liveTrafficHandler.test.ts`). Tests for the search handler:
  - default → `storeVizData` called with `{ tool: "tomtom-junction-search", junctions: <the mocked getAllJunctionDefinitions result> }`; `_meta` = `{ show_ui: true, viz_id: "test-viz-id" }`.
  - `show_ui: false` → no store; `_meta` = `{ show_ui: false }`.
  - `storeVizData` throws → success response with `_meta: { show_ui: false }`.
  - missing `sql_queries` → `isError`, no store.
- [ ] **Step 3: Run → FAIL**, then implement: change line 45 to `const { view = "compact", sql_queries, show_ui } = params;`, insert the viz block after row counts (~line 85), same shape as Task 2 with payload `{ tool: "tomtom-junction-search", junctions: allJunctions }` and log message `Failed to cache junction search viz payload: ...`; add `_meta: vizMeta` to the response. Run → PASS.
- [ ] **Step 4: Write failing tool tests** — in `src/tools/junctionAnalytics.test.ts`: mock `@modelcontextprotocol/ext-apps/server` (`registerAppTool: vi.fn(), RESOURCE_URI_META_KEY: "ui/resourceUri"` — check the real exported key string in `node_modules/@modelcontextprotocol/ext-apps/dist` or mirror `src/tools/liveTraffic.test.ts`'s mock exactly) and `./helpers/resourceRegistry`. Assert: search tool registered via `registerAppTool` with `_meta[RESOURCE_URI_META_KEY] === "ui://tomtom-traffic-analytics/junction-live/app.html"`; `registerAppResourceFromPath` called EXACTLY ONCE with `(server, "ui://tomtom-traffic-analytics/junction-live/app.html", "traffic-analytics", "junction-live")`; `tomtom-junction-archive` still registered via plain `server.registerTool`.
- [ ] **Step 5: Implement in `src/tools/junctionAnalytics.ts`**:

```ts
import { registerAppTool, RESOURCE_URI_META_KEY } from "@modelcontextprotocol/ext-apps/server";
import { registerAppResourceFromPath } from "./helpers/resourceRegistry";

const JUNCTION_LIVE_RESOURCE_URI = "ui://tomtom-traffic-analytics/junction-live/app.html";
```

Inside `createJunctionAnalyticsTools`, before the search registration: `registerAppResourceFromPath(server, JUNCTION_LIVE_RESOURCE_URI, "traffic-analytics", "junction-live");` — then convert the search registration to `registerAppTool(server, "tomtom-junction-search", { description: <unchanged>, inputSchema: junctionSearchSchema, _meta: { [RESOURCE_URI_META_KEY]: JUNCTION_LIVE_RESOURCE_URI } }, getJunctionSearchHandler())`. Archive stays `server.registerTool`. Run tool tests → PASS.
- [ ] **Step 6: Full suite + lint green.**
- [ ] **Step 7: Commit** — `feat(junction): bind junction-search to junction-live MCP app, cache raw catalog`

### Task 5: junction-live-data vertical (schema + handler + tool, geometry rule)

**Files:**
- Modify: `src/schemas/junction-analytics/junctionAnalyticsSchema.ts:37-48` (`junctionLiveDataDetailsSchema`), `src/handlers/junctionAnalyticsHandler.ts:127-224` (`getJunctionLiveDataDetailsHandler`), `src/tools/junctionAnalytics.ts:62-94`
- Test: `src/handlers/junctionAnalyticsHandler.test.ts`, `src/tools/junctionAnalytics.test.ts`

**Interfaces:**
- Consumes: `JUNCTION_LIVE_RESOURCE_URI` const from Task 4 (same file; resource already registered — do NOT call `registerAppResourceFromPath` again).
- Produces: viz payload `{ tool: "tomtom-junction-live-data", junctions: JunctionLiveData[] }` where every element retains `junctionModel` (fetched with geometry when `show_ui !== false`).

- [ ] **Step 1: Schema** — add to `junctionLiveDataDetailsSchema`:

```ts
  show_ui: z
    .boolean()
    .optional()
    .describe("Render the interactive junction map app (default true). Set false for text-only analysis."),
```

- [ ] **Step 2: Write failing handler tests** — this is the one non-mechanical handler; cover the fetch/strip matrix. Mock `getJunctionLiveData` to return a result WITH `junctionModel` when called with `includeGeometry: true` and WITHOUT it otherwise (inspect the options argument in the mock implementation). Tests:
  - **default (`show_ui` undefined, `includeGeometry` undefined):** service called with `{ includeGeometry: true }`; `flattenJunctionLiveData` (spy on the real module or assert via SQL table row counts) receives objects WITHOUT `junctionModel` (metadata tables empty — SQL semantics identical to a no-geometry call); `storeVizData` payload junctions HAVE `junctionModel`; `metadata.parameters.includeGeometry` is `undefined`; `_meta.show_ui` true.
  - **`includeGeometry: true`, `show_ui` undefined:** service called with `includeGeometry: true`; flatten input KEEPS `junctionModel` (metadata tables populated); viz stored; `metadata.parameters.includeGeometry === true`.
  - **`show_ui: false`, `includeGeometry` undefined:** service called with options NOT containing `includeGeometry: true` (untouched user options); no `storeVizData`; `_meta` = `{ show_ui: false }`.
  - **`show_ui: false`, `includeGeometry: true`:** service called with `includeGeometry: true`; flatten keeps model; no store.
  - `storeVizData` throws → `_meta: { show_ui: false }`, success response.
- [ ] **Step 3: Run → FAIL**, then implement. Change line 129 and the fetch (line 160):

```ts
    const { junctionIds, sql_queries, show_ui, ...options } = params;
```

```ts
      // 1. Fetch all junctions in PARALLEL.
      // The map app needs junctionModel geometry, so when the UI is enabled we
      // force includeGeometry on the FETCH — but SQL must see exactly what the
      // user asked for, so we strip junctionModel again before flattening.
      const wantGeometry = options.includeGeometry === true;
      const fetchOptions =
        !wantGeometry && show_ui !== false ? { ...options, includeGeometry: true } : options;
      const rawResults = await Promise.all(ids.map((id) => getJunctionLiveData(id, fetchOptions)));

      const sqlResults = wantGeometry
        ? rawResults
        : rawResults.map(({ junctionModel: _junctionModel, ...rest }) => rest);
```

Use `sqlResults` in the stats loop and the flatten loop (`flattenJunctionLiveData(rawResult)` over `sqlResults`). Keep `metadata.parameters.includeGeometry: options.includeGeometry` (user's value, unchanged). Add the standard viz block after row counts with payload `{ tool: "tomtom-junction-live-data", junctions: rawResults }` and `_meta: vizMeta` on the response. Run → PASS.
- [ ] **Step 4: Tool tests + implementation** — assert live-data tool registered via `registerAppTool` with the SAME `JUNCTION_LIVE_RESOURCE_URI`, and `registerAppResourceFromPath` still called exactly once total for the junction URI. Convert the registration in `src/tools/junctionAnalytics.ts` (description unchanged). Run → PASS.
- [ ] **Step 5: Full suite + lint green.**
- [ ] **Step 6: Commit** — `feat(junction): live-data app binding with forced-geometry fetch + SQL strip`

### Task 6: junction-live app (dual-mode)

**Files:**
- Create: `src/apps/traffic-analytics/junction-live/app.html`, `app.ts`, `styles.css`

**Interfaces:**
- Consumes: both viz payloads (Tasks 4+5); shared utils; SDK `TomTomMap`, `CustomGeoJSONModule`, `bboxFromGeoJSON` from `@tomtom-org/maps-sdk/core`.
- Produces: E2E contract — `#junction-panel` toggles `hidden`; layer ids containing `junction-live-junctions` (search) and `junction-live-approaches` (live); sidebar rows `.junction-item` (search) and `.approach-card` (live); `window.__e2e_ml`.

Layout archetype: sidebar (reference `src/apps/traffic-analytics/traffic-incidents/{app.html,app.ts,styles.css}` for the flex split, list styling, chips, and detail-card pattern).

- [ ] **Step 1: `app.html`** — incidents-style skeleton:

```html
<div id="app-root">
  <div id="waiting-state" class="state-panel">Waiting for tool result…</div>
  <div id="sdk-map"></div>
  <aside id="junction-panel" class="hidden">
    <div id="junction-chips" class="junction-chips hidden"></div>
    <div id="panel-list" class="panel-list"></div>
    <div id="empty-state" class="state-panel hidden">No junctions found</div>
  </aside>
  <div id="junction-detail-card" class="junction-detail-card tta-panel hidden"></div>
  <div id="legend" class="legend tta-panel hidden"></div>
</div>
```

- [ ] **Step 2: `app.ts`** — standard spine, `App({ name: "tta-junction-live", version: "1.0.0" })`. App-local types mirroring `src/services/junction-analytics/types.ts` (`JunctionDefinition`, `JunctionModel`, `Approach`, `Exit`, `JunctionLiveData`, `ApproachLiveData`, `TurnRatio` — trimmed to the fields used). Payload guard: `Array.isArray((viz as any)?.junctions)`; mode = `viz.tool === "tomtom-junction-live-data" ? "live" : "search"`.

LOS bands (app-local):

```ts
const LOS_BANDS = [
  { letter: "A", max: 10, color: "#2dc653" },
  { letter: "B", max: 20, color: "#8ac926" },
  { letter: "C", max: 35, color: "#f5a623" },
  { letter: "D", max: 55, color: "#e07b39" },
  { letter: "E", max: 80, color: "#e03030" },
  { letter: "F", max: Infinity, color: "#8b0000" },
] as const;
const NEUTRAL_APPROACH = "#64748b";
const NEUTRAL_EXIT = "#9ca3af";
function losFor(delaySec: number | null | undefined) {
  if (delaySec == null || !Number.isFinite(delaySec)) return undefined;
  return LOS_BANDS.find((b) => delaySec <= b.max);
}
```

Module creation (once):

```ts
geoModule ??= await CustomGeoJSONModule.get(map, {
  sources: {
    junctions: { layers: [
      { id: "junction-live-junctions-circle", type: "circle",
        paint: { "circle-radius": ["case", ["boolean", ["feature-state", "selected"], false], 8, 6],
                 "circle-color": "#0a3653", "circle-stroke-width": 2, "circle-stroke-color": "#ffffff" } },
      { id: "junction-live-junctions-label", type: "symbol",
        layout: { "text-field": ["get", "name"], "text-size": 12, "text-anchor": "top", "text-offset": [0, 1.1] },
        paint: { "text-halo-color": "#ffffff", "text-halo-width": 1.5 } },
    ]},
    approaches: { layers: [
      { id: "junction-live-approaches-casing", type: "line",
        layout: { "line-join": "round", "line-cap": "round" },
        paint: { "line-color": "#ffffff",
                 "line-width": ["case", ["boolean", ["feature-state", "selected"], false], 11,
                                        ["boolean", ["feature-state", "hover"], false], 9, 7] } },
      { id: "junction-live-approaches-line", type: "line",
        filter: ["!=", ["get", "closed"], true],
        layout: { "line-join": "round", "line-cap": "round" },
        paint: { "line-color": ["get", "color"],
                 "line-width": ["case", ["boolean", ["feature-state", "selected"], false], 7,
                                        ["boolean", ["feature-state", "hover"], false], 5.5, 4] } },
      { id: "junction-live-approaches-closed", type: "line",
        filter: ["==", ["get", "closed"], true],
        layout: { "line-join": "round", "line-cap": "round" },
        paint: { "line-color": "#e03030", "line-width": 4, "line-dasharray": [2, 1.5] } },
    ]},
    exits: { layers: [
      { id: "junction-live-exits-line", type: "line",
        layout: { "line-join": "round", "line-cap": "round" },
        paint: { "line-color": NEUTRAL_EXIT,
                 "line-width": ["case", ["boolean", ["feature-state", "hover"], false], 5, 2.5] } },
    ]},
  },
});
```

**Search mode** (`renderSearchMode(junctions: JunctionDefinition[])`):
- Junction point features: `properties.id = junction.id`, `name`; geometry from `rawJunction.geometry` when `type === "Point"`, else centroid of the polygon's first ring (average of vertices). Skip junctions with no usable geometry. `geoModule.show(fc, "junctions")`; clear `approaches`/`exits`; fit to `bboxFromGeoJSON(fc)` (padding 60).
- Sidebar: `.junction-item` rows (name + status badge: `ACTIVE` green, `PREVIEW` gray, `PENDING_UPDATE` amber, `ERROR` red — colored dot + text, same row style as `.incident-item`). `#empty-state` when zero junctions.
- `selectJunction(id)`: feature-state `selected` on the junction point (clear previous); `flyTo` its coordinates (zoom 16); if `junctionModel` present, build approach features (props `{ id: "a-" + approach.id, color: NEUTRAL_APPROACH, closed: false, name, roadName }`) and exit features (`{ id: "x-" + exit.id }`) from `segmentedGeometry` (MultiLineString used as-is) and `show()` them, else clear both sources; render `#junction-detail-card`: junction name, status, country, traffic-lights flag, approach list (`roadName · direction · FRC n`), and the static hint `Run tomtom-junction-live-data with this junction's ID for live metrics.` All API text through `escapeHtml`.
- Wire `geoModule.events.junctions.on("click", f => selectJunction(String(f.id)))` (bind once with a `…Bound` guard).
- Legend hidden in search mode.

**Live mode** (`renderLiveMode(junctions: JunctionLiveData[])`):
- `#junction-chips`: one `.tta-chip` per junction (label = `junctionModel?.name ?? id`), visible when >1; clicking selects.
- `selectLiveJunction(j: JunctionLiveData)`: for each approach in `j.junctionModel?.approaches ?? []`, join live data by id (`j.approachesLiveData.find(a => a.id === approach.id)`); approach feature props `{ id: "a-" + approach.id, color: losFor(live?.delaySec)?.color ?? NEUTRAL_APPROACH, closed: live?.isClosed === true }`; exits neutral. `show()` approaches + exits, clear `junctions` source, fit to the union FeatureCollection. If `junctionModel` missing → clear all sources and prepend a `.geometry-note` ("Geometry unavailable for this junction") above the cards; cards still render.
- Sidebar `.approach-card` per approach (ordered by `delaySec` desc): header row `roadName` + direction; LOS letter badge (background = band color) + `delay 42 s`; body rows: travel time `47 s (free-flow 15 s)`, queue `30 m`, stops, volume `600 veh/h` (omit when undefined), red `Closed` pill when `isClosed`. Card click → `selectApproach(approachId)`; mouseenter/leave → hover feature-state on `"a-" + id`.
- `selectApproach(id)`: feature-state `selected` (clear previous); expand the card's turn-ratio table: rows = `turnRatios` sorted by `ratioPercent` desc, columns Exit (exit `roadName`/`name` looked up in `junctionModel.exits` by `exitId`, fallback `#<exitId>`), Share `70%`, Probes. Row mouseenter/leave → hover feature-state on `"x-" + exitId`.
- Map events: `approaches.on("click")` → selectApproach; `approaches.on("hover")` → hover state + card `.hover` class sync.
- `renderLosLegend()` into `#legend` (show it): six color swatches A–F with second line `A ≤10 s … F >80 s`.

`onteardown` → `geoModule?.setVisible(false); return {};`
- [ ] **Step 3: `styles.css`** — copy the incidents preamble (flex `#app-root`, `#sdk-map { flex: 1 1 auto; min-width: 0; }`, sidebar width ~320px, `html.ui-hidden` collapse). Positioning/typography only: `.junction-chips` (wrap row, padding, gap), `.junction-item` rows (border-bottom, hover bg via `var(--color-background-secondary, #f3f4f6)`), `.status-badge` colored dot+text, `.approach-card` (border-bottom, `.hover`/`.selected` background states), `.los-badge` (letter pill, white text), `.turn-ratio-table` (compact table, right-aligned numbers), `.geometry-note` (small secondary text), `.junction-detail-card` floating bottom-left `z-index:1000`, `.legend` bottom-left `z-index:900`. Chrome via `.tta-panel`/`.tta-chip` classes in the markup.
- [ ] **Step 4: Build + standalone smoke** — `npm run build:apps` → single-file `dist/apps/traffic-analytics/junction-live/app.html`; open standalone → waiting state, no console errors; `npx tsc -p src/apps/tsconfig.json --noEmit` clean.
- [ ] **Step 5: Commit** — `feat(junction): interactive junction map app (search + live modes)`

### Task 7: route-search vertical (schema + handler + tool)

**Files:**
- Modify: `src/schemas/route-monitoring/routeMonitoringSchema.ts:52-54` (`routeSearchSchema`), `src/handlers/routeMonitoringHandler.ts:46-110` (`createRouteSearchHandler`), `src/tools/routeMonitoring.ts:30-60`
- Test: `src/handlers/routeMonitoringHandler.test.ts`, `src/tools/routeMonitoring.test.ts`

**Interfaces:**
- Consumes: `storeVizData` (add import to `routeMonitoringHandler.ts`), tool-registration imports (add to `routeMonitoring.ts`).
- Produces: viz payload `{ tool: "tomtom-route-search", routes: RouteBasicInfo[] }` (raw — includes `routePathPoints`); resource URI `ui://tomtom-traffic-analytics/route-details/app.html` registered ONCE (Task 8 reuses it).

- [ ] **Step 1: Schema** — add to `routeSearchSchema`:

```ts
  show_ui: z
    .boolean()
    .optional()
    .describe("Render the interactive route map app (default true). Set false for text-only analysis."),
```

- [ ] **Step 2: Write failing handler tests** (mock vizCache as in Task 4; handler signature gains `show_ui`): default → `storeVizData({ tool: "tomtom-route-search", routes: <mocked getRoutes result> })` + `_meta {show_ui:true, viz_id}`; `show_ui:false` → no store; store-throw → `{show_ui:false}`; missing sql_queries → error, no store.
- [ ] **Step 3: Implement** — widen the params type and destructure: `async (params: { sql_queries?: Record<string, string>; show_ui?: boolean }) => { const { sql_queries, show_ui } = params; ... }`; standard viz block after row counts; `_meta: vizMeta`. → PASS.
- [ ] **Step 4: Tool tests + implementation** — in `src/tools/routeMonitoring.ts`:

```ts
const ROUTE_DETAILS_RESOURCE_URI = "ui://tomtom-traffic-analytics/route-details/app.html";
```

`registerAppResourceFromPath(server, ROUTE_DETAILS_RESOURCE_URI, "traffic-analytics", "route-details");` once, then convert `tomtom-route-search` to `registerAppTool` with the URI in `_meta` (description unchanged). Tests assert both, plus details tool still plain (until Task 8). → PASS.
- [ ] **Step 5: Full suite + lint green. Commit** — `feat(route): bind route-search to route-details MCP app, cache raw route list`

### Task 8: route-details vertical (schema + handler + tool)

**Files:**
- Modify: `src/schemas/route-monitoring/routeMonitoringSchema.ts:31-38` (`getRouteDetailsSchema`), `src/handlers/routeMonitoringHandler.ts:121-217` (`createGetRouteDetailsHandler`), `src/tools/routeMonitoring.ts:62-89`
- Test: same two test files as Task 7

**Interfaces:**
- Consumes: `ROUTE_DETAILS_RESOURCE_URI` const from Task 7 (same file, no second resource registration).
- Produces: viz payload `{ tool: "tomtom-route-monitoring-details", routes: RouteDetailedInfo[] }` (raw — `routePathPoints` + `detailedSegments[].shape`).

- [ ] **Step 1: Schema** — add the same `show_ui` field (describe: "Render the interactive route map app (default true). Set false for text-only analysis.") to `getRouteDetailsSchema`.
- [ ] **Step 2: Failing handler tests** — default → `storeVizData({ tool: "tomtom-route-monitoring-details", routes: <mocked getRouteDetails results array> })` + `_meta`; `show_ui:false` → none; store-throw → degrade; >20 ids and missing sql_queries error paths → no store.
- [ ] **Step 3: Implement** — params type `{ routeIds: string[]; sql_queries?: Record<string, string>; show_ui?: boolean }`, destructure `show_ui`, standard viz block after row counts (payload `routes: rawResults`), `_meta: vizMeta`. → PASS.
- [ ] **Step 4: Tool tests + implementation** — convert `tomtom-route-monitoring-details` to `registerAppTool` with the same URI; assert `registerAppResourceFromPath` called exactly once total for the route URI. → PASS.
- [ ] **Step 5: Full suite + lint green. Commit** — `feat(route): bind route-details tool to MCP app, cache raw segment shapes`

### Task 9: route-details app (dual-mode)

**Files:**
- Create: `src/apps/traffic-analytics/route-details/app.html`, `app.ts`, `styles.css`

**Interfaces:**
- Consumes: viz payloads (Tasks 7+8); `ratioToColor`/`renderRampLegend`/`NO_DATA_COLOR` from `@shared/speed-colors`; shared utils; SDK `TomTomMap`, `CustomGeoJSONModule`, `bboxFromGeoJSON`.
- Produces: E2E contract — `#route-panel` toggles `hidden`; layer ids containing `route-details-routes` / `route-details-segments`; sidebar `.route-item` rows (search), `.segment-row` table rows + `.tta-chip` route chips (details); `window.__e2e_ml`.

- [ ] **Step 1: `app.html`** — sidebar skeleton:

```html
<div id="app-root">
  <div id="waiting-state" class="state-panel">Waiting for tool result…</div>
  <div id="sdk-map"></div>
  <aside id="route-panel" class="hidden">
    <div id="route-chips" class="route-chips hidden"></div>
    <div id="route-stats" class="route-stats hidden"></div>
    <div id="panel-list" class="panel-list"></div>
    <div id="empty-state" class="state-panel hidden">No routes found</div>
  </aside>
  <div id="legend" class="legend tta-panel hidden"></div>
</div>
```

- [ ] **Step 2: `app.ts`** — standard spine, `App({ name: "tta-route-details", version: "1.0.0" })`. App-local types mirroring `src/services/route-monitoring/types.ts` (`PathPoint`, `RouteBasicInfo`, `RouteSegment`, `RouteDetailedInfo`). Payload guard `Array.isArray((viz as any)?.routes)`; mode from `viz.tool`.

Ratio helpers (app-local, delegating to shared colors):

```ts
/** relativeSpeed arrives either as a fraction (0.83) or a percent (83) depending on API tier — normalize to fraction. */
function normalizeRelativeSpeed(v: number | null | undefined): number | undefined {
  if (v == null || !Number.isFinite(v)) return undefined;
  return v > 3 ? v / 100 : v;
}
/** Route-level ratio for search mode: typical/actual travel time ≈ relative speed. */
function routeRatio(r: { travelTime?: number; typicalTravelTime?: number }): number | undefined {
  if (!r.travelTime || !r.typicalTravelTime || r.travelTime <= 0) return undefined;
  return Math.min(1, r.typicalTravelTime / r.travelTime);
}
```

Module creation (once):

```ts
geoModule ??= await CustomGeoJSONModule.get(map, {
  sources: {
    routes: { layers: [
      { id: "route-details-routes-casing", type: "line",
        layout: { "line-join": "round", "line-cap": "round" },
        paint: { "line-color": "#ffffff",
                 "line-width": ["case", ["boolean", ["feature-state", "selected"], false], 9,
                                        ["boolean", ["feature-state", "hover"], false], 8, 7 ] } },
      { id: "route-details-routes-line", type: "line",
        filter: ["!=", ["get", "impassable"], true],
        layout: { "line-join": "round", "line-cap": "round" },
        paint: { "line-color": ["get", "color"],
                 "line-width": ["case", ["boolean", ["feature-state", "selected"], false], 6,
                                        ["boolean", ["feature-state", "hover"], false], 5, 4 ] } },
      { id: "route-details-routes-impassable", type: "line",
        filter: ["==", ["get", "impassable"], true],
        layout: { "line-join": "round", "line-cap": "round" },
        paint: { "line-color": "#e03030", "line-width": 4, "line-dasharray": [2, 1.5] } },
    ]},
    segments: { layers: [
      { id: "route-details-segments-casing", type: "line",
        layout: { "line-join": "round", "line-cap": "round" },
        paint: { "line-color": "#ffffff",
                 "line-width": ["case", ["boolean", ["feature-state", "selected"], false], 10,
                                        ["boolean", ["feature-state", "hover"], false], 9, 7 ] } },
      { id: "route-details-segments-line", type: "line",
        layout: { "line-join": "round", "line-cap": "round" },
        paint: { "line-color": ["get", "color"],
                 "line-width": ["case", ["boolean", ["feature-state", "selected"], false], 7,
                                        ["boolean", ["feature-state", "hover"], false], 6, 4.5 ] } },
    ]},
  },
});
```

`pathToLine(points: PathPoint[])` → `[lng, lat][]`.

**Search mode** (`renderSearchMode(routes: RouteBasicInfo[])`):
- Route features: `properties = { id: String(route.routeId), color: ratioToColor(routeRatio(route)), impassable: route.passable === false, name: route.routeName }`, geometry LineString from `routePathPoints`. Skip routes with <2 path points. `show(fc, "routes")`, clear `segments`, fit to fc.
- Sidebar `.route-item` rows: name, status badge, `5.0 km`, travel time, delay (`+50 s` amber/red when >0), red `Impassable` pill when `passable === false`. Row click / map click → `selectRoute(id)`: feature-state selected, fit to that route's bbox, row `.selected`. Detail hint in the row's expanded state: `Run tomtom-route-monitoring-details for segment-level analysis.`
- Legend visible (`renderRampLegend(el("legend"), "Travel time vs typical")`).

**Details mode** (`renderDetailsMode(routes: RouteDetailedInfo[])`):
- `#route-chips` (`.tta-chip` per route, visible when >1). `selectRoute(routeId)` drives everything below; default = first route.
- Map: for the SELECTED route — if `detailedSegments` has entries with `shape` (≥2 points), build one feature per such segment: `properties = { id: `${routeId}:${seg.segmentId}`, color: ratioToColor(normalizeRelativeSpeed(seg.relativeSpeed)), routeId: String(routeId), segmentId: seg.segmentId }` → `show(fc, "segments")` and clear `routes`. Fallback (no usable segment shapes): draw the whole route into `routes` colored by `routeRatio` and clear `segments`. NON-selected routes also drawn in `routes` with reduced prominence (their normal color; the selected route's segments render on top).
- `#route-stats` (`.tta-panel`-free — it's inside the sidebar): route name + status badge; grid rows: travel time vs typical (`5 min 0 s / 4 min 10 s`), delay, length km, confidence % (`routeConfidence`), passable badge.
- Segment table in `#panel-list`: header row + `.segment-row` per detailed segment (in array order): `#` (1-based), length m, current / typical speed, ratio cell (color dot via `ratioToColor` + `83%`; em-dash when relativeSpeed missing). Row mouseenter/leave ↔ toggles the row's own `.hover` class AND feature-state hover on the map; row click ↔ selected. Map `segments` events: hover → row `.hover` + `scrollIntoView({ block: "nearest" })`; click → row selected.
- Legend visible (`renderRampLegend(el("legend"), "Current vs typical speed")`).

Feature-state plumbing: one `setState(source: "routes" | "segments", id: string | number, state: "hover" | "selected")` helper tracking previous ids per state and calling `map.mapLibreMap.setFeatureState`/`removeFeatureState` with `geoModule.sourceAndLayerIDs[source].sourceID`.

`onteardown` → `geoModule?.setVisible(false); return {};`
- [ ] **Step 3: `styles.css`** — incidents-style sidebar preamble + positioning-only rules: `.route-chips` wrap row; `.route-item` rows; `.route-stats` grid (label column `var(--color-text-secondary, #6b7280)`); segment table (`table-layout: fixed`, sticky header via `position: sticky; top: 0; background: var(--color-background-primary, #fff)`, `.segment-row.hover`/`.selected` backgrounds); `.ratio-dot` (10px circle inline-block); `.legend` bottom-left. `html.ui-hidden` collapse rule for `#app-root`.
- [ ] **Step 4: Build + standalone smoke** — `npm run build:apps`; open standalone → waiting state, no console errors; app tsconfig typecheck clean.
- [ ] **Step 5: Commit** — `feat(route): interactive route map app (search + segment details modes)`

### Task 10: E2E specs + UI example inputs

**Files:**
- Modify: `e2e/apps.spec.ts`, `ui/src/index.tsx:84-131`

**Interfaces:**
- Consumes: E2E DOM contracts from Tasks 3/6/9; existing helpers `runToolWithUI`, `getAppFrame`, `findInnerAppFrame`, `verifyJsonResult` in `e2e/apps.spec.ts:15-77`.
- Produces: 5 new key-gated specs; example inputs with `show_ui: true` for all five tools.

- [ ] **Step 1: Example inputs** — in `ui/src/index.tsx` add `show_ui: true` to the five entries (`tomtom-traffic-flow-segment`, `tomtom-junction-search`, `tomtom-junction-live-data`, `tomtom-route-search`, `tomtom-route-monitoring-details`). Leave `EXAMPLE_JUNCTION_ID`/`EXAMPLE_ROUTE_ID` placeholders as-is. NOT `tomtom-junction-archive` (no app).
- [ ] **Step 2: Extend `verifyJsonResult`** to return the parsed response object (it already parses `json-result`; add `return parsed;`) so specs can chain discovery → details. Update its call sites if the signature assertion changes.
- [ ] **Step 3: Add 5 specs** (same fixture + helper style as the existing three; all skip when keys are unset via the existing fixture guard):

```ts
test("Traffic Flow app renders segment and stat card", async ({ page }) => {
  await runToolWithUI(page, "tomtom-traffic-flow-segment"); // example input has show_ui: true
  const frame = await getAppFrame(page);
  await expect(frame.locator("#sdk-map")).toHaveClass(/visible/, { timeout: 30000 });
  await expect(frame.locator("#flow-panel")).not.toHaveClass(/hidden/);
  await expect(frame.locator("#stat-grid dt").first()).toBeVisible(); // stats populated
  const inner = await findInnerAppFrame(page);
  await inner.waitForFunction(() =>
    (window as any).__e2e_ml?.getStyle().layers.some((l: any) => l.id.includes("traffic-flow-segment")));
  await verifyJsonResult(page);
});

test("Junction app renders search mode and live mode", async ({ page }) => {
  await runToolWithUI(page, "tomtom-junction-search");
  const frame = await getAppFrame(page);
  await expect(frame.locator("#sdk-map")).toHaveClass(/visible/, { timeout: 30000 });
  await expect(frame.locator("#junction-panel")).not.toHaveClass(/hidden/);
  const searchResult = await verifyJsonResult(page);
  const junctionId = searchResult?.aggregated_data?.junctions?.[0]?.junction_id;
  test.skip(!junctionId, "No junctions configured in this Move Portal account");
  await runToolWithUI(page, "tomtom-junction-live-data", {
    junctionIds: [junctionId],
    sql_queries: { delays: "SELECT junction_id, approach_id, delay_sec FROM approaches" },
    show_ui: true,
  });
  const liveFrame = await getAppFrame(page);
  await expect(liveFrame.locator(".approach-card").first()).toBeVisible({ timeout: 30000 });
  const inner = await findInnerAppFrame(page);
  await inner.waitForFunction(() =>
    (window as any).__e2e_ml?.getStyle().layers.some((l: any) => l.id.includes("junction-live-approaches")));
  await verifyJsonResult(page);
});

test("Route app renders search mode and segment details", async ({ page }) => {
  await runToolWithUI(page, "tomtom-route-search");
  const frame = await getAppFrame(page);
  await expect(frame.locator("#sdk-map")).toHaveClass(/visible/, { timeout: 30000 });
  await expect(frame.locator("#route-panel")).not.toHaveClass(/hidden/);
  const searchResult = await verifyJsonResult(page);
  const routeId = searchResult?.aggregated_data?.routes?.[0]?.route_id;
  test.skip(routeId == null, "No routes configured in this Move Portal account");
  await runToolWithUI(page, "tomtom-route-monitoring-details", {
    routeIds: [String(routeId)],
    sql_queries: { info: "SELECT * FROM route_info" },
    show_ui: true,
  });
  const detailsFrame = await getAppFrame(page);
  await expect(detailsFrame.locator(".segment-row").first()).toBeVisible({ timeout: 30000 });
  // row↔map highlight smoke: hovering a row must mark it (feature-state side asserted visually in Task 11)
  await detailsFrame.locator(".segment-row").first().hover();
  await expect(detailsFrame.locator(".segment-row").first()).toHaveClass(/hover/);
  await verifyJsonResult(page);
});
```

(Split into more `test()` blocks if the two-step flows prove flaky — the discovery step re-runs cheaply. If junction/route search mode legitimately returns zero rows the specs assert the `#empty-state` fallback instead before skipping.)
- [ ] **Step 4: Run** — `npm run test:e2e` (keys from `.env`, `ALLOWED_ORIGINS=http://127.0.0.1:8080`) → all specs green (existing 3 + new). Fix flakiness with timeout bumps, not sleeps.
- [ ] **Step 5: Commit** — `test(e2e): cover flow, junction, and route apps; example inputs`

### Task 11: Visual verification round

**Files:** none committed except fixes it triggers. Screenshot script is throwaway (NOT committed); screenshots go to `.superpowers/sdd/screenshots/`.

- [ ] **Step 1:** `npm run build` (full: ts + rollup + apps), then start the harness: `npm run ui` (background; host at `http://127.0.0.1:8080`).
- [ ] **Step 2:** Throwaway Playwright script: for each of the five tools, run the example input, wait for the app to settle, screenshot the app iframe AND the full page to `.superpowers/sdd/screenshots/<tool>-{iframe,fullpage}.png`. For junction-live/route-details also capture the details mode (real id discovered from the search run), an approach selected (turn-ratio table open), and a segment row hovered.
- [ ] **Step 3: READ every screenshot** (Read tool) and check against the design: stat card values plausible and formatted; ramp/LOS legends correct (gradient direction, labels); line colors match legend; chips/cards/table follow the `.tta-*` visual system; panels don't overlap map controls; closure/impassable badges only when applicable. Fix any issue found, rebuild, re-screenshot, re-read. Repeat until clean.
- [ ] **Step 4:** Kill the harness (no servers left running). Commit any fixes — `fix(apps): visual polish from screenshot review` (or per-fix messages).

### Task 12: Docs, token metrics, final gates, push + PR update

**Files:**
- Modify: `README.md` (Interactive Map Apps section — extend the tool/app table with the three new apps and five tools; note junction-archive intentionally has no app), `.claude/CLAUDE.md` only if commands changed (they didn't — verify and skip).

- [ ] **Step 1: README** — update the apps section: list all 7 app-enabled tools → 5 apps, `show_ui` universal, `TOMTOM_API_KEY` needed for map rendering, junction-live geometry note (fetch-forced, SQL unchanged). Commit: `docs: document flow/junction/route MCP apps`.
- [ ] **Step 2: Token metrics** — `node tests/test-comprehensive.js --metrics-only`. Record per-tool wire/token numbers in the task report; the five modified tools should each grow only by the `show_ui` describe (~15-20 tokens). Do NOT attempt to fix the pre-existing incidents/area drift.
- [ ] **Step 3: Full gate** — `npm run lint` (0 errors) && `npx vitest run` (all pass, coverage green) && `npm run build` && `npm pack --dry-run` (includes `dist/apps/traffic-analytics/{traffic-flow,junction-live,route-details}/app.html`) && `npm run build:mcpb` **from PowerShell** (bundle contains `app/apps/traffic-analytics/*/app.html` ×5 dirs) && `npm run test:e2e` (live, green).
- [ ] **Step 4: Push** — `git push origin feat/mcp-apps-traffic-tools` (gh account `carlosprietofernandez-tomtom`).
- [ ] **Step 5: Update PR #26** — `gh pr edit 26` title → `feat: MCP apps for traffic tools (incidents, area analytics, flow, junctions, routes)`; body: append a "Second wave" section (three new apps, screenshots from Task 11, the junction geometry fetch/strip rule, junction-archive exclusion rationale, token-metric deltas). Keep the Claude Code attribution footer.

## Verification (end-to-end)

1. `npx vitest run` — full suite green, coverage thresholds met.
2. `npm run build` — tsc + rollup + 5 single-file apps in `dist/apps/traffic-analytics/`.
3. MCP inspector (`npm run inspector`): `tools/list` shows `show_ui` on all 7 app-enabled tools; `resources/read` of all three new URIs returns real HTML with CSP `_meta`.
4. `npm run ui` + live keys: all five tools render their apps; `show_ui: false` suppresses UI; junction live-data WITHOUT `includeGeometry` still renders approach geometry on the map while its SQL metadata tables stay empty.
5. `npm run test:e2e` — 8 specs green (3 existing + 5 new assertions across 3 tests).
6. Screenshots in `.superpowers/sdd/screenshots/` reviewed (actually read) and consistent with the approved design.

## Risks (acknowledged)

- **Junction search payload size** — all junctions with geometry cached in memory (5-min TTL) and mirrored to the app's localStorage LRU (quota-guarded with try/catch in `viz-data.ts`). Accepted; no server change.
- **`relativeSpeed` unit ambiguity** (fraction vs percent) — handled by `normalizeRelativeSpeed` (>3 ⇒ percent). Verified against live data in Task 11.
- **Two-step E2E flows** depend on the Move Portal account having junctions/routes — specs skip gracefully with an explicit message.
- **`RESOURCE_URI_META_KEY` mock string** — tool tests must mirror the real exported constant; copy the existing mock from `src/tools/liveTraffic.test.ts` rather than guessing.
