# Security

## Reporting a vulnerability

Please report security issues responsibly through TomTom's disclosure process
(HackerOne) rather than opening a public GitHub issue.

## Deployment guidance for the HTTP server

This project ships two transports:

- **stdio** (`bin/tomtom-traffic-analytics-mcp.js`) — the default, run locally by
  each user (npm / MCPB / Claude Desktop). API keys come from the local environment.
- **HTTP** (`bin/tomtom-traffic-analytics-mcp-http.js`, the Docker image) — a network
  server exposing `POST /mcp`.

**The HTTP server must not be exposed to untrusted callers without an authentication
layer in front of it.** Run it behind an authenticated API gateway (or equivalent
per-request authentication) so that only authenticated callers can reach `/mcp`. The
server injects TomTom API keys into upstream calls, so an unauthenticated caller that
reaches the endpoint can consume your API quota.

Recommended hardening for any HTTP deployment:

- **Authenticate every request** at the gateway and/or in the server (per-request
  `tomtom-api-key` header or a verified Bearer token). Do not rely on the presence of
  server-side environment keys as an authentication signal.
- **Set `ALLOWED_ORIGINS`** explicitly if browser clients need CORS; it is deny-by-default.
- **Run as non-root.** The provided `Dockerfile` runs as the unprivileged `node` user and
  `docker-compose.yml` drops capabilities, enables `no-new-privileges`, and mounts the
  root filesystem read-only.
- **Restrict network exposure** to the gateway; do not publish the port to the public
  internet directly.

## SQL filtering safety

User-supplied `sql_queries` run against an in-memory DuckDB instance that is locked down
at initialization: `enable_external_access=false`, `disabled_filesystems='LocalFileSystem'`,
extension autoload/autoinstall disabled, `lock_configuration=true`, and bounded resource
limits. A defense-in-depth validator additionally rejects non-`SELECT` statements,
multi-statement queries, and filesystem/network/config functions (`read_*`, `write_*`,
`glob`, `sniff_csv`, `parquet_*`, `http_*`, `INSTALL`/`LOAD`/`SET`/`ATTACH`, etc.).
