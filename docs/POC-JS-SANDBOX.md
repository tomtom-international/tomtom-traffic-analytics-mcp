# POC: replacing the SQL engine with a sandboxed JavaScript one

**Branch:** `poc/js-sandbox-query` (based on `chore/deps-rolldown-ts6`)
**Status:** complete and working — 268 unit tests pass, the server starts and registers all
8 tools, `pnpm run build` produces a self-contained bundle.

Every analytical tool used to take a `sql_queries` parameter and run it through an
in-memory DuckDB instance. It now takes `js_queries`: caller-supplied JavaScript evaluated
inside a QuickJS WASM sandbox, with [turf](https://turfjs.org) and [h3](https://h3geo.org)
injected on demand.

---

## What was actually swapped

| Before | After |
|---|---|
| `src/sql/sqlFilterEngine.ts` (456 lines) — DuckDB instance per request | `src/query/jsQueryEngine.ts` (421 lines) — QuickJS context per request |
| `src/sql/schemas/` (745 lines, 8 files) — `TableDefinition[]` per tool | *gone* — dataset shapes are derived from the data at runtime |
| `sql_queries: Record<string, string>` (DuckDB SELECT) | `js_queries: Record<string, string>` (JS expression or statement block) |
| `{ columns, rows, rowCount }` per result | `{ value, rowCount?, truncated? }`, or `{ error }` |
| `metadata.raw_row_counts` | `metadata.dataset_shapes` — row counts **and** field names |
| 18 regexes + DuckDB lockdown settings | no blocklist; nothing is bridged into the guest |
| `geom_geojson` TEXT + lazy `GEOMETRY` column | `geom` — a live GeoJSON object turf reads directly |
| `events`, `roadNumbers` as JSON strings | live arrays |

The flatteners survived unchanged apart from those field changes, and moved to
`src/query/flatteners/`.

---

## Measurements

All figures measured on this machine (darwin-arm64), not estimated.

### Packaging — the clearest win

| | DuckDB | QuickJS |
|---|---|---|
| Engine dependency on disk | 112 MB (`@duckdb/node-bindings-darwin-arm64`) | 3.0 MB (`@jitl/quickjs-singlefile-cjs-release-sync`) |
| Native module | yes, one per platform | none |
| Runtime download on first use | 58 MB spatial extension, from the internet, into `~/.duckdb` | none |
| Bundled into `dist/` | no — external, loaded from `node_modules` | yes — WASM, turf and h3 all inlined |
| `dist/index.esm.js` | — | 3.1 MB, self-contained |

`build-mcpb.cjs` no longer needs a native runner to resolve a per-platform binding, and
its `assertDuckDbBindingStaged` check is gone. `verify-mcpb.cjs` now instantiates the
sandbox instead of probing the binding. The bundle is still per-platform, but for one
reason only: the Node runtime it embeds.

### Runtime — 57,600 rows (2 days × 20 junctions of archive data), three equivalent queries

| | DuckDB | QuickJS |
|---|---|---|
| Create engine + load data | 218 ms | 305 ms |
| 3 queries (hourly group-by, per-junction ranking, p50/p95) | 17 ms | 82 ms |
| **Total per request** | **235 ms** | **387 ms** |
| A follow-up query on the same loaded data | — | 4 ms |
| Process RSS | 158 MB | 201 MB |

Identical results from both (24 hourly buckets, 20 ranked junctions). QuickJS is ~1.6×
slower end to end, which is immaterial next to the TomTom API call that precedes it.

Note the 4 ms follow-up: marshalling dominates, and it is paid once per engine. A
persistent session would make every query after the first roughly free — the same
argument applies to DuckDB, but the gap is much larger for the sandbox.

Library injection is lazy, triggered by a `turf.` / `h3.` reference in the query source:
turf costs ~100 ms to evaluate, h3 ~75 ms, and purely tabular queries pay neither.

### Token cost — the clearest regression

Measured with `node tests/test-comprehensive.js --metrics-only`:

| | SQL | JS | Δ |
|---|---|---|---|
| All 8 tools, wire cost | 6,999 tokens | 7,777 tokens | **+778 (+11%)** |

JS examples are simply wordier than the SQL ones: `Object.entries(Object.groupBy(...))`
costs more than `GROUP BY`. The one tool that got *cheaper* is `tomtom-traffic-incidents`
(1,232 → 1,106), because `events` and `geom` no longer need `json_extract_string` and
`ST_GeomFromGeoJSON` explained. Every tool still fits the under-1,000-token budget except
`tomtom-area-analytics-stats` (1,531), which was already over it at 1,385.

---

## Two bugs the new tests caught

Both are in the "would have shipped and hurt" category, and both are fixed on the branch.

**1. Guest recursion could kill the server process.** QuickJS raises its own `stack
overflow` only when its configured stack cap is hit. Above roughly 256 KB, deep guest
recursion exhausts the *host's* WASM stack first, and that surfaces as an uncatchable
`RangeError: Maximum call stack size exceeded` which takes the process down — no error
result, no other queries, no server. Measured: 256 KB traps cleanly; 384 KB, 1 MB, 4 MB and
the library default all crash the host. `MAX_STACK_SIZE_BYTES` is 256 KB, with the
reasoning recorded next to it. The cost is a guest recursion depth of ~1,500 frames.

**2. Deciding expression-vs-statement by regex silently returned nothing.** The first
implementation looked for `return` in the query source to decide whether to wrap it as an
expression. A query like `['return me'].join('')` contains that word inside a string
literal, so it was run as a statement block and quietly produced `null` — a wrong answer
with no error. The engine now offers the expression form to the parser first and falls
back to the statement form on `SyntaxError`. Defining a function only compiles it, so the
fallback costs a parse and never an execution.

---

## Security model

The old surface was a deny-list — 18 regexes plus `enable_external_access=false`,
`disabled_filesystems`, `lock_configuration=true` — and every DuckDB release was a chance
for it to fall behind.

The sandbox is deny-by-default: the guest runs on a separate WASM heap and the host
bridges *nothing* into it. `process`, `require`, `import`, `fetch`, `XMLHttpRequest`,
`WebAssembly`, `setTimeout` and `Worker` are all absent rather than blocked. This matters
here specifically because `src/indexHttp.ts` accepts per-request API keys: a leak of
`process.env` would be a cross-tenant credential leak.

`src/query/jsQueryEngine.security.test.ts` asserts it, including the Function-constructor
escape (`(function(){}).constructor('return typeof process')()` → `"undefined"`), host
prototype pollution, state leaking between engines, and the resource limits: a `while
(true) {}` is interrupted at 5 s and the engine stays usable afterwards.

Caps: 5 s wall-clock per query, 512 MB heap, 256 KB stack, 10,000 array elements and 1 MB
of JSON per result.

---

## What got better, beyond packaging

- **Geospatial without the 58 MB extension.** turf reads `geom` directly:
  `turf.length(i.geom, { units: 'kilometers' })`, `turf.booleanIntersects(...)`,
  `turf.distance(turf.centroid(i.geom), [4.9, 52.37])`. Verified end to end from a real
  flattener payload.
- **h3 hex-binning, which had no SQL equivalent at all** —
  `Object.groupBy(tiled_data, t => h3.latLngToCell(t.lat, t.lon, 8))`.
- **Percentiles, previously `quantile_cont`, are now three lines of JS** and work the same
  way on any field.
- **No table definitions to maintain.** 745 lines of `TableDefinition[]` deleted. Field
  names come from the data, and are returned in `metadata.dataset_shapes` so a model that
  guesses a field wrong can fix it without re-fetching from the API.
- **Nested data stays nested.** `events` is an array of objects, not a JSON string.

## What got worse

- **+11% tool description tokens** (above).
- **Silent-wrong is easier.** SQL rejects an unknown column; JS gives you `undefined`,
  then `NaN`, then a plausible-looking average. The engine names unknown identifiers
  (`'segments' is not defined`) but cannot catch a typo'd *field*.
- **No query planner.** Every query is a linear scan. Irrelevant at 57k rows, and it would
  matter well before DuckDB did if the data ever grew.
- **1 MB of vendored base64** in `src/query/vendor/`, regenerated by
  `node scripts/build-sandbox-libs.mjs`. Checked in so rolldown inlines it and the server
  never reads it from disk.
- **JS is a bigger contract than SQL.** Whether models write correct JS against these
  datasets as reliably as they write SQL is the one question this POC cannot answer from
  the inside — see below.

---

## Not done

- **No real-API run.** `pnpm run test:comprehensive` and `test:http` were both updated for
  the new envelope, but need `TOMTOM_MOVE_PORTAL_KEY` / `TOMTOM_API_KEY` to execute. Only
  the `--metrics-only` path was exercised here.
- **No MCPB bundle built or verified.** The scripts were updated, not run.
- **No accuracy evaluation.** The open question is whether an LLM writes correct JS against
  these datasets as reliably as it writes SQL. That needs a query-level eval over real
  tasks, and it is the thing that should decide this, not the packaging win.
- **No persistent session.** Every request still builds and tears down its own engine. The
  4 ms follow-up number suggests this is where the next win is, and it is orthogonal to
  the language choice.

## Trying it

```bash
git checkout poc/js-sandbox-query
pnpm install
pnpm test                 # 268 tests, including 16 sandbox-isolation tests
pnpm run build            # one self-contained 3.1 MB bundle, no native module
node tests/test-comprehensive.js --metrics-only
```
