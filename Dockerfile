FROM node:24-slim

LABEL description="TomTom Traffic Analytics MCP Server (HTTP)"
LABEL maintainer="TomTom <https://www.tomtom.com/>"

WORKDIR /app

# Install curl for health checks
RUN apt-get update && apt-get install -y --no-install-recommends curl \
 && rm -rf /var/lib/apt/lists/*

# Install dependencies
COPY package*.json ./
RUN npm ci --ignore-scripts

# Copy source and build
COPY . .
RUN npm run build

EXPOSE 3000

CMD ["node", "./bin/tomtom-traffic-analytics-mcp-http.js"]
