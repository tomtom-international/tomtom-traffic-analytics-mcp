# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

The package manager is **pnpm** (`>=11`); linting and formatting are handled by **Biome**
(`biome.json`). Do not use `npm`/`yarn` — the repo has no `package-lock.json`.

| Task | Command |
|------|---------|
| Install | `pnpm install` |
| Build | `pnpm run build` |
| Dev (no build) | `pnpm run dev` |
| Unit tests + coverage | `pnpm test` |
| Single test file | `pnpm exec vitest src/path/to/file.test.ts` |
| Single test by name | `pnpm exec vitest -t "test name pattern"` |
| Watch mode | `pnpm run test:watch` |
| Integration tests | `pnpm run test:comprehensive` (requires API keys in `.env`) |
| All tests | `pnpm run test:all` |
| Token metrics only | `node tests/test-comprehensive.js --metrics-only` |
| Type check | `pnpm type-check` |
| Lint | `pnpm lint` |
| Lint fix | `pnpm lint:fix` |
| Format check | `pnpm format` |
| Format fix | `pnpm format:fix` |
| Clean | `pnpm run clean` |
| Build MCPB bundle | `pnpm run build:mcpb` (per-platform; built natively) |
| Verify MCPB bundle | `pnpm run verify:mcpb` |

## Architecture

This is an MCP (Model Context Protocol) server that exposes TomTom traffic APIs as tools for LLM assistants. It filters API responses by evaluating caller-supplied JavaScript in a QuickJS WASM sandbox, with turf and h3 available for geospatial work.

### 4-Layer Pattern

Every tool follows: **Tool → Handler → Service → Query Engine**

1. **Tools** (`src/tools/*.ts`) — Register tools via `server.registerTool(name, { description, inputSchema: zodSchema }, handler)`. Grouped by domain: `liveTraffic`, `areaAnalytics`, `junctionAnalytics`, `routeMonitoring`.

2. **Handlers** (`src/handlers/*.ts`) — Orchestrate the flow: validate `js_queries` → call service → flatten response → init the sandbox → execute queries → return filtered results. Always close `JsQueryEngine` in a `finally` block.

3. **Services** (`src/services/*/`) — HTTP calls to TomTom APIs via two Axios clients in `src/services/base/tomtomClient.ts`: `trafficAPIClient` (uses `TOMTOM_API_KEY`) and `movePortalAPIClient` (uses `TOMTOM_MOVE_PORTAL_KEY`).

4. **Query Layer** (`src/query/`) — `JsQueryEngine` creates a QuickJS WASM sandbox, marshals the flattened datasets into it once, and evaluates user-provided JavaScript against them.
   - **Flatteners** (`src/query/flatteners/`) convert nested API JSON → flat arrays of objects
   - **Vendor** (`src/query/vendor/`) holds turf and h3 as base64 IIFE bundles, injected into the sandbox on demand; regenerate with `node scripts/build-sandbox-libs.mjs`
   - Dataset shapes are derived from the data at runtime, so there are no table definitions to maintain

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
- Schema `.describe()` strings = datasets, fields, examples (single source of truth)
- Measure with: `node tests/test-comprehensive.js --metrics-only`
- Test files assert on description text — update tests when changing descriptions

### js_queries Is Mandatory
Every tool requires a `js_queries` parameter (record of named JavaScript queries). This prevents dumping full API responses into LLM context. Handlers validate its presence before proceeding.

A query is a single expression, or a statement block ending in `return`. The engine decides which by compiling the expression form first and falling back to the statement form — never by pattern-matching the source, because a `return` inside a string literal fools any such heuristic.

### Multi-Area Comparison
The traffic incidents handler supports multiple named bounding boxes. It fetches areas in parallel, flattens each with an `area_name` field, merges them into one dataset, and enables cross-area queries.

### Schemas Export Pattern
Zod schemas are exported as plain objects (not wrapped in `z.object()`). The tool registration wraps them: `server.registerTool(name, { description, inputSchema: zodSchemaObject }, handler)`.

## Environment Variables

Configured via `.env` (see `.env.example`):
- `TOMTOM_MOVE_PORTAL_KEY` — Required for most tools (Move Portal APIs)
- `TOMTOM_API_KEY` — Required for live traffic tools (public Traffic API)

## Testing Notes

- Unit tests: 20 files in `src/**/*.test.ts`, vitest globals enabled (no imports needed for `describe`/`it`/`expect`)
- Mocks must be set up BEFORE importing the module under test (`vi.mock()` is hoisted, but direct assignments like `console.error = vi.fn()` are not)
- Service tests mock `trafficAPIClient`/`movePortalAPIClient` and `logger`
- The sandbox has its own suites: `src/query/jsQueryEngine.test.ts` (behaviour) and `jsQueryEngine.security.test.ts` (isolation and resource limits)
- Tool tests mock handler modules and verify `server.registerTool()` was called with correct names/schemas
- Integration tests (`tests/test-comprehensive.js`) hit real APIs — need `.env` keys

## Build

`pnpm run build` runs TypeScript declarations (`tsc --emitDeclarationOnly`) then Rolldown bundling (ESM + CJS, `rolldown.config.js`). Rolldown resolves node modules, CJS interop, JSON and TypeScript natively, so there is no plugin chain apart from `rollup-plugin-license`, which emits `dist/THIRD_PARTY.txt`. The QuickJS WASM module and the turf/h3 bundles are inlined into `dist/`, so the output is self-contained with no native binding and no side files.
