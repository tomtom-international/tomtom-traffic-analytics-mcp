// NOTE: run via `npm run test:e2e`, which passes `--tsconfig tsconfig.playwright.json`.
// Without that flag, Playwright picks up the root tsconfig.json's `paths: { "*": ["node_modules/*"] }`
// wildcard to resolve this file's imports, which reroutes "@playwright/test" through its raw
// node_modules path instead of its package.json `exports` map — breaking the `defineConfig` named
// export. tsconfig.playwright.json has no `paths` override, so this file resolves normally.
import { defineConfig, devices } from "@playwright/test";
import { config } from "dotenv";

config({ quiet: true });

export default defineConfig({
  testDir: "./e2e",
  timeout: 120_000,
  expect: { timeout: 30_000 },
  fullyParallel: false,
  retries: 1,
  reporter: [["html", { open: "never" }], ["list"]],

  use: {
    baseURL: "http://127.0.0.1:8080",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },

  webServer: [
    {
      command: "node dist/indexHttp.esm.js",
      // Explicit 127.0.0.1 URL (not `port`) so Playwright's own readiness probe
      // dials the same loopback interface the server binds — `port` alone would
      // default the health check to `localhost`, which can resolve to the IPv6
      // `::1` interface and race with an unrelated app on that port.
      url: "http://127.0.0.1:3000/health",
      timeout: 30_000,
      reuseExistingServer: !process.env.CI,
      env: {
        TOMTOM_API_KEY: process.env.TOMTOM_API_KEY ?? "",
        TOMTOM_MOVE_PORTAL_KEY: process.env.TOMTOM_MOVE_PORTAL_KEY ?? "",
        // The UI host (port 8080) calls this server directly from the browser,
        // so its origin must be allow-listed — CORS is opt-in (see indexHttp.ts).
        ALLOWED_ORIGINS: "http://127.0.0.1:8080",
        PORT: "3000",
        LOG_LEVEL: "warn",
      },
    },
    {
      command: "cd ui && npx tsx serve.ts",
      // See note above: explicit 127.0.0.1 URL to match the server's loopback bind.
      url: "http://127.0.0.1:8080/",
      timeout: 15_000,
      reuseExistingServer: !process.env.CI,
      env: {
        TOMTOM_API_KEY: process.env.TOMTOM_API_KEY ?? "",
        TOMTOM_MOVE_PORTAL_KEY: process.env.TOMTOM_MOVE_PORTAL_KEY ?? "",
        HOST_PORT: "8080",
        SANDBOX_PORT: "8081",
      },
    },
  ],

  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
