# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

| Task | Command |
|------|---------|
| Build | `npm run build` |
| Build apps only | `npm run build:apps` (Vite single-file bundles → `dist/apps`; also runs as part of `npm run build`) |
| Dev (no build) | `npm run dev` |
| Local app host | `npm run ui` (ext-apps-capable React host at `localhost:8080` + MCP HTTP server; needs `.env`) |
| Unit tests + coverage | `npm test` |
| Single test file | `npx vitest src/path/to/file.test.ts` |
| Single test by name | `npx vitest -t "test name pattern"` |
| Watch mode | `npm run test:watch` |
| Integration tests | `npm run test:comprehensive` (requires API keys in `.env`) |
| E2E tests (MCP Apps) | `npm run test:e2e` (Playwright; run `npm run test:e2e:setup` once first; auto-skips without API keys) |
| E2E debug mode | `npm run test:e2e:debug` |
| All tests | `npm run test:all` |
| Token metrics only | `node tests/test-comprehensive.js --metrics-only` |
| Lint | `npm run lint` |
| Lint fix | `npm run lint:fix` |
| Format | `npm run format` |
| Clean | `npm run clean` |

## Architecture

This is an MCP (Model Context Protocol) server that exposes TomTom traffic APIs as tools for LLM assistants. It uses DuckDB for in-memory SQL filtering of API responses.

### 4-Layer Pattern

Every tool follows: **Tool → Handler → Service → SQL Engine**

1. **Tools** (`src/tools/*.ts`) — Register tools via `server.registerTool(name, { description, inputSchema: zodSchema }, handler)`. Grouped by domain: `liveTraffic`, `areaAnalytics`, `junctionAnalytics`, `routeMonitoring`.

2. **Handlers** (`src/handlers/*.ts`) — Orchestrate the flow: validate `sql_queries` → call service → flatten response → init SQL engine → execute queries → return filtered results. Always close `SqlFilterEngine` in a `finally` block.

3. **Services** (`src/services/*/`) — HTTP calls to TomTom APIs via two Axios clients in `src/services/base/tomtomClient.ts`: `trafficAPIClient` (uses `TOMTOM_API_KEY`) and `movePortalAPIClient` (uses `TOMTOM_MOVE_PORTAL_KEY`).

4. **SQL Layer** (`src/sql/`) — `SqlFilterEngine` creates an in-memory DuckDB instance, loads flattened data into tables, and executes user-provided SQL queries.
   - **Flatteners** (`src/sql/flatteners/`) convert nested API JSON → flat relational rows
   - **Schemas** (`src/sql/schemas/`) define table structures (`TableDefinition[]`)

### Apps Layer (`src/apps/`)

Seven tools (`tomtom-traffic-incidents`, `tomtom-traffic-flow-segment`, `tomtom-area-analytics-stats`, `tomtom-junction-search`, `tomtom-junction-live-data`, `tomtom-route-search`, `tomtom-route-monitoring-details`) are registered via `registerAppTool` (from `@modelcontextprotocol/ext-apps/server`) instead of plain `server.registerTool`, and bind a `ui://` resource so ext-apps-capable hosts render an interactive map. Five apps back them under `src/apps/traffic-analytics/<app-name>/` (junction-search + junction-live-data share `junction-live`; route-search + route-monitoring-details share `route-details`). Resource URIs are derived from the app name by `registerTrafficAnalyticsApp` (`src/tools/helpers/resourceRegistry.ts`) — never hand-write a `ui://` string. Handler responses add `_meta: { show_ui, viz_id }` via `buildVizMeta` (`src/handlers/helpers/vizMeta.ts`); the app fetches the full raw payload from the app-only tool `tomtom-get-viz-data` (5-minute in-memory cache bounded to 50 entries, `src/services/cache/vizCache.ts`) and the TomTom API key from `tomtom-get-api-key` (`src/tools/appTools.ts`) — both hidden from the LLM via `_meta.ui.visibility: ["app"]`. Each app is a renderer plugged into `bootstrapVizApp` (`src/apps/shared/app-bootstrap.ts`), which owns the tool-result parse, show_ui/API-key/payload gates, standard error states, and lazy map creation. Other cross-app helpers live in `src/apps/shared/` (dom, format, geo, collections, chart-layout, feature-state, speed-colors, viz-data, map controls). **`src/apps/**` is excluded from `tsc` (built separately by Vite via `npm run build:apps`) and from vitest coverage** — but `*.test.ts` files under `src/apps/` still run as part of `npm test`.

### Server Initialization

`src/index.ts` → `src/createServer.ts` → calls `registerTools()` which invokes each domain's `create*Tools()` function.

### Tool Registration Signature

```typescript
server.registerTool(name, { description, inputSchema: zodSchema }, handler)
```

Wire cost = tool name + description + serialized JSON Schema (from Zod `.describe()` strings). All 8 core tools fit under 1,000 tokens each after optimization.

## Key Conventions

### Token Cost Optimization
- Tool descriptions = brief purpose + constraints only
- Schema `.describe()` strings = tables, columns, examples (single source of truth)
- Measure with: `node tests/test-comprehensive.js --metrics-only`
- Test files assert on description text — update tests when changing descriptions

### sql_queries Is Mandatory
Every tool requires a `sql_queries` parameter (record of named SQL queries). This prevents dumping full API responses into LLM context. Handlers validate its presence before proceeding.

### Multi-Area Comparison
The traffic incidents handler supports multiple named bounding boxes. It fetches areas in parallel, flattens each with an `area_name` column, merges into one database, and enables cross-area SQL queries.

### Schemas Export Pattern
Zod schemas are exported as plain objects (not wrapped in `z.object()`). The tool registration wraps them: `server.registerTool(name, { description, inputSchema: zodSchemaObject }, handler)`.

## Environment Variables

Configured via `.env` (see `.env.example`):
- `TOMTOM_MOVE_PORTAL_KEY` — Required for most tools (Move Portal APIs)
- `TOMTOM_API_KEY` — Required for live traffic tools (public Traffic API), and also required for the map apps to render tiles (including for `tomtom-area-analytics-stats`, whose data comes via `TOMTOM_MOVE_PORTAL_KEY`). Missing it degrades the app to an in-app "map unavailable" state; text/SQL results are unaffected.

## Testing Notes

- Unit tests: 20 files in `src/**/*.test.ts`, vitest globals enabled (no imports needed for `describe`/`it`/`expect`)
- Mocks must be set up BEFORE importing the module under test (`vi.mock()` is hoisted, but direct assignments like `console.error = vi.fn()` are not)
- Service tests mock `trafficAPIClient`/`movePortalAPIClient` and `logger`
- Tool tests mock handler modules and verify `server.registerTool()` was called with correct names/schemas
- Integration tests (`tests/test-comprehensive.js`) hit real APIs — need `.env` keys
- E2E tests (`e2e/`, Playwright) drive the two MCP Apps end-to-end via the local `npm run ui` host; `e2e/fixtures/servers.ts` skips the whole suite gracefully when `TOMTOM_API_KEY` / `TOMTOM_MOVE_PORTAL_KEY` are unset. Run `npm run test:e2e:setup` once (builds + installs the Chromium browser) before `npm run test:e2e`

## Build

`npm run build` runs TypeScript declarations (`tsc --emitDeclarationOnly`) then Rollup bundling (ESM + CJS). Rollup circular dependency warnings from `zod-to-json-schema` are expected and harmless.
