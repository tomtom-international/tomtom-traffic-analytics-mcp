# Route Monitoring Tools Guide

This guide covers the two route monitoring tools in the TomTom Traffic Analytics MCP server. Use them together: **search** first to discover route IDs, then **details** for segment-level analysis.

Both tools require the `TOMTOM_MOVE_PORTAL_KEY` environment variable and are queried with JavaScript, evaluated in a QuickJS sandbox.

---

## tomtom-route-search

Fetches **all** monitored routes and loads them into the sandbox for JavaScript filtering.

**API endpoint:** `GET /routemonitoring/3/routes`

### Input

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `js_queries` | `Record<string, string>` | Yes | Object with named JavaScript queries. Keys = output names, values = JS source strings (an expression, or statements ending in `return`). At least 1 query required. |

**Example call:**

```json
{
  "js_queries": {
    "delayed_routes": "routes.filter(r => r.delay_time > 60).sort((a, b) => b.delay_time - a.delay_time)",
    "status_summary": "Object.entries(Object.groupBy(routes, r => r.route_status)).map(([route_status, rows]) => ({ route_status, cnt: rows.length }))"
  }
}
```

### Available Dataset: `routes`

| Field | Type | Description |
|-------|------|-------------|
| `route_id` | INTEGER | Unique route identifier |
| `route_name` | TEXT | Name of the route |
| `route_status` | TEXT | `NEW`, `ACTIVE`, `UPDATING`, `FAILED`, or `ARCHIVED` |
| `travel_time` | REAL | Current travel time (seconds) |
| `typical_travel_time` | REAL | Normal-conditions travel time (seconds) |
| `delay_time` | REAL | `travel_time - typical_travel_time` (seconds) |
| `passable` | INTEGER | `1` = passable, `0` = impassable, `NULL` = unknown |
| `route_length` | REAL | Total route length (meters) |
| `completeness` | REAL | Data completeness (0-1) |
| `typical_travel_time_coverage` | REAL | Coverage of typical travel time data |

### Example Queries

```js
// Find routes by name
routes.filter(r => r.route_name.toLowerCase().includes('a10'))
  .map(r => ({ route_id: r.route_id, route_name: r.route_name }))

// Routes with delays over 60 seconds
routes.filter(r => r.delay_time > 60).sort((a, b) => b.delay_time - a.delay_time)

// Status breakdown
Object.entries(Object.groupBy(routes, r => r.route_status))
  .map(([route_status, rows]) => ({ route_status, cnt: rows.length }))

// Active routes with delay percentage
routes
  .filter(r => r.route_status === 'ACTIVE' && r.delay_time > 0)
  .map(r => ({
    route_id: r.route_id,
    route_name: r.route_name,
    delay_pct: r.travel_time ? +(r.delay_time * 100 / r.travel_time).toFixed(1) : null,
  }))
  .sort((a, b) => b.delay_pct - a.delay_pct)
```

### Response Structure

```json
{
  "metadata": {
    "tool": "tomtom-route-search",
    "parameters": {
      "totalRoutes": 42
    },
    "dataset_shapes": { "routes": { "rows": 42, "fields": ["route_id", "route_name", "route_status"] } },
    "queries_executed": 2,
    "warnings": []
  },
  "aggregated_data": {
    "delayed_routes": {
      "value": [{ "route_id": 123, "route_name": "A10 North", "delay_time": 180 }],
      "rowCount": 1
    },
    "status_summary": {
      "value": [{ "route_status": "ACTIVE", "cnt": 38 }],
      "rowCount": 1
    }
  }
}
```

- **`metadata`** -- total routes fetched from API, dataset shapes (row counts and field names), query count
- **`aggregated_data`** -- results keyed by your query names from `js_queries`. Each is `{ value, rowCount?, truncated? }`, or `{ error }` if that one query failed

---

## tomtom-route-monitoring-details

Gets **segment-level traffic analysis** for specific routes. Supports **multi-route comparison** -- data from all requested routes is merged into the same datasets.

**API endpoint:** `GET /routemonitoring/3/routes/{routeId}/details` (called in parallel for each route)

### Input

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `routeIds` | `string[]` | Yes | Route IDs to query. Min 1, max 20. Data is merged for cross-route comparisons. |
| `js_queries` | `Record<string, string>` | Yes | Named JavaScript queries. At least 1 required. |

**Example call:**

```json
{
  "routeIds": ["123", "456"],
  "js_queries": {
    "slow_segments": "segments.filter(s => s.current_speed < s.typical_speed * 0.5)",
    "route_summary": "route_info.map(r => ({ route_name: r.route_name, travel_time: r.travel_time, delay_time: r.delay_time }))"
  }
}
```

### Available Datasets

#### Dataset 1: `route_info` (1 row per route)

| Field | Type | Description |
|-------|------|-------------|
| `route_id` | INTEGER | Unique route identifier |
| `route_name` | TEXT | Name of the route |
| `route_status` | TEXT | `NEW`, `ACTIVE`, `UPDATING`, `FAILED`, `ARCHIVED` |
| `travel_time` | REAL | Current travel time (seconds) |
| `typical_travel_time` | REAL | Normal-conditions travel time (seconds) |
| `delay_time` | REAL | `travel_time - typical_travel_time` (seconds) |
| `passable` | INTEGER | `1` = passable, `0` = impassable |
| `route_length` | REAL | Route length (meters) |
| `completeness` | REAL | Data completeness (0-1) |
| `typical_travel_time_coverage` | REAL | Typical travel time data coverage |
| `route_confidence` | REAL | Confidence level (0-1) |

#### Dataset 2: `segments` (N rows per route)

| Field | Type | Description |
|-------|------|-------------|
| `route_id` | INTEGER | Foreign key to `route_info` |
| `segment_id` | BIGINT | Segment identifier |
| `segment_id_str` | TEXT | String form of segment ID |
| `average_speed` | REAL | Average speed (km/h) |
| `typical_speed` | REAL | Typical speed (km/h) |
| `segment_length` | REAL | Segment length (meters) |
| `open_lr_id` | TEXT | OpenLR identifier |
| `current_speed` | REAL | Current speed (km/h) |
| `relative_speed` | REAL | Relative speed percentage |
| `confidence` | REAL | Confidence level (0-1) |
| `open_lr_length` | REAL | OpenLR length (meters) |

### Example Queries

**Single-route analysis:**

```js
// Slow segments (below 50% of typical speed)
segments
  .filter(s => s.current_speed < s.typical_speed * 0.5)
  .map(s => ({ ...s, speed_diff: s.typical_speed - s.current_speed }))
  .sort((a, b) => b.speed_diff - a.speed_diff)

// Route summary
route_info.map(r => ({
  route_name: r.route_name,
  travel_time: r.travel_time,
  delay_time: r.delay_time,
  confidence: +r.route_confidence.toFixed(2),
}))

// Low confidence segments
segments.filter(s => s.confidence < 0.5).sort((a, b) => a.confidence - b.confidence)
```

**Multi-route comparison:**

```js
// Compare routes by delay percentage
route_info
  .map(r => ({
    route_id: r.route_id,
    route_name: r.route_name,
    delay_pct: r.travel_time ? +(r.delay_time * 100 / r.travel_time).toFixed(1) : null,
  }))
  .sort((a, b) => b.delay_pct - a.delay_pct)

// Route performance ranking
[...route_info]
  .sort((a, b) => b.route_confidence - a.route_confidence)
  .map(r => ({ route_id: r.route_id, confidence: +r.route_confidence.toFixed(2), completeness: r.completeness }))

// Join route info with segment statistics — a lookup, not a JOIN
route_info.map(r => {
  const own = segments.filter(s => s.route_id === r.route_id);
  return {
    route_name: r.route_name,
    delay_time: r.delay_time,
    segment_count: own.length,
    avg_confidence: own.length
      ? +(own.reduce((sum, s) => sum + s.confidence, 0) / own.length).toFixed(2)
      : null,
  };
})
```

### Response Structure

```json
{
  "metadata": {
    "tool": "tomtom-route-monitoring-details",
    "parameters": {
      "routeIds": ["123", "456"],
      "routeCount": 2
    },
    "dataset_shapes": { "route_info": { "rows": 2, "fields": ["route_id", "route_name"] }, "segments": { "rows": 84, "fields": ["segment_id", "current_speed"] } },
    "queries_executed": 2,
    "warnings": []
  },
  "aggregated_data": {
    "slow_segments": {
      "value": [{ "segment_id": 98765, "current_speed": 12.5, "typical_speed": 55.0 }],
      "rowCount": 1
    },
    "route_summary": {
      "value": [{ "route_name": "A10 North", "travel_time": 1200, "delay_time": 180 }],
      "rowCount": 1
    }
  }
}
```

---

## Typical 2-Step Workflow

```
Step 1: tomtom-route-search
   js_queries: {
     "find": "routes.filter(r => r.route_name.toLowerCase().includes('a10')).map(r => ({ route_id: r.route_id, route_name: r.route_name }))"
   }
   --> Returns route_id: 123, 456

Step 2: tomtom-route-monitoring-details
   routeIds: ["123", "456"]
   js_queries: {
     "analysis": "route_info.map(r => { const own = segments.filter(s => s.route_id === r.route_id); return { route_name: r.route_name, delay_time: r.delay_time, segments: own.length, avg_speed: own.length ? +(own.reduce((sum, s) => sum + s.current_speed, 0) / own.length).toFixed(1) : null }; })"
   }
   --> Returns segment-level analysis for both routes
```

---

## Key Implementation Files

| Layer | File |
|-------|------|
| Tool registration | `src/tools/routeMonitoring.ts` |
| Handlers | `src/handlers/routeMonitoringHandler.ts` |
| Service (API calls) | `src/services/route-monitoring/routeMonitoringService.ts` |
| Types | `src/services/route-monitoring/types.ts` |
| Input schemas | `src/schemas/route-monitoring/routeMonitoringSchema.ts` |
| Flatteners | `src/query/flatteners/routeListFlattener.ts`, `src/query/flatteners/routeMonitoringFlattener.ts` |
| Query engine | `src/query/jsQueryEngine.ts` |
