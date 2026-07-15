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
    const frame = page
      .frames()
      .find(
        (f) => f !== page.mainFrame() && (f.url() === "about:blank" || f.url() === "about:srcdoc")
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
  input?: Record<string, unknown>
): Promise<FrameLocator> {
  await page.getByTestId(`tool-item-${toolName}`).click();
  await expect(page.getByTestId("selected-tool-name")).toHaveText(toolName.replace("tomtom-", ""));

  if (input) {
    const textarea = page.getByTestId("request-body-textarea");
    await textarea.fill(JSON.stringify(input, null, 2));
  }

  await page.getByTestId("run-button").click();

  await expect(page.getByTestId("tab-map")).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId("app-iframe")).toBeVisible();

  return getAppFrame(page);
}

/**
 * Switch to JSON Result tab and validate the response is a non-error tool
 * result. Returns the tool's actual response payload (the double-encoded
 * `content[0].text` JSON — `{ metadata, aggregated_data, _meta }`) so specs
 * can chain a discovery call into a follow-up details call.
 */
async function verifyJsonResult(page: Page): Promise<any> {
  await page.getByTestId("tab-result").click();
  const result = page.getByTestId("json-result");
  await expect(result).toBeVisible({ timeout: 60_000 });

  const text = await result.textContent();
  expect(text).toBeTruthy();

  const parsed = JSON.parse(text!);
  expect(parsed.isError).not.toBe(true);
  expect(parsed.content?.length).toBeGreaterThan(0);

  const firstText = parsed.content?.find((c: { type: string }) => c.type === "text")?.text;
  return firstText ? JSON.parse(firstText) : parsed;
}

/**
 * `aggregated_data.<queryName>` entries are `SqlQueryExecutionResult` objects
 * — `{ columns: string[], rows: unknown[][], rowCount }` — not row objects
 * (see `src/sql/types.ts`). Look up a column's value in the first row by name
 * so discovery specs don't hardcode column ordinal positions.
 */
function firstRowValue(
  queryResult: { columns?: string[]; rows?: unknown[][] } | undefined,
  column: string
): unknown {
  const idx = queryResult?.columns?.indexOf(column) ?? -1;
  if (idx < 0) return undefined;
  return queryResult?.rows?.[0]?.[idx];
}

/**
 * Same shape as `firstRowValue` but returns every row's value for a column.
 * Used to try to force the Wave-6 multi-select switcher UI (`.tta-switcher`)
 * when the test account happens to have more than one junction/route — the
 * switcher only renders once `junctionIds`/`routeIds` has 2+ entries.
 */
function allColumnValues(
  queryResult: { columns?: string[]; rows?: unknown[][] } | undefined,
  column: string
): unknown[] {
  const idx = queryResult?.columns?.indexOf(column) ?? -1;
  if (idx < 0) return [];
  return (queryResult?.rows ?? []).map((row) => row[idx]);
}

/** A small bbox around central Amsterdam — kept tight so the API call is fast. */
const AMSTERDAM_BBOX = "4.88,52.36,4.91,52.38";

/**
 * CSS class selectors for the ad-hoc pill classes removed in favor of the
 * shared `.tta-tag` component — none of these should ever appear in the DOM.
 */
const REMOVED_PILL_CLASSES = ".impassable-pill, .closure-badge, .magnitude-badge, .detail-hint";

/**
 * Reads whether `#app-root.drawer-open` is set inside an app `FrameLocator`.
 * Used to verify `.tta-drawer-handle` toggles the class, regardless of
 * whether `initDrawer` (drawer.ts) happens to default it open on narrow entry.
 */
function drawerOpenChecker(app: FrameLocator): () => Promise<boolean> {
  const appRoot = app.locator("#app-root");
  return async () => ((await appRoot.getAttribute("class")) ?? "").includes("drawer-open");
}

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
    sql_queries: {
      daily_summary:
        "SELECT time, ROUND(congestion_level, 1) AS congestion_pct FROM timed_data WHERE aggregation_type = 'daily' ORDER BY time",
    },
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
      // Pill consistency: incident rows use the shared `.tta-tag` component.
      await expect(app.locator(".incident-item .tta-tag").first()).toBeVisible();
    }

    // No leftover ad-hoc pill classes anywhere in the app.
    await expect(app.locator(REMOVED_PILL_CLASSES)).toHaveCount(0);

    // --- Responsive drawer (BP-A, < 640px effective app width) --------------
    // The app-iframe's width is whatever's left of the host's browser viewport
    // after its fixed 220px tool sidebar + 340px input panel columns —
    // narrowing the browser viewport narrows the app itself, the same way a
    // real host resizing its panel would.
    const wideBox = await page.getByTestId("app-iframe").boundingBox();
    expect(wideBox?.width).toBeGreaterThan(640);
    await expect(app.locator(".tta-drawer-handle")).toBeHidden();
    // Wide layout shows the 320px side panel (not the bottom drawer).
    const widePanelBox = await app.locator("#incident-panel").boundingBox();
    expect(widePanelBox?.width).toBeGreaterThanOrEqual(300);
    expect(widePanelBox?.width).toBeLessThanOrEqual(325);

    // --- Fixed-height widget (Wave 6): `#app-root` reports a definite content
    // height (600px) instead of stretching to fit the incident list, so the
    // ext-apps SDK auto-resizes the host iframe to that stable height and the
    // list scrolls internally (`.incident-list`) rather than growing the map.
    const appRootBox = await app.locator("#app-root").boundingBox();
    expect(appRootBox?.height).toBeGreaterThan(550);
    expect(appRootBox?.height).toBeLessThan(650);
    // Fallback/sanity: the map itself must stay bounded too, not balloon to
    // thousands of px if the height model regresses.
    const mapBox = await app.locator("#sdk-map").boundingBox();
    expect(mapBox?.height).toBeLessThan(900);

    // Only meaningful once the list has enough rows to overflow the drawer —
    // guarded on data since a tight Amsterdam bbox may return few incidents.
    if (itemCount > 8) {
      const listOverflows = await app
        .locator("#incident-list")
        .evaluate((elm) => elm.scrollHeight > elm.clientHeight);
      expect(listOverflows).toBe(true);
    }

    await page.setViewportSize({ width: 900, height: 800 });
    await expect
      .poll(async () => (await page.getByTestId("app-iframe").boundingBox())?.width)
      .toBeLessThan(640);

    const handle = app.locator(".tta-drawer-handle");
    await expect(handle).toBeVisible();
    const isDrawerOpen = drawerOpenChecker(app);
    const openedInitially = await isDrawerOpen();
    await handle.click();
    await expect.poll(isDrawerOpen).toBe(!openedInitially);
    await handle.click();
    await expect.poll(isDrawerOpen).toBe(openedInitially);

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
    // Narrow the browser viewport up front so the app-iframe renders under
    // the 779.98px BP-B overlay-de-collision breakpoint from the start (see
    // app-shell.css) — area-analytics is an OVERLAY shell app, so this only
    // affects `.overlay-top`/`.overlay-bottom` stacking, not a drawer.
    await page.setViewportSize({ width: 900, height: 800 });

    const app = await runToolWithUI(page, "tomtom-area-analytics-stats", areaAnalyticsInput());

    await expect(app.locator("#sdk-map")).toHaveClass(/visible/, { timeout: 30_000 });
    await expect(app.locator(".maplibregl-canvas")).toBeVisible();
    await expect(app.locator("#analytics-panel")).not.toHaveClass(/hidden/);
    await expect(app.locator("#mode-select")).toBeVisible();

    const innerFrame = await findInnerAppFrame(page);
    const hasAreaAnalyticsLayer = await innerFrame.waitForFunction(
      () => {
        const ml = (window as any).__e2e_ml;
        if (!ml) return false;
        const style = ml.getStyle();
        return style.layers.some((l: { id: string }) => l.id.startsWith("area-analytics-"));
      },
      undefined,
      { timeout: 30_000 }
    );
    expect(await hasAreaAnalyticsLayer.jsonValue()).toBe(true);

    // Overlay de-collision (BP-B): the header + filter bar wrapper is always
    // in the DOM; at this narrow width its children stack in normal flow
    // instead of floating over each other, so their boxes must not overlap.
    await expect(app.locator(".overlay-top")).toBeAttached();
    const header = app.locator("#analytics-header");
    const filterBar = app.locator("#control-bar");
    await expect(header).toBeVisible();
    await expect(filterBar).toBeVisible();
    const headerBox = await header.boundingBox();
    const filterBox = await filterBar.boundingBox();
    expect(headerBox && filterBox && filterBox.y >= headerBox.y + headerBox.height - 1).toBe(true);

    // No leftover ad-hoc pill classes anywhere in the app.
    await expect(app.locator(REMOVED_PILL_CLASSES)).toHaveCount(0);

    await verifyJsonResult(page);
  });
});

// ─── tomtom-traffic-flow-segment ────────────────────────────────────────────

test.describe("Traffic Flow app", () => {
  test("renders segment and stat card", async ({ connectedPage: page }) => {
    // Example input has show_ui: true baked in.
    await runToolWithUI(page, "tomtom-traffic-flow-segment");
    const frame = await getAppFrame(page);

    await expect(frame.locator("#sdk-map")).toHaveClass(/visible/, { timeout: 30_000 });
    await expect(frame.locator("#flow-panel")).not.toHaveClass(/hidden/);
    await expect(frame.locator("#stat-grid dt").first()).toBeVisible();

    // --- Live-traffic backdrop defaults off (Wave 6): `#backdrop-toggle`
    // loads unpressed so the flow segment reads clearly against the base map.
    const backdropToggle = frame.locator("#backdrop-toggle");
    await expect(backdropToggle).not.toHaveClass(/active/);
    await expect(backdropToggle).toHaveAttribute("aria-pressed", "false");

    const inner = await findInnerAppFrame(page);
    await inner.waitForFunction(() =>
      (window as any).__e2e_ml
        ?.getStyle()
        .layers.some((l: { id: string }) => l.id.includes("traffic-flow-segment"))
    );

    // No leftover ad-hoc pill classes anywhere in the app.
    await expect(frame.locator(REMOVED_PILL_CLASSES)).toHaveCount(0);

    await verifyJsonResult(page);
  });
});

// ─── tomtom-junction-search / tomtom-junction-live-data ─────────────────────

test.describe("Junction app", () => {
  test("renders search mode and live mode", async ({ connectedPage: page }) => {
    await runToolWithUI(page, "tomtom-junction-search");
    const frame = await getAppFrame(page);

    await expect(frame.locator("#sdk-map")).toHaveClass(/visible/, { timeout: 30_000 });
    await expect(frame.locator("#junction-panel")).not.toHaveClass(/hidden/);

    // Checked before the JSON-result tab switch below (which hides the app
    // iframe's tab content, and with it any element visibility checks on `frame`).
    const itemCount = await frame.locator(".junction-item").count();
    if (itemCount === 0) {
      await expect(frame.locator("#empty-state")).toBeVisible();
    } else {
      await expect(frame.locator(".junction-item-id").first()).toBeVisible();
      // Pill consistency: search rows use the shared `.tta-tag` component.
      await expect(frame.locator(".junction-item .tta-tag").first()).toBeVisible();
      await frame.locator(".junction-item").first().click();
      await expect(frame.locator("#junction-detail-card .detail-live-btn")).toBeVisible();
      await expect(frame.locator(".detail-hint")).toHaveCount(0);
      // ...and so does the detail card.
      await expect(frame.locator("#junction-detail-card .tta-tag").first()).toBeVisible();
    }

    // No leftover ad-hoc pill classes anywhere in the app.
    await expect(frame.locator(REMOVED_PILL_CLASSES)).toHaveCount(0);

    const searchResult = await verifyJsonResult(page);
    const junctionsResult = searchResult?.aggregated_data?.junctions;
    const junctionId = firstRowValue(junctionsResult, "junction_id");
    test.skip(!junctionId, "No junctions configured in this Move Portal account");

    await runToolWithUI(page, "tomtom-junction-live-data", {
      junctionIds: [junctionId],
      sql_queries: { delays: "SELECT junction_id, approach_id, delay_sec FROM approaches" },
      show_ui: true,
    });
    const liveFrame = await getAppFrame(page);
    await expect(liveFrame.locator(".approach-card").first()).toBeVisible({ timeout: 30_000 });

    const inner = await findInnerAppFrame(page);
    await inner.waitForFunction(() => {
      const layers = (window as any).__e2e_ml?.getStyle()?.layers;
      if (!layers) return false;
      return (
        layers.some((l: { id: string }) => l.id.includes("junction-live-approaches")) &&
        layers.some((l: { id: string }) => l.id === "junction-live-approaches-arrows")
      );
    });

    await expect(liveFrame.locator(".los-scale-step")).toHaveCount(6);
    await expect(liveFrame.locator(".los-badge").first()).toContainText("LOS");

    // No leftover ad-hoc pill classes anywhere in the live-mode app either.
    await expect(liveFrame.locator(REMOVED_PILL_CLASSES)).toHaveCount(0);

    // --- Collapsible legend (Task 5): re-expands after narrow→wide resize ---
    // Regression coverage for the bug where the legend's narrow-width default
    // (collapsed) never got undone on returning to wide, leaving it stuck as
    // a collapsed pill forever. Reuses the same setViewportSize + boundingBox
    // polling approach as the drawer resize check above.
    const wideLiveBox = await page.getByTestId("app-iframe").boundingBox();
    expect(wideLiveBox?.width).toBeGreaterThan(640);
    await expect(liveFrame.locator(".legend")).not.toHaveClass(/collapsed/);

    await page.setViewportSize({ width: 900, height: 800 });
    await expect
      .poll(async () => (await page.getByTestId("app-iframe").boundingBox())?.width)
      .toBeLessThan(640);
    await expect(liveFrame.locator(".legend")).toHaveClass(/collapsed/);

    await page.setViewportSize({ width: 1280, height: 800 });
    await expect
      .poll(async () => (await page.getByTestId("app-iframe").boundingBox())?.width)
      .toBeGreaterThan(640);
    await expect(liveFrame.locator(".legend")).not.toHaveClass(/collapsed/);

    // --- Switcher-as-list (Wave 6): when the Move Portal account has 2+
    // junctions, loading them together renders `#junction-chips` as a
    // `.tta-switcher` of `.tta-switcher-item` rows (name +
    // `.tta-switcher-item-id`) instead of the old `.tta-chip` pills. Guarded —
    // not every test account has multiple junctions to force this with.
    const twoJunctionIds = Array.from(new Set(allColumnValues(junctionsResult, "junction_id"))).slice(
      0,
      2
    );
    if (twoJunctionIds.length >= 2) {
      await runToolWithUI(page, "tomtom-junction-live-data", {
        junctionIds: twoJunctionIds,
        sql_queries: { delays: "SELECT junction_id, approach_id, delay_sec FROM approaches" },
        show_ui: true,
      });
      const multiFrame = await getAppFrame(page);
      await expect(multiFrame.locator("#junction-chips .tta-switcher-item").first()).toBeVisible({
        timeout: 30_000,
      });
      expect(
        await multiFrame.locator("#junction-chips .tta-switcher-item-id").count()
      ).toBeGreaterThanOrEqual(2);
      await expect(multiFrame.locator("#junction-chips .tta-chip")).toHaveCount(0);
    } else {
      console.log(
        "Skipping multi-junction switcher assertion: fewer than 2 junctions available in this Move Portal account"
      );
    }

    await verifyJsonResult(page);
  });
});

// ─── tomtom-route-search / tomtom-route-monitoring-details ──────────────────

test.describe("Route app", () => {
  test("renders search mode and segment details", async ({ connectedPage: page }) => {
    await runToolWithUI(page, "tomtom-route-search");
    const frame = await getAppFrame(page);

    await expect(frame.locator("#sdk-map")).toHaveClass(/visible/, { timeout: 30_000 });
    await expect(frame.locator("#route-panel")).not.toHaveClass(/hidden/);

    // Checked before the JSON-result tab switch below (which hides the app
    // iframe's tab content, and with it any element visibility checks on `frame`).
    const itemCount = await frame.locator(".route-item").count();
    if (itemCount === 0) {
      await expect(frame.locator("#empty-state")).toBeVisible();
    } else {
      await expect(frame.locator(".route-item-id").first()).toBeVisible();
      await expect(frame.locator(".detail-hint")).toHaveCount(0);
      // Pill consistency: search rows use the shared `.tta-tag` component.
      await expect(frame.locator(".route-item .tta-tag").first()).toBeVisible();

      // Route click-through: clicking a search row loads full details
      // in-place (a real `callServerTool` round trip to the app-only
      // `tomtom-get-route-details` tool, distinct from the direct
      // `tomtom-route-monitoring-details` tool call exercised below) and
      // switches the panel into details mode.
      await frame.locator(".route-item").first().click();
      await expect(frame.locator("#route-stats")).toBeVisible({ timeout: 30_000 });
      await expect(frame.locator("#details-back")).not.toHaveClass(/hidden/);
      // ...and detail cards use `.tta-tag` too.
      await expect(frame.locator("#route-stats .tta-tag").first()).toBeVisible();
      // Segment strip (Wave 6): replaces the old per-segment table with an
      // SVG speed-profile strip — one `.segment-bar` rect per segment, no
      // unbounded `.segment-table` rows.
      const segmentBarCount = await frame.locator(".segment-bar").count();
      if (segmentBarCount > 0) {
        await expect(frame.locator(".segment-strip")).toBeVisible();
        await expect(frame.locator(".segment-strip-caption")).toContainText("segment");
      } else {
        await expect(frame.locator(".segment-strip-empty")).toBeVisible();
      }
      await expect(frame.locator(".segment-table")).toHaveCount(0);

      // The back button returns to the search list.
      await frame.locator("#details-back-btn").click();
      await expect(frame.locator("#details-back")).toHaveClass(/hidden/);
      await expect(frame.locator(".route-item").first()).toBeVisible();
    }

    // No leftover ad-hoc pill classes anywhere in the app.
    await expect(frame.locator(REMOVED_PILL_CLASSES)).toHaveCount(0);

    const searchResult = await verifyJsonResult(page);
    const routesResult = searchResult?.aggregated_data?.routes;
    const routeId = firstRowValue(routesResult, "route_id");
    test.skip(routeId == null, "No routes configured in this Move Portal account");

    await runToolWithUI(page, "tomtom-route-monitoring-details", {
      routeIds: [String(routeId)],
      sql_queries: { info: "SELECT * FROM route_info" },
      show_ui: true,
    });
    const detailsFrame = await getAppFrame(page);
    await expect(detailsFrame.locator(".segment-bar").first()).toBeVisible({ timeout: 30_000 });
    await expect(detailsFrame.locator(".segment-strip")).toBeVisible();
    await expect(detailsFrame.locator(".segment-table")).toHaveCount(0);

    // Row↔map highlight smoke test: hovering a bar must mark it (feature-state
    // side is asserted visually in Task 11).
    await detailsFrame.locator(".segment-bar").first().hover();
    await expect(detailsFrame.locator(".segment-bar").first()).toHaveClass(/hover/);

    // Pill consistency: detail cards use `.tta-tag`; no leftover ad-hoc pill classes.
    await expect(detailsFrame.locator("#route-stats .tta-tag").first()).toBeVisible();
    await expect(detailsFrame.locator(REMOVED_PILL_CLASSES)).toHaveCount(0);

    // --- Switcher-as-list (Wave 6): when the Move Portal account has 2+
    // routes, loading them together renders `#route-chips` as a
    // `.tta-switcher` of `.tta-switcher-item` rows (name +
    // `.tta-switcher-item-id`) instead of the old `.tta-chip` pills. Guarded —
    // not every test account has multiple routes to force this with.
    const twoRouteIds = Array.from(new Set(allColumnValues(routesResult, "route_id").map(String))).slice(
      0,
      2
    );
    if (twoRouteIds.length >= 2) {
      await runToolWithUI(page, "tomtom-route-monitoring-details", {
        routeIds: twoRouteIds,
        sql_queries: { info: "SELECT * FROM route_info" },
        show_ui: true,
      });
      const multiFrame = await getAppFrame(page);
      await expect(multiFrame.locator("#route-chips .tta-switcher-item").first()).toBeVisible({
        timeout: 30_000,
      });
      expect(
        await multiFrame.locator("#route-chips .tta-switcher-item-id").count()
      ).toBeGreaterThanOrEqual(2);
      await expect(multiFrame.locator("#route-chips .tta-chip")).toHaveCount(0);
    } else {
      console.log(
        "Skipping multi-route switcher assertion: fewer than 2 routes available in this Move Portal account"
      );
    }

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

    await expect(app.locator("#ui-hidden-indicator")).toBeVisible({ timeout: 30_000 });
    await expect(app.locator(".indicator-pill")).toContainText("Data processed");
    await expect(app.locator("html")).toHaveClass(/ui-hidden/);

    await verifyJsonResult(page);
  });
});
