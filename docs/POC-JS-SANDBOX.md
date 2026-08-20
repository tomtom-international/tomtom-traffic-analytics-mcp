# POC: replacing the SQL engine with a sandboxed JavaScript one

**Branch:** `poc/js-sandbox-query` (based on `chore/deps-rolldown-ts6`)
**Status:** complete and working — 268 unit tests pass, 6 of the 8 tools are verified against
the live APIs (the remaining two need an API key this environment does not have), `pnpm run
build` produces a self-contained bundle, and the MCPB bundle builds and verifies end to end.

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
| Engine dependency on disk | 114 MB (`@duckdb/*`, 112 MB of it the darwin-arm64 binding) | 3.1 MB (`@jitl/quickjs-*`) |
| `node_modules` total | 346 MB | 259 MB |
| Native module | yes, one per platform | none |
| Runtime download on first use | 58 MB spatial extension, from the internet, into `~/.duckdb` | none |
| Bundled into `dist/` | no — external, loaded from `node_modules` | yes — WASM, turf and h3 all inlined |
| `dist/index.esm.js` | 1.27 MB + an external native `require` | 3.14 MB, self-contained |
| `.mcpb` bundle (darwin-arm64) | 76.5 MB | 42.8 MB |

`build-mcpb.cjs` no longer needs a native runner to resolve a per-platform binding, and
its `assertDuckDbBindingStaged` check is gone. `verify-mcpb.cjs` now instantiates the
sandbox instead of probing the binding. The bundle is still per-platform, but for one
reason only: the Node runtime it embeds.

The 33.7 MB the bundle loses (−44%) is the staged native binding, net of the ~1.9 MB of WASM,
turf and h3 now inlined into `dist/`. The 58 MB spatial extension is a separate saving, and a
larger one in practice: `main` loads that extension on *every* `initialize()` — cached here,
but cold it is an internet download inside a request.

### Runtime — 57,600 rows (2 days × 20 junctions of archive data), three equivalent queries

Both engines were measured under the same harness, on the same deterministically generated
data, in the same session, with both scripts run under `tsx`; median of 3 runs.

| | DuckDB | QuickJS |
|---|---|---|
| Create engine + load data | 107.5 ms | 404.5 ms |
| 3 queries (hourly group-by, per-junction ranking, p50/p95) | 10.0 ms | 82.9 ms |
| **Total per request** | **117.8 ms** | **487.4 ms** |
| A follow-up query on the same loaded data | 4.6 ms | 16.6 ms |
| Process RSS | 154 MB | 202 MB |

Identical results from both — not merely the same shape (24 hourly buckets, 20 ranked
junctions) but the same values to 16 significant digits: `p50` `58.550265607680316` and
`p95` `114.1371059949217` from either engine.

QuickJS is **~4.1× slower end to end** on this workload. Three things bound how much that
matters:

- **Marshalling dominates, and it is paid once per engine.** The load step is 404 ms of the
  487 ms, and the engine's own debug log attributes nearly all of it to JSON crossing the
  WASM boundary rather than to query execution. A persistent session would make every query
  after the first roughly free — the same argument applies to DuckDB, but the gap is much
  larger for the sandbox.
- **Since measured, and since reduced.** Staging the transfer shows the cost is almost
  entirely the guest: on the 19.5 MB payload, host `JSON.stringify` is 37 ms, the copy into
  WASM 293 ms, and the guest-side `JSON.parse` 707 ms. Sending less is therefore the only
  lever that matters, and the engine now marshals only the datasets a query names — measured
  on live data, `tomtom-junction-archive` fell from 11,006 KB / 224 ms to 3,723 KB / 74 ms
  (3.0x), because two thirds of that payload is `turn_ratios` that a delay query never reads.
  The figures in the table above predate that change and are the pessimistic case.
- **This synthetic payload is close to worst case.** Its full-precision random doubles
  inflate the JSON well beyond real API data. Measured against live responses: 5 KB → 1 ms,
  48 KB → 2 ms, 283 KB → 5 ms, and the largest real payload (junction archive, 56,353 rows,
  11 MB) marshals in **216 ms** — about half the synthetic figure at a comparable row count,
  because it is about half the bytes.
- **It is still ~400 ms in front of every request.** The TomTom API call it hides behind took
  90–1,600 ms in the integration runs, so it is usually the smaller term — but it is not
  free, and calling it immaterial would overstate the case.

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

### End-to-end verification — real APIs and the MCPB bundle

Both were listed as not done in the first draft of this document. Both have since been run.

`pnpm run test:comprehensive` against the live TomTom APIs, with the same `.env` keys used to
run `origin/main` in a parallel worktree:

| Tool | SQL (`main`) | JS (this branch) |
|---|---|---|
| `tomtom-junction-search` | PASS `junctions:2` | PASS `junctions:2` |
| `tomtom-route-search` | PASS `routes:1` | PASS `routes:1` |
| `tomtom-area-analytics-stats` | PASS `timed_data:51, tiled_data:242` | PASS (same) |
| `tomtom-junction-live-data` | PASS `approaches:5, turn_ratios:15, stops_histogram:15` | PASS (same) |
| `tomtom-junction-archive` | PASS `approaches:14400, turn_ratios:41953` | PASS (same) |
| `tomtom-route-monitoring-details` | PASS `route_info:1, segments:1056` | PASS (same) |
| `tomtom-traffic-flow-segment` | FAIL — HTTP 403 | FAIL — HTTP 403 |
| `tomtom-traffic-incidents` | FAIL — HTTP 403 | FAIL — HTTP 403 |

6 of 8 on both engines, and every flattener that ran produced identical row counts on both.
The two failures are the two tools backed by the public Traffic API (`TOMTOM_API_KEY`), and
they fail the same way on `main`: the key available here lacks permission for those endpoints.
Not a regression on this branch, and not something this branch can fix.

`pnpm run test:http` exercises the HTTP transport with per-request API keys: 9 of 11, the same
two 403s.

`pnpm run build:mcpb` and `pnpm run verify:mcpb` both succeed. Verification unpacks the
bundle, confirms the launcher and embedded Node runtime are executable, evaluates JavaScript
in the sandbox, and completes an MCP handshake listing all 8 tools.

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

- **Two tools never exercised against a real response.** `tomtom-traffic-flow-segment` and
  `tomtom-traffic-incidents` need a `TOMTOM_API_KEY` carrying public Traffic API permissions;
  the key available here returns 403 for both, on this branch and on `main` alike. Their
  flatteners have unit coverage, but no live payload has been through them.
- **No accuracy evaluation.** The open question is whether an LLM writes correct JS against
  these datasets as reliably as it writes SQL. That needs a query-level eval over real
  tasks, and it is the thing that should decide this, not the packaging win.
- **Persistent sessions are opt-in, and worth less than the follow-up number suggests.**
  `TOMTOM_MCP_SANDBOX_REUSE=1` pools loaded sandboxes, keyed by the caller's credentials and a
  content hash of the data, which takes a repeated junction-archive query from 75 ms to 18 ms.
  It stays off by default for two reasons. The pool is keyed by the *data*, so the TomTom call
  still happens every time — against a ~1150 ms archive request, 58 ms is about 5%, and the
  real benefit is server CPU under concurrency rather than latency. And a reused sandbox is a
  weaker guarantee than a fresh one: globals a query created are deleted before pooling, but
  mutation of the guest's own built-ins is not undone, for the next caller holding the same
  credentials and the same bytes. Skipping the *fetch* is where the remaining latency is, and
  that is a staleness decision about traffic data rather than a tuning one.

## Trying it

```bash
git checkout poc/js-sandbox-query
pnpm install
pnpm test                 # 268 tests, including 16 sandbox-isolation tests
pnpm run build            # one self-contained 3.1 MB bundle, no native module
node tests/test-comprehensive.js --metrics-only

pnpm run test:comprehensive                  # needs .env keys; 6/8 without Traffic API access
pnpm run test:http                           # HTTP transport, per-request keys; 9/11
pnpm run build:mcpb && pnpm run verify:mcpb  # 42.8 MB bundle, verified end to end
```
