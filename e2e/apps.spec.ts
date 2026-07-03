import { test, expect } from "./fixtures/servers";
import type { Page, FrameLocator, Frame } from "@playwright/test";

/**
 * E2E coverage for the two MCP Apps (traffic-incidents, area-analytics) served
 * by this repo's tools. Navigates the double-iframe sandbox (host -> sandbox
 * proxy -> inner app document) exactly like a real MCP client host would, and
 * pokes at the MapLibre instance the apps expose on `window.__e2e_ml` for
 * assertions that can't be done through the DOM (canvas-rendered markers/tiles).
 */

// ─── Helpers ──────────────────────────────────────────────────────────────

/** Navigate into the double iframe: host → sandbox → inner app. */
function getAppFrame(page: Page): FrameLocator {
  return page.frameLocator('[data-testid="app-iframe"]').frameLocator("iframe");
}

/**
 * Find the inner app `Frame` object (created async via `doc.write`, so its
 * URL stays `about:blank`/`about:srcdoc`) so we can run `waitForFunction`
 * against its `window`.
 */
async function findInnerAppFrame(page: Page): Promise<Frame> {
  for (let i = 0; i < 60; i++) {
    const frame = page.frames().find(
      (f) => f !== page.mainFrame() && (f.url() === "about:blank" || f.url() === "about:srcdoc"),
    );
    if (frame) return frame;
    await page.waitForTimeout(500);
  }
  throw new Error("Could not find inner app frame");
}

/** Run a tool with the given input and return the app frame locator. */
async function runToolWithUI(
  page: Page,
  toolName: string,
  input?: Record<string, unknown>,
): Promise<FrameLocator> {
  await page.getByTestId(`tool-item-${toolName}`).click();
  await expect(page.getByTestId("selected-tool-name")).toHaveText(
    toolName.replace("tomtom-", ""),
  );

  if (input) {
    const textarea = page.getByTestId("request-body-textarea");
    await textarea.fill(JSON.stringify(input, null, 2));
  }

  await page.getByTestId("run-button").click();

  await expect(page.getByTestId("tab-map")).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId("app-iframe")).toBeVisible();

  return getAppFrame(page);
}

/** Switch to JSON Result tab and validate the response is a non-error tool result. */
async function verifyJsonResult(page: Page): Promise<void> {
  await page.getByTestId("tab-result").click();
  const result = page.getByTestId("json-result");
  await expect(result).toBeVisible({ timeout: 60_000 });

  const text = await result.textContent();
  expect(text).toBeTruthy();

  const parsed = JSON.parse(text!);
  expect(parsed.isError).not.toBe(true);
  expect(parsed.content?.length).toBeGreaterThan(0);
}

/** A small bbox around central Amsterdam — kept tight so the API call is fast. */
const AMSTERDAM_BBOX = "4.88,52.36,4.91,52.38";

/**
 * Area Analytics `lite` reports have a 24-48h processing delay and require
 * endDate to be a few days in the past. Compute a 3-day window ending 4 days
 * before today so the example always validates regardless of when the test runs.
 */
function areaAnalyticsInput(): Record<string, unknown> {
  const toISODate = (d: Date): string => d.toISOString().slice(0, 10);
  const end = new Date();
  end.setUTCDate(end.getUTCDate() - 4);
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - 2);

  return {
    name: "Amsterdam Center",
    startDate: toISODate(start),
    endDate: toISODate(end),
    hours: [7, 8, 9, 16, 17, 18],
    frcs: [0, 1, 2, 3],
    dataTypes: ["CONGESTION_LEVEL", "SPEED"],
    features: [
      {
        type: "Feature",
        geometry: {
          type: "Polygon",
          coordinates: [
            [
              [4.88, 52.36],
              [4.91, 52.36],
              [4.91, 52.38],
              [4.88, 52.38],
              [4.88, 52.36],
            ],
          ],
        },
        properties: { name: "Amsterdam Center" },
      },
    ],
    sql_queries: { summary: "SELECT * FROM area_summary" },
    show_ui: true,
  };
}

// ─── tomtom-traffic-incidents ───────────────────────────────────────────────

test.describe("Traffic Incidents app", () => {
  test("renders the map, incident list (or graceful empty state), and exposes __e2e_ml", async ({
    connectedPage: page,
  }) => {
    const app = await runToolWithUI(page, "tomtom-traffic-incidents", {
      bboxes: [{ name: "Amsterdam Center", bbox: AMSTERDAM_BBOX }],
      sql_queries: { incidents: "SELECT id FROM incidents" },
      show_ui: true,
    });

    await expect(app.locator("#sdk-map")).toHaveClass(/visible/, { timeout: 30_000 });
    await expect(app.locator(".maplibregl-canvas")).toBeVisible();
    await expect(app.locator("#incident-panel")).not.toHaveClass(/hidden/);

    // Either at least one incident row, or the graceful empty-state message.
    const itemCount = await app.locator(".incident-item").count();
    if (itemCount === 0) {
      await expect(app.locator("#empty-state")).toBeVisible();
    } else {
      expect(itemCount).toBeGreaterThan(0);
    }

    const innerFrame = await findInnerAppFrame(page);
    const hasMap = await innerFrame.evaluate(() => Boolean((window as any).__e2e_ml));
    expect(hasMap).toBe(true);

    await verifyJsonResult(page);
  });
});

// ─── tomtom-area-analytics-stats ────────────────────────────────────────────

test.describe("Area Analytics app", () => {
  test("renders the mode selector and an area-analytics MapLibre layer", async ({
    connectedPage: page,
  }) => {
    const app = await runToolWithUI(page, "tomtom-area-analytics-stats", areaAnalyticsInput());

    await expect(app.locator("#sdk-map")).toHaveClass(/visible/, { timeout: 30_000 });
    await expect(app.locator(".maplibregl-canvas")).toBeVisible();
    await expect(app.locator("#analytics-panel")).not.toHaveClass(/hidden/);
    await expect(app.locator("#mode-select")).toBeVisible();

    const innerFrame = await findInnerAppFrame(page);
    const hasAreaAnalyticsLayer = await innerFrame.waitForFunction(() => {
      const ml = (window as any).__e2e_ml;
      if (!ml) return false;
      const style = ml.getStyle();
      return style.layers.some((l: { id: string }) => l.id.startsWith("area-analytics-"));
    }, undefined, { timeout: 30_000 });
    expect(await hasAreaAnalyticsLayer.jsonValue()).toBe(true);

    await verifyJsonResult(page);
  });
});

// ─── show_ui: false ──────────────────────────────────────────────────────────

test.describe("show_ui: false", () => {
  test("traffic-incidents: hides the map and shows the 'Data processed' pill", async ({
    connectedPage: page,
  }) => {
    await page.getByTestId("tool-item-tomtom-traffic-incidents").click();

    const textarea = page.getByTestId("request-body-textarea");
    const input = JSON.parse(await textarea.inputValue());
    input.show_ui = false;
    await textarea.fill(JSON.stringify(input, null, 2));

    await page.getByTestId("run-button").click();

    await expect(page.getByTestId("tab-map")).toBeVisible({ timeout: 60_000 });
    const app = getAppFrame(page);

    await expect(app.locator("#ui-hidden-indicator")).toBeVisible({ timeout: 15_000 });
    await expect(app.locator(".indicator-pill")).toContainText("Data processed");
    await expect(app.locator("html")).toHaveClass(/ui-hidden/);

    await verifyJsonResult(page);
  });
});
