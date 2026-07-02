# MCP Apps for Traffic Analytics Tools — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
> **At execution start:** copy this plan to `docs/superpowers/plans/2026-07-03-mcp-apps-traffic-tools.md` in the repo and commit it as the first commit on the feature branch.

**Goal:** Add production MCP apps (interactive map UIs rendered in Claude/ext-apps hosts) to the TomTom Traffic Analytics MCP server — shared infrastructure plus two flagship apps (`traffic-incidents`, `area-analytics`) — using the latest TomTom Maps SDK (0.49.1) with maximum reuse of native SDK modules and parsers, then open a PR.

**Architecture:** Replicate the proven pattern from the sibling repo `C:\Users\prietofe\workspace\tomtom-mcp` (reference implementation), upgraded to current libraries: tools bind a `ui://` HTML resource via `registerAppTool` + `RESOURCE_URI_META_KEY`; handlers cache the raw pre-SQL API payload in an in-memory viz cache and embed `_meta: { show_ui, viz_id }` in the JSON text response; the sandboxed app fetches the API key and full data back through app-only tools (`tomtom-get-api-key`, `tomtom-get-viz-data`) over the ext-apps JSON-RPC bridge; apps are vanilla-TS single-file HTML bundles built by Vite + `vite-plugin-singlefile` into `dist/apps/`.

**Tech Stack:** `@modelcontextprotocol/ext-apps` ^1.7.4, `@modelcontextprotocol/sdk` ^1.29.0, `@tomtom-org/maps-sdk` ^0.49.1 (devDep — apps ship prebuilt), `node-cache` ^5.1.2, Vite 7 + `vite-plugin-singlefile`, vitest, Playwright + React 19 UI test host (ported from sibling).

## Context

The traffic-analytics MCP (v0.2.1, 8 tools) returns SQL-filtered text only. Traffic data is intensely spatial; MCP Apps became an official MCP extension in Jan 2026 and the sibling tomtom-mcp already ships map apps. Exploration confirmed:
- Rich geometry exists at handler level **before** SQL flattening (incidents GeoJSON per named bbox; area-analytics FeatureCollection with polygon + tile grid) but is dropped by the SQL schemas — apps must consume the raw handler payloads via a viz cache.
- The Maps SDK 0.49.1 has purpose-built native modules: `TrafficIncidentOverlayModule` (renders a fetched incidents FeatureCollection, `setFocus()` highlighting) and `TrafficAreaAnalyticsModule` (hexgrid-3d/2d, square, heatmap; `setMetric/setMode/filter`; region boundary). Its response parsers are importable: `customizeService.trafficIncidentDetails.parseTrafficIncidentDetailsResponse` and `customizeService.trafficAreaAnalytics.parseTrafficAreaAnalyticsResponse` (verified in `maps-sdk-js/services/src/customize/index.ts` and both `customize.ts` files).
- The MCP's raw incidents response (`TrafficIncidentsResult`, `src/services/live-traffic/types.ts:200`) is a byte-for-byte match for the SDK parser input; its `DEFAULT_FIELDS` covers every field the parser reads. Zero hand-rolled conversion for incidents.
- One schema discrepancy: the SDK parser reads `features[].properties.baseData` (unguarded — throws if absent); the MCP's hand-written type declares `timedData.all` and no `baseData` (`src/services/area-analytics/types.ts:97`). The SDK's types are integration-tested against the live API (June 2026), so the MCP type is likely stale; a small shim covers both shapes.
- ext-apps 1.2.2 → 1.7.4 has **no breaking changes** to `registerAppTool`/`registerAppResource`/`App`; 1.7 adds handshake-ordering guards (register `ontoolinput`/`ontoolresult`/`onteardown` **before** `await app.connect()`) and types tool-level `_meta.ui.csp` as `never` (CSP must be on the resource).

User decisions: **this PR = infra + traffic-incidents + area-analytics apps + UI host/Playwright E2E harness; branch off `main`; PR to `main`.** Remaining apps (flow, junction, route) are documented fast-follows reusing the same infra.

## Global Constraints

- Branch: `feat/mcp-apps-traffic-tools` off `origin/main`. Use an isolated worktree (superpowers:using-git-worktrees) — the current checkout has uncommitted work on `fix/rdp-1612-hardening-followup`.
- Versions (exact floors): `@modelcontextprotocol/ext-apps` `^1.7.4`, `@modelcontextprotocol/sdk` `^1.29.0` (bump from `^1.26.0`), `@tomtom-org/maps-sdk` `^0.49.1`, `node-cache` `^5.1.2`, `vite` `^7.3.1`, `vite-plugin-singlefile` `^2.3.0`.
- **stdio hygiene:** nothing loaded by the stdio entry point may write to stdout (breaks MCP framing). New server-side modules log via `src/utils/logger.ts` only. `scripts/build-apps.ts` is build-time only — console is fine there.
- **Never expose the Move Portal key to apps.** `tomtom-get-api-key` returns `getEffectiveApiKey()` (`TOMTOM_API_KEY`) only — apps need it solely for basemap tiles.
- App resource CSP: `connectDomains: ["https://api.tomtom.com", "https://*.api.tomtom.com", "blob:"]`, `resourceDomains: ["https://api.tomtom.com", "https://*.api.tomtom.com", "blob:", "data:"]` (no unpkg — everything is bundled).
- Vite app builds must use `build.target: "esnext"` (MapLibre v5 native class fields break in workers otherwise).
- App lifecycle hooks registered **before** `app.connect()` (ext-apps 1.7 guard).
- `src/apps/**` excluded from server tsc, rollup, and vitest coverage. Coverage thresholds must stay green.
- Zod schemas remain plain exported objects (repo convention, NOT wrapped in `z.object()`).
- Resource URIs: `ui://tomtom-traffic-analytics/<app>/app.html`. Apps live in `src/apps/traffic-analytics/<app>/` with shared code in `src/apps/shared/`.
- Reference implementations to port from: `C:\Users\prietofe\workspace\tomtom-mcp` (read-only source; adapt, don't symlink).
- Commit after every task (conventional commits). End commit messages with `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.

## File Structure (delta)

```
package.json                      [edit]  deps + build:apps script + sdk bump
tsconfig.json                     [edit]  exclude src/apps
vitest.config.ts                  [edit]  coverage exclude src/apps/** (keep src/apps/shared/geo* covered via include? No — exclude all, geo tests still RUN, just uncounted)
scripts/build-apps.ts             [new]   Vite programmatic single-file builds
scripts/build-mcpb.cjs            [edit]  copy dist/apps into MCPB staging
src/createServer.ts               [edit]  + createAppTools(server)
src/sql/types.ts                  [edit]  SqlFilteredResponse._meta?
src/services/cache/vizCache.ts    [new]   + vizCache.test.ts
src/tools/appTools.ts             [new]   + appTools.test.ts
src/tools/helpers/resourceRegistry.ts [new] + resourceRegistry.test.ts
src/tools/liveTraffic.ts          [edit]  incidents → registerAppTool
src/tools/areaAnalytics.ts        [edit]  → registerAppTool
src/schemas/live-traffic/liveTrafficSchema.ts   [edit] + show_ui on incidents
src/schemas/area-analytics/areaAnalyticsSchema.ts [edit] + show_ui
src/handlers/liveTrafficHandler.ts [edit]  viz payload + _meta (incidents handler)
src/handlers/areaAnalyticsHandler.ts [edit] viz payload + _meta
src/apps/tsconfig.json            [new]   DOM lib config for app code
src/apps/shared/{api-key,sdk-config,viz-data,ui-visibility,map-controls,geo}.ts + ui-visibility.css + geo.test.ts + __fixtures__/  [new]
src/apps/traffic-analytics/traffic-incidents/{app.html,app.ts,styles.css} [new]
src/apps/traffic-analytics/area-analytics/{app.html,app.ts,styles.css}   [new]
ui/                               [new]   React MCP host test client (port from sibling)
e2e/                              [new]   Playwright specs + fixtures
playwright.config.ts              [new]
README.md, docs/                  [edit]  apps section, show_ui, TOMTOM_API_KEY note
```

---

### Task 0: Branch + plan commit

**Files:** none (git only)

- [ ] **Step 1:** Create isolated worktree/branch off main (superpowers:using-git-worktrees): `git fetch origin && git worktree add ../tta-mcp-apps -b feat/mcp-apps-traffic-tools origin/main` (or EnterWorktree). All subsequent work happens there.
- [ ] **Step 2:** Copy this plan to `docs/superpowers/plans/2026-07-03-mcp-apps-traffic-tools.md`, commit: `docs: add MCP apps implementation plan`.

### Task 1: Dependencies + config plumbing

**Files:** Modify `package.json`, `tsconfig.json`, `vitest.config.ts`. Create `src/apps/tsconfig.json`.

**Interfaces — Produces:** `npm run build:apps` script slot (script added in Task 5); `src/apps` excluded from server toolchain.

- [ ] **Step 1:** Install: `npm i @modelcontextprotocol/ext-apps@^1.7.4 node-cache@^5.1.2 && npm i -D @tomtom-org/maps-sdk@^0.49.1 maplibre-gl vite@^7 vite-plugin-singlefile@^2.3 @types/geojson && npm i @modelcontextprotocol/sdk@^1.29.0`
  (Check `npm view @tomtom-org/maps-sdk peerDependencies` and install any missing peers — expected `maplibre-gl`; add `@turf/turf`/`lodash-es` only if npm warns.)
- [ ] **Step 2:** `tsconfig.json`: add `"src/apps/**"` to `exclude`. Create `src/apps/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.json",
  "compilerOptions": {
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "moduleResolution": "bundler",
    "noEmit": true,
    "rootDir": ".",
    "paths": { "@shared/*": ["./shared/*"] }
  },
  "include": ["./**/*.ts"],
  "exclude": []
}
```

- [ ] **Step 3:** `vitest.config.ts`: add `"src/apps/**"` to `coverage.exclude` (app DOM code is E2E-tested; node-testable converters still run as tests, just uncounted).
- [ ] **Step 4:** Run `npm test` and `npm run build`. Expected: all existing tests pass, build green — this gates the MCP SDK ^1.29 bump. If `registerTool` typings break, fix call sites (signature unchanged 1.26→1.29; zod v4 supported).
- [ ] **Step 5:** Commit: `chore: add ext-apps, maps-sdk, vite deps; bump MCP SDK to 1.29`

### Task 2: vizCache

**Files:** Create `src/services/cache/vizCache.ts`, `src/services/cache/vizCache.test.ts`.
Reference: `C:\Users\prietofe\workspace\tomtom-mcp\src\services\cache\vizCache.ts` (port near-verbatim; swap console logging for `src/utils/logger.ts`).

**Interfaces — Produces:** `storeVizData(data: unknown): string` (returns `viz_id` UUID), `getVizData(vizId: string): unknown | undefined`, `deleteVizData(vizId: string): void`, `clearVizCache(): void`, `getCacheStats()`. Module-level singleton `node-cache` `{ stdTTL: 300, checkperiod: 60, useClones: false }`.

- [ ] **Step 1:** Write failing tests (store/get roundtrip; unknown id → undefined; delete; TTL expiry with `vi.useFakeTimers()` — note node-cache checks lazily on get, so advance time past 300s and assert undefined; two stores → distinct ids).
- [ ] **Step 2:** `npx vitest src/services/cache/vizCache.test.ts` → FAIL (module missing).
- [ ] **Step 3:** Implement:

```ts
import NodeCache from "node-cache";
import { randomUUID } from "node:crypto";
import { logger } from "../../utils/logger";

const vizCache = new NodeCache({ stdTTL: 300, checkperiod: 60, useClones: false });

export function storeVizData(data: unknown): string {
  const vizId = randomUUID();
  vizCache.set(vizId, data);
  logger.debug(`vizCache: stored ${vizId}`);
  return vizId;
}
export function getVizData(vizId: string): unknown | undefined { return vizCache.get(vizId); }
export function deleteVizData(vizId: string): void { vizCache.del(vizId); }
export function clearVizCache(): void { vizCache.flushAll(); }
export function getCacheStats() { return vizCache.getStats(); }
```

(Match the reference file's exact API if it differs — e.g. async signatures; keep sync unless reference is async and callers await.)
- [ ] **Step 4:** Tests pass. **Step 5:** Commit: `feat(apps): add viz data cache`

### Task 3: App-only tools + createServer wiring

**Files:** Create `src/tools/appTools.ts`, `src/tools/appTools.test.ts`. Modify `src/createServer.ts` (call `createAppTools(server)` inside `registerTools`), `src/createServer.test.ts`.
Reference: `C:\Users\prietofe\workspace\tomtom-mcp\src\tools\appTools.ts`.

**Interfaces — Consumes:** `getVizData` (Task 2), `getEffectiveApiKey` from `src/services/base/tomtomClient.ts`.
**Produces:** `createAppTools(server: McpServer): void` registering `tomtom-get-api-key` and `tomtom-get-viz-data` via `registerAppTool` with `_meta: { ui: { visibility: ["app"] } }`.

- [ ] **Step 1:** Failing tests: mock `@modelcontextprotocol/ext-apps/server` (`registerAppTool: vi.fn()`), `../services/cache/vizCache`, `../services/base/tomtomClient`. Assert: 2 registrations; both `_meta.ui.visibility` = `["app"]`; `tomtom-get-api-key` handler returns `{content:[{type:"text",text:"<key>"}]}` when `getEffectiveApiKey` returns a key and `isError: true` result when it returns undefined; `tomtom-get-viz-data` handler returns cached JSON for known id and `isError` for unknown; **the Move key is never touched** (assert `getEffectiveMovePortalKey` not called).
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement (shape mirrors reference; `tomtom-get-viz-data` inputSchema `{ viz_id: z.string() }`). **Step 4:** Pass.
- [ ] **Step 5:** Wire `createAppTools(server)` into `registerTools()` in `src/createServer.ts`; update `createServer.test.ts` expected tool count/mocks. Run full suite → pass.
- [ ] **Step 6:** Commit: `feat(apps): add app-only tools (get-api-key, get-viz-data)`

### Task 4: resourceRegistry

**Files:** Create `src/tools/helpers/resourceRegistry.ts`, `src/tools/helpers/resourceRegistry.test.ts`.
Reference: `C:\Users\prietofe\workspace\tomtom-mcp\src\tools\helpers\resourceRegistry.ts` — with two deliberate deviations: **synchronous** registration (no async wrapper) and **module-level `Map<string,string>` HTML memoization** (this server builds a new McpServer per HTTP request; avoid per-request disk reads).

**Interfaces — Produces:** `registerAppResourceFromPath(server: McpServer, resourceUri: string, category: string, appName: string): void`. Reads `path.resolve(<module dir>, "./apps", category, appName, "app.html")` at `resources/read` time; returns contents with `mimeType: RESOURCE_MIME_TYPE` and `_meta.ui.csp` per Global Constraints; fallback HTML ("Run npm run build:apps") when file missing.

- [ ] **Step 1:** Failing tests: mock `node:fs/promises` and ext-apps server. Assert `registerAppResource` called with the URI and `RESOURCE_MIME_TYPE`; invoking the read callback returns HTML text + exact CSP domain lists (snapshot); second invocation does NOT re-read fs (memoized — `readFile` called once); missing file → fallback HTML, no throw.
- [ ] **Step 2:** FAIL. **Step 3:** Implement (CJS/ESM note: derive base dir from `import.meta.url` like the reference; rollup shims it for the CJS bundle — verified in Task 11's packaging assertions). **Step 4:** Pass. **Step 5:** Commit: `feat(apps): add app resource registry with CSP`

### Task 5: App build pipeline + placeholder apps

**Files:** Create `scripts/build-apps.ts`, `src/apps/traffic-analytics/traffic-incidents/app.html` (placeholder), `src/apps/traffic-analytics/area-analytics/app.html` (placeholder). Modify `package.json` scripts.
Reference: `C:\Users\prietofe\workspace\tomtom-mcp\scripts\build-apps.ts`.

- [ ] **Step 1:** Port the build script: discover `src/apps/traffic-analytics/*/app.html`; for each, programmatic `vite build` with `plugins: [viteSingleFile()]`, `root: appDir`, `resolve.alias: { "@shared": <abs src/apps/shared> }`, `build: { target: "esnext", outDir: <abs dist/apps/traffic-analytics/<name>>, emptyOutDir: true, minify: "esbuild" }`, concurrency 2. Run via `tsx` (already a devDep): `"build:apps": "tsx scripts/build-apps.ts"`, and `"build": "npm run build:ts && npm run build:rollup && npm run build:apps"`.
- [ ] **Step 2:** Placeholder `app.html` per app: minimal shell `<div id="sdk-map"></div><div id="panel"></div><script type="module" src="./app.ts"></script>` + empty `app.ts` + `styles.css` (real code lands in Tasks 8/10).
- [ ] **Step 3:** Run `npm run build:apps`. Expected: `dist/apps/traffic-analytics/{traffic-incidents,area-analytics}/app.html` exist, single-file (grep: no `src=`/`href=` pointing outside data:/inline).
- [ ] **Step 4:** Commit: `build: add Vite single-file app build pipeline`

### Task 6: Shared app utilities + fixtures

**Files:** Create `src/apps/shared/api-key.ts`, `sdk-config.ts`, `viz-data.ts`, `ui-visibility.ts`, `ui-visibility.css`, `map-controls.ts`, `geo.ts`, `geo.test.ts`, `__fixtures__/area-analytics-response.json`, `__fixtures__/incidents-response.json`.
References: `C:\Users\prietofe\workspace\tomtom-mcp\src\apps\shared\{api-key,sdk-config,decompress,ui-visibility,map-controls}.ts` (rename `decompress.ts` → `viz-data.ts`, drop the deprecated pako `_compressed` path).

**Interfaces — Produces (used by both apps):**
- `getAPIKey(app: App): Promise<string>` — calls `tomtom-get-api-key`, caches.
- `ensureTomTomConfigured(app: App): Promise<boolean>` — `TomTomConfig.instance.put({ apiKey })`; false → app shows "map unavailable" state.
- `extractFullData(app: App, agentResponse: { _meta?: { viz_id?: string } }): Promise<unknown>` — `tomtom-get-viz-data` + localStorage LRU (20 entries, `tta-viz-` prefix) fallback to trimmed response.
- `shouldShowUI(resp: { _meta?: { show_ui?: boolean } }): boolean`; `showMapUI() / hideMapUI() / showErrorUI(msg)`.
- `createMapControls(map: TomTomMap, opts)` — style selector (`standardStyleIDs`) + optional traffic-flow toggle.
- `geo.ts`: `withBaseData(raw)` — the area-analytics shim:

```ts
export function withBaseData(raw: any) {
  return { ...raw, features: (raw.features ?? []).map((f: any, i: number) => ({
    ...f,
    id: f.id ?? `region-${i}`,
    properties: { ...f.properties,
      baseData: f.properties?.baseData ?? f.properties?.timedData?.all ?? {} },
  })) };
}
```

Plus `bboxUnion(bboxes: [number,number,number,number][]): [number,number,number,number]`.

- [ ] **Step 1 (fixtures):** Capture a real `/areaanalytics/reports/lite` response (keys in `.env`; smallest polygon, 3-day range) and one `tomtom-traffic-incidents` raw result; sanitize and save to `__fixtures__/`. **Record whether `baseData` is present** — this settles the V0 question. If no live keys available, construct fixtures from the SDK's own test data (`maps-sdk-js/services/src/traffic-area-analytics/tests/responseParser.data.ts`) in BOTH variants (with `baseData`, and with only `timedData.all`).
- [ ] **Step 2:** Failing tests `geo.test.ts` (node-safe, no DOM): `withBaseData` passes through when `baseData` present; synthesizes from `timedData.all` when absent; result parses cleanly via `customizeService.trafficAreaAnalytics.parseTrafficAreaAnalyticsResponse` (import from `@tomtom-org/maps-sdk/services`) against both fixture variants; incidents fixture parses via `parseTrafficIncidentDetailsResponse` and yields features with string ids. `bboxUnion` on two boxes.
- [ ] **Step 3:** FAIL → implement `geo.ts` → PASS.
- [ ] **Step 4:** Port the remaining shared modules (browser code, no unit tests — exercised by E2E). Keep them dependency-light; hooks/`App` types from `@modelcontextprotocol/ext-apps`.
- [ ] **Step 5:** Commit: `feat(apps): shared app utilities, SDK parser shim, fixtures`

### Task 7: traffic-incidents vertical (schema + handler + tool)

**Files:** Modify `src/schemas/live-traffic/liveTrafficSchema.ts`, `src/handlers/liveTrafficHandler.ts`, `src/tools/liveTraffic.ts`, `src/sql/types.ts`, and their tests.

**Interfaces — Consumes:** `storeVizData` (Task 2), `registerAppResourceFromPath` (Task 4).
**Produces:** viz payload `{ tool: "tomtom-traffic-incidents", areas: Array<{ name: string, bbox: string, incidents: TrafficIncidentsResult }> }`; response `_meta: { show_ui: boolean, viz_id?: string }` inside the JSON text.

- [ ] **Step 1:** `src/sql/types.ts`: add `_meta?: { show_ui: boolean; viz_id?: string }` to the SQL-filtered response type.
- [ ] **Step 2:** Schema: add to `trafficIncidentsSchema`: `show_ui: z.boolean().optional().describe("Render the interactive incidents map app (default true). Set false for text-only analysis.")`. Update schema test if it asserts key lists.
- [ ] **Step 3:** Failing handler tests (follow existing `liveTrafficHandler.test.ts` mock style; add `vi.mock` for `../services/cache/vizCache`):
  - default (`show_ui` undefined) → `storeVizData` called once with `{tool, areas:[{name, bbox, incidents}]}` matching the mocked raw fetches; response JSON `_meta` = `{show_ui:true, viz_id:"<mock>"}`
  - `show_ui: false` → `storeVizData` NOT called; `_meta` = `{show_ui:false}`
  - `storeVizData` throws → response still succeeds with `_meta:{show_ui:false}` (non-fatal, logged)
  - error paths (invalid sql etc.) → no `storeVizData`.
- [ ] **Step 4:** FAIL → implement in `createTrafficIncidentsHandler` after successful SQL execution, building `areas` from the per-bbox `rawResults` already present (~line 178). Wrap `storeVizData` in try/catch. → PASS.
- [ ] **Step 5:** Failing tool tests: mock `@modelcontextprotocol/ext-apps/server` and `./helpers/resourceRegistry`; assert incidents tool now registered via `registerAppTool` with `_meta[RESOURCE_URI_META_KEY] === "ui://tomtom-traffic-analytics/traffic-incidents/app.html"` and `registerAppResourceFromPath(server, uri, "traffic-analytics", "traffic-incidents")` called; flow-segment tool untouched (`server.registerTool`).
- [ ] **Step 6:** FAIL → implement in `src/tools/liveTraffic.ts` → PASS. Full suite green.
- [ ] **Step 7:** Commit: `feat(incidents): bind incidents tool to MCP app, cache raw viz payload`

### Task 8: traffic-incidents app

**Files:** Replace placeholders in `src/apps/traffic-analytics/traffic-incidents/{app.html,app.ts,styles.css}`.

**Interfaces — Consumes:** shared utils (Task 6), viz payload shape (Task 7), SDK: `TrafficIncidentOverlayModule`, `TomTomMap`, `bboxFromGeoJSON`, `customizeService.trafficIncidentDetails.parseTrafficIncidentDetailsResponse`.

- [ ] **Step 1:** `app.html`: map div + side panel (`#incident-list`) + hidden state divs; `html,body,#sdk-map` explicit height per SDK boilerplate.
- [ ] **Step 2:** `app.ts` core flow (register hooks BEFORE connect):

```ts
import { App } from "@modelcontextprotocol/ext-apps";
import { TomTomMap, TrafficIncidentOverlayModule } from "@tomtom-org/maps-sdk/map";
import { customizeService } from "@tomtom-org/maps-sdk/services";
import { ensureTomTomConfigured } from "@shared/sdk-config";
import { extractFullData } from "@shared/viz-data";
import { shouldShowUI, showMapUI, hideMapUI, showErrorUI } from "@shared/ui-visibility";

const { parseTrafficIncidentDetailsResponse } = customizeService.trafficIncidentDetails;
const app = new App({ name: "tta-traffic-incidents", version: "1.0.0" });
let map: TomTomMap | undefined; let overlay: TrafficIncidentOverlayModule | undefined;

app.ontoolresult = async (result) => {
  const parsedResp = JSON.parse((result.content?.[0] as any)?.text ?? "{}");
  if (!shouldShowUI(parsedResp)) { hideMapUI(); return; }
  if (!(await ensureTomTomConfigured(app))) { showErrorUI("TOMTOM_API_KEY not configured — map unavailable"); return; }
  const viz = (await extractFullData(app, parsedResp)) as VizPayload;
  showMapUI();
  map ??= new TomTomMap({ style: "standardLight", mapLibre: { container: "sdk-map", center: [0, 0], zoom: 2 } });
  overlay ??= await TrafficIncidentOverlayModule.get(map);
  const perArea = viz.areas.map(a => ({ name: a.name, parsed: parseTrafficIncidentDetailsResponse(a.incidents as any) }));
  const features = perArea.flatMap(({ name, parsed }) =>
    parsed.features.map(f => ({ ...f, properties: { ...f.properties, areaName: name } })));
  const merged = { type: "FeatureCollection" as const, features };
  await overlay.show(merged as any);
  fitToFeatures(map, merged); renderIncidentList(merged, overlay, map);
};
app.onteardown = async () => { overlay?.setVisible(false); return {}; };
await app.connect();
```

Plus: `renderIncidentList` (grouped by `areaName`; each row: category, magnitude badge, delay, from→to; click → `overlay.setFocus([id])` + `map.mapLibreMap.flyTo`), `overlay.events.on("click")` → focus + detail card, area filter chips re-`show()`ing a filtered collection, `fitToFeatures` via `bboxFromGeoJSON`.
- [ ] **Step 3:** `npm run build:apps` → builds clean; open `dist/.../app.html` in a browser (no host) → shows graceful "waiting for tool result" state, no console errors.
- [ ] **Step 4:** Commit: `feat(incidents): interactive incidents map app`

### Task 9: area-analytics vertical (schema + handler + tool)

**Files:** Modify `src/schemas/area-analytics/areaAnalyticsSchema.ts`, `src/handlers/areaAnalyticsHandler.ts`, `src/tools/areaAnalytics.ts`, and tests. Same pattern as Task 7 — repeat, not reference:

- [ ] **Step 1:** Schema: add `show_ui: z.boolean().optional().describe("Render the interactive area analytics map app (default true). Set false for text-only analysis.")` to `areaAnalyticsStatsSchema`.
- [ ] **Step 2:** Failing handler tests (mock vizCache): default → `storeVizData({ tool: "tomtom-area-analytics-stats", request: { name, startDate, endDate, dataTypes, hours, frcs }, report: rawResult })` and `_meta:{show_ui:true, viz_id}`; `show_ui:false` → no store; store-throw → degrade to `{show_ui:false}`; error paths unaffected.
- [ ] **Step 3:** Implement in `areaAnalyticsHandler` (raw `rawResult` at ~line 57) → PASS.
- [ ] **Step 4:** Failing tool tests → `registerAppTool` with `_meta[RESOURCE_URI_META_KEY] === "ui://tomtom-traffic-analytics/area-analytics/app.html"` + `registerAppResourceFromPath(server, uri, "traffic-analytics", "area-analytics")` → implement → PASS.
- [ ] **Step 5:** Commit: `feat(area): bind area-analytics tool to MCP app, cache raw report`

### Task 10: area-analytics app

**Files:** Replace placeholders in `src/apps/traffic-analytics/area-analytics/{app.html,app.ts,styles.css}`.

**Interfaces — Consumes:** `TrafficAreaAnalyticsModule`, `withBaseData` + `parseTrafficAreaAnalyticsResponse`, shared utils; viz payload from Task 9.

- [ ] **Step 1:** `app.html`: map + control bar (mode `<select>`: hexgrid-3d/hexgrid-2d/square-3d/square-2d/heatmap; metric `<select>`; min/max range inputs) + legend div + collapsible time-series panel.
- [ ] **Step 2:** `app.ts` (same lifecycle skeleton as Task 8):

```ts
import { TrafficAreaAnalyticsModule, TomTomMap } from "@tomtom-org/maps-sdk/map";
import { bboxFromGeoJSON } from "@tomtom-org/maps-sdk/core";
import { customizeService } from "@tomtom-org/maps-sdk/services";
import { withBaseData } from "@shared/geo";
const { parseTrafficAreaAnalyticsResponse } = customizeService.trafficAreaAnalytics;

// in ontoolresult after extractFullData:
const analytics = parseTrafficAreaAnalyticsResponse(withBaseData(viz.report));
const module = await TrafficAreaAnalyticsModule.get(map, {
  displayMode: "hexgrid-3d", activeMetric: pickDefaultMetric(analytics),
});
await module.show(analytics);
map.mapLibreMap.fitBounds(bboxFromGeoJSON(analytics as any), { padding: 40, pitch: 45 });
```

Controls wire directly to native methods: mode select → `module.setMode(v)`, metric select (options = metrics present in `analytics.properties`) → `module.setMetric(v)`, range inputs → `module.filter({min, max})` / `module.clearFilter()`; hover → `module.events.on("hover", ...)` tooltip with per-tile metrics; legend rendered from the active metric's color stops; time-series panel = inline SVG bars over `features[0].properties.timedData.daily ?? hourly` for the active metric (no chart library — keeps the single-file bundle lean).
- [ ] **Step 3:** `npm run build:apps` clean; standalone open shows waiting state.
- [ ] **Step 4:** Commit: `feat(area): interactive area analytics map app (hexgrid/heatmap)`

### Task 11: Packaging — MCPB + npm

**Files:** Modify `scripts/build-mcpb.cjs`.

- [ ] **Step 1:** After the dist-copy step (~line 180), add a guarded recursive copy of `dist/apps` → `<staging>/app/apps` (so `resourceRegistry`'s module-relative `./apps` resolves next to `app/index.cjs.js`); extend the pre-check to warn when `dist/apps` is missing.
- [ ] **Step 2:** Verify `npm run build && npm run build:mcpb` succeeds and the bundle contains `app/apps/traffic-analytics/*/app.html`.
- [ ] **Step 3:** CJS `import.meta.url` check: `node -e "const s=require('./dist/index.cjs.js'); ..."` — simpler: run the built stdio server (`node bin/tomtom-traffic-analytics-mcp.js`) with an MCP inspector `resources/read` of the incidents URI; expect real HTML, not the fallback.
- [ ] **Step 4:** `npm pack --dry-run` → output includes `dist/apps/traffic-analytics/traffic-incidents/app.html` and `.../area-analytics/app.html`.
- [ ] **Step 5:** Commit: `build(mcpb): ship dist/apps in MCPB bundle`

### Task 12: UI test host + Playwright E2E

**Files:** Create `ui/` (port of `C:\Users\prietofe\workspace\tomtom-mcp\ui\` — React 19 host, sandbox iframe server with per-request CSP), `e2e/{fixtures/servers.ts, apps.spec.ts}`, `playwright.config.ts`. Modify `package.json` (scripts `ui`, `ui:build`, `test:e2e`, `test:e2e:setup`; devDeps `@playwright/test`, `concurrently`, ui workspace deps).

- [ ] **Step 1:** Port `ui/` adjusting: server command → this repo's `dist/indexHttp.esm.js`; `/api/config` exposes BOTH keys as headers (`tomtom-api-key`, `tomtom-move-portal-key`) from `.env`; branding strings. Keep the double-iframe sandbox + `buildCspHeader` from resource `_meta.ui.csp` as-is.
- [ ] **Step 2:** `npm run ui` → host at localhost:8080 lists the server's tools; invoking `tomtom-traffic-incidents` with a small bbox + trivial `sql_queries` renders the incidents app iframe with map.
- [ ] **Step 3:** Playwright config + fixtures (port `e2e/fixtures/servers.ts`; skip all when `TOMTOM_API_KEY`/`TOMTOM_MOVE_PORTAL_KEY` unset). Specs:
  - `apps.spec.ts` / incidents: run tool → expect app iframe visible, incident list rows > 0 (or graceful empty state), `window.__e2e_ml` map exists (expose in `map-controls.ts` like reference).
  - area-analytics: run tool with 3-day range ending ≥3 days ago → expect mode selector present, module rendered (assert a maplibre layer id from the module via `__e2e_ml.getStyle().layers`).
  - `show_ui:false` → no iframe, text-only.
- [ ] **Step 4:** `npm run test:e2e` green locally (documented as key-gated; CI wiring optional follow-up).
- [ ] **Step 5:** Commit: `test(e2e): UI host + Playwright coverage for MCP apps`

### Task 13: Docs

**Files:** Modify `README.md`; add devportal page under `C:\Users\prietofe\workspace\devportal-documentation\documentation\tomtom-traffic-analytics-mcp\documentation\` only if that repo's process applies (otherwise note as follow-up in PR description).

- [ ] **Step 1:** README: "Interactive Map Apps" section — which tools have apps, host requirements (ext-apps-capable hosts), `show_ui` param, **`TOMTOM_API_KEY` now required for map rendering even for Move-only tools** (graceful degradation otherwise), `npm run ui` harness, `npm run build:apps`.
- [ ] **Step 2:** Update `.claude/CLAUDE.md` build/test tables (`build:apps`, `ui`, `test:e2e`).
- [ ] **Step 3:** Commit: `docs: document MCP apps, show_ui, and UI harness`

### Task 14: Final verification + PR

- [ ] **Step 1:** Full gate: `npm run lint && npm test && npm run build && npm run build:apps && npm run build:mcpb && npm pack --dry-run`. Token metrics guard: `node tests/test-comprehensive.js --metrics-only` — confirm the `show_ui` description keeps both tools under the 1,000-token budget.
- [ ] **Step 2:** superpowers:verification-before-completion + /verify: drive one real tool call end-to-end through the UI host with live keys; screenshot both apps.
- [ ] **Step 3:** Push branch; `gh pr create --base main --title "feat: MCP apps for traffic tools (incidents + area analytics)"` — body: motivation, architecture summary, screenshots, the Move-key security decision, fast-follow list (flow/junction/route apps, junction-archive chart), and the ext-apps 1.7.4 / maps-sdk 0.49.1 currency note. End body with the Claude Code attribution footer.

## Verification (end-to-end)

1. `npm test` — full unit suite + coverage green (apps excluded from coverage).
2. `npm run build` — tsc + rollup + Vite apps; `dist/apps/traffic-analytics/{traffic-incidents,area-analytics}/app.html` single-file.
3. MCP inspector (`npm run inspector`) against stdio build: `tools/list` shows `show_ui` in both schemas; `resources/read ui://tomtom-traffic-analytics/traffic-incidents/app.html` returns HTML with `text/html;profile=mcp-app` + CSP `_meta`.
4. `npm run ui` + live keys: invoke both tools, apps render, `show_ui:false` suppresses UI; app fetches key + viz data via app-only tools (visible in host log).
5. `npm run test:e2e` (key-gated Playwright) green.
6. MCPB bundle installs in Claude Desktop and renders the incidents app (manual smoke).

## Risks (acknowledged)

- **`baseData` vs `timedData.all`** — settled by the Task 6 fixture capture; `withBaseData` shim covers both shapes regardless.
- **MCP SDK ^1.29 bump** — gated by Task 1 full-suite run before any feature work.
- **`import.meta.url` in CJS bundle** for resource paths — explicitly asserted in Task 11 Step 3.
- **~1.4 MB per app** added to npm/MCPB (~3 MB total for 2 apps) — accepted; maplibre dominates.
- **HTTP-mode session keys for app tool-calls** — `tomtom-get-api-key` must resolve the caller's header key through `runWithSessionContext`; covered by Task 12 harness which sends header keys.
