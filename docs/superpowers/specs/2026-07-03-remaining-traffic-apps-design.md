# MCP Apps for Remaining Traffic Tools — Design

Extends PR #26 (`feat/mcp-apps-traffic-tools`) with MCP apps for the five remaining
geometry-bearing tools, reusing the infrastructure landed in the first two apps
(traffic-incidents, area-analytics). `tomtom-junction-archive` gets **no app**
(time-series only, no geometry — confirmed decision).

| App (dir under `src/apps/traffic-analytics/`) | Tools bound | Layout archetype |
|---|---|---|
| `traffic-flow` | `tomtom-traffic-flow-segment` | Floating overlay (like area-analytics) |
| `junction-live` | `tomtom-junction-search`, `tomtom-junction-live-data` | Sidebar (like traffic-incidents) |
| `route-details` | `tomtom-route-search`, `tomtom-route-monitoring-details` | Sidebar |

## Architecture (decided)

**Hybrid sharing.** Each app duplicates the proven ~60-line lifecycle spine
(import order, `ontoolinput`/`ontoolresult`/`onteardown` registered **before**
`app.connect()`, `shouldShowUI` → `ensureTomTomConfigured` → `extractFullData` →
viz-shape guard → `showMapUI`). The two shipped apps are **not** refactored.
One new shared module only:

- `src/apps/shared/speed-colors.ts` — speed-ratio color ramp + tiny legend-HTML
  builder, used by traffic-flow and route-details. Ratio domain (0, 1] =
  current/free-flow (or typical/actual travel time). Stops: ≤0.4 `#e03030` (red),
  0.7 `#f5a623` (amber), ≥0.9 `#2dc653` (green), linear interpolation — same hues
  as the existing area-analytics legend. Exports a MapLibre
  `['interpolate', ['linear'], ['get', 'ratio'], …]` expression builder, a
  `ratioToColor(ratio)` for DOM swatches, and `renderRampLegend(el, label)`.
  Node-testable (no DOM in the expression/color functions) → unit tests.

Junction LOS banding is junction-specific and stays app-local.

All established infra is reused as-is: `vizCache` + `_meta:{show_ui,viz_id}`
handler pattern, `registerAppTool` + `registerAppResourceFromPath` (CSP inherited,
incl. the mandatory unpkg allowance), `@shared` utils, Vite build auto-discovery,
`npm run ui` harness + Playwright E2E, `window.__e2e_ml` contract.

## Viz payload contracts

```ts
// traffic-flow
{ tool: "tomtom-traffic-flow-segment",
  request: { point: {latitude, longitude}, style, zoom, unit },
  segment: TrafficFlowSegmentResponse }            // frc, speeds, travel times, confidence, roadClosure, coordinates[]

// junction-live (mode discriminated on `tool`)
{ tool: "tomtom-junction-search",   junctions: JunctionDefinition[] }   // rawJunction + junctionModel (geometry already fetched)
{ tool: "tomtom-junction-live-data", junctions: JunctionLiveData[] }    // approachesLiveData + junctionModel (see handler rule)

// route-details (mode discriminated on `tool`)
{ tool: "tomtom-route-search",              routes: RouteBasicInfo[] }    // incl. routePathPoints
{ tool: "tomtom-route-monitoring-details",  routes: RouteDetailedInfo[] } // incl. routePathPoints + detailedSegments[].shape
```

## Handler changes (5 handlers, incidents block as template)

Each destructures `show_ui`, and when `show_ui !== false` wraps `storeVizData(...)`
in try/catch → `_meta: { show_ui: true, viz_id }`, degrading to `{ show_ui: false }`
on store failure. Error paths never store. Insert points (current line refs):
`liveTrafficHandler.ts:62` (flow), `junctionAnalyticsHandler.ts:69` (search) and
`:160` (live), `routeMonitoringHandler.ts:68` (route list) and `:156` (details).

**junction-live-data geometry rule** (the one non-mechanical change):

```ts
const wantGeometry  = params.includeGeometry === true;      // what the user asked for
const fetchGeometry = wantGeometry || show_ui !== false;    // what we fetch
// fetch with { includeGeometry: fetchGeometry }
// SQL sees exactly what the user asked for — strip before flattening:
const forSql = wantGeometry ? rawResults
             : rawResults.map(({ junctionModel: _m, ...rest }) => rest);
// viz payload gets the full rawResults (with junctionModel)
```

`metadata.parameters.includeGeometry` keeps echoing the **user's** value, so SQL
semantics and response metadata are byte-identical to today when the user didn't
ask for geometry. (Search already hardcodes `includeGeometry: true`; its flattener
never reads geometry — no change needed there.)

## Tool registration

Switch the 5 tools from `server.registerTool` to `registerAppTool` with
`_meta[RESOURCE_URI_META_KEY]`. Resource URIs (one per app; shared-app tools bind
the same URI, `registerAppResourceFromPath` called **once** per URI):

- `ui://tomtom-traffic-analytics/traffic-flow/app.html`
- `ui://tomtom-traffic-analytics/junction-live/app.html` (both junction tools)
- `ui://tomtom-traffic-analytics/route-details/app.html` (both route tools)

Schemas: add `show_ui: z.boolean().optional().describe(...)` to the 5 tool schemas
(short describe strings — re-measure token budget with
`node tests/test-comprehensive.js --metrics-only`; the pre-existing
incidents/area budget drift is a separate follow-up, not this work).

## App designs

### traffic-flow (overlay archetype)

- **DOM:** `#app-root` → `#waiting-state`, `#sdk-map`, `#flow-panel` (hidden until
  data) containing: stat card top-left (`.tta-panel`), backdrop toggle top-right
  (`.tta-chip`), legend bottom-left (`.tta-panel`).
- **Map:** `CustomGeoJSONModule` with sources `segment` (one LineString feature —
  casing line layer + color line layer; single ratio → single color) and `point`
  (queried point, small circle). Line color from `speed-colors` ramp on
  `currentSpeed / freeFlowSpeed`. `roadClosure: true` → dashed dark-red line
  (`line-dasharray`) + "Road closed" badge in the stat card.
- **Stat card:** FRC label (FRC0 "Motorway" … FRC6 "Local road"), current vs
  free-flow speed in requested `unit`, current vs free-flow travel time, delay
  (= currentTravelTime − freeFlowTravelTime, formatted m s), confidence %.
- **Backdrop:** `TrafficFlowModule.get(map, { visible: true })` created **before**
  the CustomGeoJSON module so the segment draws on top; toggle chip flips
  `setVisible`. ON by default.
- **Camera:** `fitBounds(bboxFromCoordsArray(coordinates), { padding: 60 })`.

### junction-live (sidebar archetype, dual-mode)

Mode = viz payload `tool`. Sidebar `#junction-panel`.

- **Search mode:** all junctions as `junctions` source (circle + symbol name
  labels; Point from `rawJunction.geometry`, polygon centroid fallback). Sidebar
  rows: name + status badge (`ACTIVE` green / `PREVIEW` gray / `PENDING_UPDATE`
  amber / `ERROR` red). Click (pin or row) → flyTo + render that junction's
  `approaches`/`exits` sources (neutral blue-gray / lighter gray
  MultiLineStrings) + detail card (road names, directions, FRC, one-way,
  traffic-lights flag) with hint: "Run tomtom-junction-live-data for live metrics".
- **Live mode:** junction selector chips when >1 junction (incidents-chips
  pattern). Selected junction: approaches colored by **LOS bands** on `delaySec`
  — A ≤10 `#2dc653`, B ≤20 `#8ac926`, C ≤35 `#f5a623`, D ≤55 `#e07b39`,
  E ≤80 `#e03030`, F >80 `#8b0000`; `isClosed` → dashed red overriding LOS.
  Exits neutral gray. Sidebar approach cards: road name + direction, LOS letter
  badge + delay, travel vs free-flow time, queue length (m), stops, volume/h,
  closed badge. Card click/hover ↔ map feature-state (`selected`/`hover`) in both
  directions (via `module.sourceAndLayerIDs` + `map.mapLibreMap.setFeatureState`;
  features keyed `properties.id = approach id`). Selecting an approach reveals its
  turn-ratio table (exit road name, ratio %, probes); row hover highlights the
  exit line. LOS A–F legend bottom-left.
- **Degradation:** `junctionModel` absent → metrics-only approach cards + a
  "geometry unavailable" note in the sidebar; no junction features drawn (map
  stays at its current view); sidebar remains fully functional.

### route-details (sidebar archetype, dual-mode)

Mode = viz payload `tool`. Sidebar `#route-panel`.

- **Search mode:** one feature per route from `routePathPoints`, colored by the
  shared ramp on `typicalTravelTime / travelTime` (≈ relative speed; gray when
  `typicalTravelTime` missing); `passable === false` → dashed red. Sidebar route
  rows: name, status, length (km), travel time, delay, passable badge. Click ↔
  feature-state highlight + fitBounds to route; hint to run the details tool.
- **Details mode:** per-segment features from `detailedSegments[].shape`, each
  with `ratio = relativeSpeed`, colored by the shared ramp. Route selector chips
  when >1 route. Stats header for selected route (travel vs typical time, delay,
  length, confidence, passable). Segment table: segment #, length, current /
  typical speed, relativeSpeed with color dot. Row ↔ map feature-state highlight
  both directions; map hover scrolls the row into view.
- **Degradation:** segments missing `shape` → that route falls back to a uniform
  `routePathPoints` line (colored by the route-level ratio); table renders without
  map highlight for shape-less segments.

## Conventions all three apps must follow (hard-won)

- styles.css preamble identical to existing apps (`min-height:600px` ×4,
  `html.ui-hidden #app-root` collapse rule); chrome from `.tta-*` classes only —
  per-app CSS is positioning/typography with `var(--token, fallback)`; area-analytics
  styles.css is the reference. Any wrapper introducing `min-height` needs a
  `html.ui-hidden` collapse rule.
- `import "maplibre-gl/dist/maplibre-gl.css"` in each app.ts; keep unpkg in CSP.
- Hooks registered before `await app.connect()`; guard viz payload shape after
  `extractFullData` → `showErrorUI("Visualization data expired — re-run the tool")`
  **before** `showMapUI()`.
- Guarded `window.__e2e_ml = map.mapLibreMap` right after map creation.
- Apps render the raw pre-SQL data (request params drive visuals, not SQL results)
  — by design.
- App `new App({ name })`: `tta-traffic-flow`, `tta-junction-live`,
  `tta-route-details`.

## Testing & verification

- **Unit:** handler tests per tool (default stores viz + `_meta`, `show_ui:false`
  skips, store-throw degrades, error paths don't store; junction-live-data:
  fetch-forced geometry + SQL strip when user didn't ask, both toggles covered);
  tool tests assert `registerAppTool` + resource URI wiring (and single resource
  registration per shared app); `speed-colors` unit tests. Keep coverage green
  (`src/apps/**` excluded except node-testable modules run uncounted).
- **E2E (live, key-gated), added to `e2e/apps.spec.ts`:** (1) flow segment app —
  stat card populated + segment layer present + `__e2e_ml`; (2) junction search —
  pins + sidebar rows (or graceful empty state); (3) junction live — take first
  junction id from search result, assert approach cards + colored approach layer
  (skip if account has no junctions); (4) route search — route lines + rows (or
  empty state); (5) route details — first route id → segment table + per-segment
  layer + row↔map highlight smoke. All harness URLs use `127.0.0.1`.
- **UI harness:** update `ui/src/index.tsx` `EXAMPLE_INPUTS` for the five tools
  (add `show_ui: true`; junction/route ids left as placeholders resolved by the
  user at runtime, as today).
- **Visual:** build + `npm run ui` + throwaway Playwright screenshots to
  `.superpowers/sdd/screenshots/` (script not committed); screenshots must be
  read before claiming done.
- **Gates:** `npm run lint`, `npm test`, `npm run build`, `npm run build:mcpb`
  (PowerShell only), token metrics, `npm run test:e2e` with live keys.

## Out of scope

- `tomtom-junction-archive` app (no geometry).
- Re-optimizing the pre-existing incidents/area token budget drift.
- Refactoring the two shipped apps.
