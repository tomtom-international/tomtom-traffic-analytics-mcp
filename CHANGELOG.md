# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2026-04-15

First public open-source release under `@tomtom-org/tomtom-traffic-analytics-mcp`.

### Added

**Area Analytics** (1 tool)
- `tomtom-area-analytics-stats` — Direct time-series statistics for GeoJSON polygon regions (max 31 days)

**Junction Analytics** (3 tools)
- `tomtom-junction-search` — SQL-powered search across all junctions with filtering and aggregation
- `tomtom-junction-live-data` — Real-time traffic metrics (updates every minute)
- `tomtom-junction-archive` — Historical traffic data (max 2 days per request)

**Route Monitoring** (2 tools)
- `tomtom-route-search` — SQL-powered search across all routes with filtering and aggregation
- `tomtom-route-monitoring-details` — Segment-level traffic analysis

**Live Traffic** (2 tools)
- `tomtom-traffic-flow-segment` — Real-time traffic for road segments
- `tomtom-traffic-incidents` — Traffic incidents in an area with multi-area comparison

**Infrastructure**
- Full MCP (Model Context Protocol) compliance with stdio and HTTP transports
- DuckDB-powered SQL filtering — all tools require `sql_queries` parameter for server-side data filtering
- TypeScript with complete type definitions
- Unit and integration test suite
- Docker support
