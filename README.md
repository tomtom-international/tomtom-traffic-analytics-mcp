# TomTom Traffic Analytics MCP Server

[![License](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](LICENSE.md)
[![npm version](https://img.shields.io/npm/v/@tomtom-org/tomtom-traffic-analytics-mcp)](https://www.npmjs.com/package/@tomtom-org/tomtom-traffic-analytics-mcp)

MCP server for TomTom Traffic Analytics APIs — enabling AI assistants to access real-time and historical traffic data for area analysis, junction monitoring, route tracking, and live traffic insights.

> **Tip**: Pair with [TomTom MCP Server](https://www.npmjs.com/package/@tomtom-org/tomtom-mcp) for geocoding, routing, and mapping capabilities.

---

## API Access Requirements

This MCP server connects to multiple TomTom APIs with different access requirements:

| API Category | Environment Variable | Access |
|--------------|---------------------|--------|
| **MOVE Portal** | `TOMTOM_MOVE_PORTAL_KEY` | [Sign up for MOVE](https://move.tomtom.com/register) (30-day free trial) |
| **TomTom Developer** | `TOMTOM_API_KEY` | [TomTom Developer Portal](https://developer.tomtom.com/) |

### Which API is used by each tool?

| Tools | API Required |
|-------|--------------|
| Area Analytics (1 tool) | MOVE Portal |
| Junction Analytics (3 tools) | MOVE Portal |
| Route Monitoring (2 tools) | MOVE Portal |
| Live Traffic (2 tools) | TomTom Developer |

### Recommended agent workflow

1. **Junction analysis**: `tomtom-junction-search` (find IDs by name/status/country) → `tomtom-junction-live-data` or `tomtom-junction-archive` (traffic analysis)
2. **Route analysis**: `tomtom-route-search` (find IDs by name/status/delay) → `tomtom-route-monitoring-details` (segment-level analysis)

---

## Quick Start

### Prerequisites
- **Node.js 22+**
- API keys (see table above)

### Install from npm

```bash
npm install @tomtom-org/tomtom-traffic-analytics-mcp
```

Or run directly with npx:

```bash
npx @tomtom-org/tomtom-traffic-analytics-mcp
```

### Install from source

```bash
git clone https://github.com/tomtom-international/tomtom-traffic-analytics-mcp.git
cd tomtom-traffic-analytics-mcp
npm install
npm run build
```

### Configuration

```bash
# Create .env file
echo "TOMTOM_MOVE_PORTAL_KEY=your_move_portal_key" > .env
echo "TOMTOM_API_KEY=your_tomtom_developer_key" >> .env

```

### Run

```bash
node ./bin/tomtom-traffic-analytics-mcp.js
```

### Claude Desktop Configuration

Add to your `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "tomtom-traffic-analytics": {
      "command": "npx",
      "args": ["-y", "@tomtom-org/tomtom-traffic-analytics-mcp"],
      "env": {
        "TOMTOM_MOVE_PORTAL_KEY": "your_move_portal_key",
        "TOMTOM_API_KEY": "your_tomtom_developer_key",
        "USE_STDIO": "true"
      }
    }
  }
}
```

---

## SQL Filtering

Analytical tools return large datasets that can overflow LLM context windows. To address this, **all analytical tools require a `sql_queries` parameter** that filters/aggregates data server-side using DuckDB.

**All tools require `sql_queries`:**
- `tomtom-junction-search`, `tomtom-junction-live-data`, `tomtom-junction-archive`
- `tomtom-route-search`, `tomtom-route-monitoring-details`
- `tomtom-area-analytics-stats`
- `tomtom-traffic-flow-segment`, `tomtom-traffic-incidents`

**Example:**
```json
{
  "junctionIds": ["abc-123"],
  "sql_queries": {
    "top_delays": "SELECT approach_id, delay_sec FROM approaches ORDER BY delay_sec DESC LIMIT 5"
  }
}
```

See tool descriptions for available tables and columns.

---

## Available Tools

### Area Analytics (1 tool) — MOVE Portal

Analyze traffic patterns in custom geographical areas.

| Tool | Description |
|------|-------------|
| `tomtom-area-analytics-stats` | Direct statistics (requires `sql_queries`) |

### Junction Analytics (3 tools) — MOVE Portal

Monitor traffic at intersections with real-time and historical data.

| Tool | Description |
|------|-------------|
| `tomtom-junction-search` | Search/filter all junctions via SQL (requires `sql_queries`) |
| `tomtom-junction-live-data` | Real-time metrics (requires `sql_queries`) |
| `tomtom-junction-archive` | Historical data (requires `sql_queries`) |

### Route Monitoring (2 tools) — MOVE Portal

Track real-time traffic on strategic corridors.

| Tool | Description |
|------|-------------|
| `tomtom-route-search` | Search/filter all routes via SQL (requires `sql_queries`) |
| `tomtom-route-monitoring-details` | Segment-level analysis (requires `sql_queries`) |

### Live Traffic (2 tools) — TomTom Developer

Real-time traffic data for specific locations.

| Tool | Description |
|------|-------------|
| `tomtom-traffic-flow-segment` | Traffic for road segment at coordinates (requires `sql_queries`) |
| `tomtom-traffic-incidents` | Traffic incidents in an area (requires `sql_queries`) |

---

## Sample Prompts

- "Analyze traffic congestion in downtown Amsterdam for morning rush hours last week"
- "Compare traffic incidents between downtown and the airport area"
- "Show me the delay trends for junction abc-123 over the past two days"
- "Get current traffic conditions at coordinates 52.41, 4.84"

---

## Development

### Project Structure

```
src/
├── index.ts                 # Entry point
├── createServer.ts          # MCP server setup
├── tools/                   # MCP tool definitions
├── handlers/                # Request handlers
├── services/                # TomTom API clients
├── schemas/                 # Zod validation schemas
├── sql/                     # SQL filtering engine
│   ├── SqlFilterEngine.ts   # DuckDB engine
│   ├── flatteners/          # JSON → table converters
│   └── schemas/             # Table definitions
├── types/                   # TypeScript types
└── utils/                   # Logger & error handling
```

### Commands

```bash
npm run build          # Build TypeScript
npm test               # Run unit tests
npm run test:all       # Run all tests (requires API key)
npm run lint           # Lint code
```

> Unit tests run without API keys. Integration tests (`npm run test:all`) require valid API keys in `.env`.

---

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for development setup, coding guidelines, and how to submit pull requests.

## License

This project is licensed under the Apache License 2.0 — see the [LICENSE](LICENSE.md) file for details.

---

## Troubleshooting

| Issue | Solution |
|-------|----------|
| API key not found | Verify `.env` file exists with required keys |
| Build errors | Run `npm run build` and check TypeScript errors |
| Test failures | Ensure valid API key and check API quota |
