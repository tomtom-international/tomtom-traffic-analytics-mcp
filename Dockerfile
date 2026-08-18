FROM node:24-slim

LABEL description="TomTom Traffic Analytics MCP Server (HTTP)"
LABEL maintainer="TomTom <https://www.tomtom.com/>"

WORKDIR /app

# Install curl for health checks, plus pnpm.
# Keep PNPM_VERSION in sync with the "packageManager" field in package.json.
ARG PNPM_VERSION=11.21.0
RUN apt-get update && apt-get install -y --no-install-recommends curl \
 && rm -rf /var/lib/apt/lists/* \
 && npm install -g pnpm@${PNPM_VERSION}

# Install dependencies.
# pnpm-workspace.yaml carries the overrides and allowBuilds settings that pnpm 11
# moved out of package.json; without it --frozen-lockfile sees no overrides and
# rejects the lockfile (ERR_PNPM_LOCKFILE_CONFIG_MISMATCH).
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
# CI=true keeps pnpm non-interactive: outside CI it prompts to approve the install
# scripts of packages missing from `allowBuilds`, and `docker build` has no TTY.
# --ignore-scripts also skips the "prepare" build, which runs after the sources land.
RUN CI=true pnpm install --frozen-lockfile --ignore-scripts

# Copy source and build
COPY . .
RUN pnpm run build

# Drop root privileges: run as the unprivileged "node" user (uid 1000) that
# ships with the official node image. Ownership is handed over after the build
# steps (which need write access to /app) complete.
RUN chown -R node:node /app
USER node

EXPOSE 3000

CMD ["node", "./bin/tomtom-traffic-analytics-mcp-http.js"]
