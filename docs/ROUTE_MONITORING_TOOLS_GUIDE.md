# Route Monitoring Tools Guide

This guide covers the two route monitoring tools in the TomTom Traffic Analytics MCP server. Use them together: **search** first to discover route IDs, then **details** for segment-level analysis.

Both tools require the `TOMTOM_MOVE_PORTAL_KEY` environment variable and use DuckDB (PostgreSQL-compatible) SQL dialect.

---

## tomtom-route-search

Fetches **all** monitored routes and loads them into an in-memory database for SQL filtering.

**API endpoint:** `GET /routemonitoring/3/routes`

### Input

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `sql_queries` | `Record<string, string>` | Yes | Object with named SQL queries. Keys = output names, values = DuckDB SQL strings. At least 1 query required. |

**Example call:**

```json
{
  "sql_queries": {
    "delayed_routes": "SELECT route_id, route_name, delay_time FROM routes WHERE delay_time > 60 ORDER BY delay_time DESC",
    "status_summary": "SELECT route_status, COUNT(*) as cnt FROM routes GROUP BY route_status"
  }
}
```

### Available Table: `routes`

| Column | Type | Description |
|--------|------|-------------|
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

### Example SQL Queries

```sql
-- Find routes by name
SELECT route_id, route_name FROM routes WHERE route_name ILIKE '%A10%'

-- Routes with delays over 60 seconds
SELECT route_id, route_name, delay_time FROM routes
WHERE delay_time > 60 ORDER BY delay_time DESC

-- Status breakdown
SELECT route_status, COUNT(*) as cnt FROM routes GROUP BY route_status

-- Active routes with delay percentage
SELECT route_id, route_name, delay_time,
  ROUND(delay_time * 100.0 / NULLIF(travel_time, 0), 1) as delay_pct
FROM routes
WHERE route_status = 'ACTIVE' AND delay_time > 0
ORDER BY delay_pct DESC
```

### Response Structure

```json
{
  "metadata": {
    "tool": "tomtom-route-search",
    "parameters": {
      "totalRoutes": 42
    },
    "raw_row_counts": { "routes": 42 },
    "queries_executed": 2,
    "warnings": []
  },
  "aggregated_data": {
    "delayed_routes": [
      { "route_id": 123, "route_name": "A10 North", "delay_time": 180 }
    ],
    "status_summary": [
      { "route_status": "ACTIVE", "cnt": 38 }
    ]
  }
}
```

- **`metadata`** -- total routes fetched from API, row counts, query count
- **`aggregated_data`** -- results keyed by your query names from `sql_queries`

---

## tomtom-route-monitoring-details

Gets **segment-level traffic analysis** for specific routes. Supports **multi-route comparison** -- data from all requested routes is merged into the same database.

**API endpoint:** `GET /routemonitoring/3/routes/{routeId}/details` (called in parallel for each route)

### Input

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `routeIds` | `string[]` | Yes | Route IDs to query. Min 1, max 20. Data is merged for cross-route SQL comparisons. |
| `sql_queries` | `Record<string, string>` | Yes | Named SQL queries (DuckDB dialect). At least 1 required. |

**Example call:**

```json
{
  "routeIds": ["123", "456"],
  "sql_queries": {
    "slow_segments": "SELECT segment_id, current_speed, typical_speed FROM segments WHERE current_speed < typical_speed * 0.5",
    "route_summary": "SELECT route_name, travel_time, delay_time FROM route_info"
  }
}
```

### Available Tables

#### Table 1: `route_info` (1 row per route)

| Column | Type | Description |
|--------|------|-------------|
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

#### Table 2: `segments` (N rows per route)

| Column | Type | Description |
|--------|------|-------------|
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

### Example SQL Queries

**Single-route analysis:**

```sql
-- Slow segments (below 50% of typical speed)
SELECT segment_id, current_speed, typical_speed,
  (typical_speed - current_speed) as speed_diff
FROM segments
WHERE current_speed < typical_speed * 0.5
ORDER BY speed_diff DESC

-- Route summary
SELECT route_name, travel_time, delay_time,
  ROUND(route_confidence, 2) as confidence
FROM route_info

-- Low confidence segments
SELECT segment_id, current_speed, confidence
FROM segments WHERE confidence < 0.5 ORDER BY confidence
```

**Multi-route comparison:**

```sql
-- Compare routes by delay percentage
SELECT route_id, route_name, delay_time, travel_time,
  ROUND(delay_time * 100.0 / NULLIF(travel_time, 0), 1) as delay_pct
FROM route_info ORDER BY delay_pct DESC

-- Route performance ranking
SELECT route_id, route_name,
  ROUND(route_confidence, 2) as confidence, completeness
FROM route_info ORDER BY route_confidence DESC

-- Join route info with segment statistics
SELECT r.route_name, r.delay_time,
  COUNT(s.segment_id) as segment_count,
  ROUND(AVG(s.confidence), 2) as avg_confidence
FROM route_info r
LEFT JOIN segments s ON r.route_id = s.route_id
GROUP BY r.route_id, r.route_name, r.delay_time
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
    "raw_row_counts": { "route_info": 2, "segments": 84 },
    "queries_executed": 2,
    "warnings": []
  },
  "aggregated_data": {
    "slow_segments": [
      { "segment_id": 98765, "current_speed": 12.5, "typical_speed": 55.0 }
    ],
    "route_summary": [
      { "route_name": "A10 North", "travel_time": 1200, "delay_time": 180 }
    ]
  }
}
```

---

## Typical 2-Step Workflow

```
Step 1: tomtom-route-search
   sql_queries: {
     "find": "SELECT route_id, route_name FROM routes WHERE route_name ILIKE '%A10%'"
   }
   --> Returns route_id: 123, 456

Step 2: tomtom-route-monitoring-details
   routeIds: ["123", "456"]
   sql_queries: {
     "analysis": "SELECT r.route_name, r.delay_time, COUNT(s.segment_id) as segments, ROUND(AVG(s.current_speed), 1) as avg_speed FROM route_info r LEFT JOIN segments s ON r.route_id = s.route_id GROUP BY r.route_id, r.route_name, r.delay_time"
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
| SQL table schemas | `src/sql/schemas/routeListSchema.ts`, `src/sql/schemas/routeMonitoringSchema.ts` |
| Flatteners | `src/sql/flatteners/routeListFlattener.ts`, `src/sql/flatteners/routeMonitoringFlattener.ts` |
