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

## JavaScript filtering safety

User-supplied `js_queries` are evaluated inside a QuickJS WASM sandbox, on a heap separate
from the host. The model is deny-by-default: the host bridges nothing into the guest, so
there is no `process`, `require`, `import`, `fetch`, filesystem, network or timer to reach
— they are absent rather than blocked, and no blocklist has to keep up with them. The only
values that cross the boundary are the dataset JSON going in and a JSON string coming out.

Runaway code is bounded by a wall-clock interrupt handler (5s), a heap cap (512 MB) and a
stack cap. The stack cap is deliberately small (256 KB): above roughly that, deep guest
recursion exhausts the host's WASM stack before QuickJS raises its own error, which would
surface as an uncatchable `RangeError` and take the process down.

Results are capped at 10,000 array elements and 1 MB of JSON, so a query cannot flood the
caller's context window.
