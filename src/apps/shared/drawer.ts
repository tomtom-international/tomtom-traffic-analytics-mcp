/*
 * Copyright (C) 2025 TomTom Navigation B.V.
 * Licensed under the Apache License, Version 2.0
 */

import type { TomTomMap } from "@tomtom-org/maps-sdk/map";
import { el } from "./dom";

/**
 * Narrow-viewport breakpoint for the bottom-drawer layout (BP-A) — keep this
 * literal in sync with the `@media (max-width: 639.98px)` block in
 * app-shell.css.
 */
export const NARROW = "(max-width: 639.98px)";

/**
 * Structural subset of `MediaQueryList` — just the `matches` getter plus a
 * typed `"change"` listener. Kept structural rather than the DOM lib
 * `MediaQueryList`/`MediaQueryListEvent` types themselves because the
 * `src/apps/**` eslint globals allowlist doesn't include them (same pattern
 * as the MapLibre types in feature-state.ts). `initDrawer` returns its `mql`
 * typed this way so `initCollapsibleLegend` (Task 5) can share the exact
 * same `matchMedia` instance instead of each app registering a second one
 * for the same NARROW breakpoint.
 */
export interface NarrowMediaQuery {
  readonly matches: boolean;
  addEventListener(type: "change", listener: (query: { matches: boolean }) => void): void;
}

export interface InitDrawerOptions {
  /** DOM id of the `<aside class="tta-drawer">` side panel. */
  asideId: string;
  /** Returns the live map instance; `undefined` before the SDK map is created. */
  getMap: () => TomTomMap | undefined;
  /** Text shown on the peeking toggle handle, e.g. "Junctions". */
  handleLabel?: string;
}

export interface DrawerHandle {
  open(): void;
  close(): void;
  toggle(): void;
  isNarrow(): boolean;
  /** Shared NARROW `matchMedia` — pass to `initCollapsibleLegend` so the app registers one listener for the breakpoint, not two. */
  mql: NarrowMediaQuery;
}

/**
 * Wires the BP-A responsive bottom-drawer behavior onto a split-shell app's
 * side panel:
 * - Prepends a `.tta-drawer-handle` toggle button (peeking strip at narrow
 *   width; hidden at wide width via app-shell.css) as the aside's first child.
 * - Tracks open/closed via the `#app-root.drawer-open` class the BP-A CSS
 *   keys off of.
 * - Keeps MapLibre's canvas in sync: the drawer sliding in/out changes the
 *   map's rendered box, so every state change schedules a `resize()` on the
 *   underlying `mapLibreMap` (rAF-deferred so it runs after the CSS
 *   transform/transition has been applied).
 * - Defaults the drawer OPEN whenever the viewport crosses into narrow width,
 *   so a first-time narrow view isn't just an empty peeking handle.
 */
export function initDrawer(options: InitDrawerOptions): DrawerHandle {
  const { asideId, getMap, handleLabel } = options;

  const aside = el(asideId);
  const appRoot = el("app-root");

  const handle = document.createElement("button");
  handle.type = "button";
  handle.className = "tta-drawer-handle";
  handle.setAttribute("aria-expanded", "false");
  handle.setAttribute("aria-controls", asideId);
  handle.textContent = handleLabel ?? "";
  aside?.prepend(handle);

  const resizeMap = (): void => {
    requestAnimationFrame(() => getMap()?.mapLibreMap.resize());
  };

  const setOpen = (isOpen: boolean): void => {
    appRoot?.classList.toggle("drawer-open", isOpen);
    handle.setAttribute("aria-expanded", String(isOpen));
    resizeMap();
  };

  const open = (): void => setOpen(true);
  const close = (): void => setOpen(false);
  const toggle = (): void => setOpen(!(appRoot?.classList.contains("drawer-open") ?? false));

  handle.addEventListener("click", toggle);

  // Shared with the legend toggle (Task 5): a single NARROW breakpoint drives
  // both. Entering narrow width defaults the drawer open; leaving it is a
  // no-op for `drawer-open` (harmless — the class only matters under BP-A),
  // but the map still needs a resize either way since its box just changed.
  //
  // Typed structurally (not `MediaQueryList`/`MediaQueryListEvent`) so this
  // stays independent of which of the two fires the callback — both `mql`
  // itself (the initial call below) and its "change" event carry `.matches`.
  const mql = window.matchMedia(NARROW);
  const onNarrowChange = (query: { matches: boolean }): void => {
    if (query.matches) open();
    resizeMap();
  };
  mql.addEventListener("change", onNarrowChange);
  onNarrowChange(mql); // set initial state on init

  return { open, close, toggle, isNarrow: () => mql.matches, mql };
}

/**
 * Wires the focus-mode "collapsible legend" behavior (Task 5) onto a
 * `.legend` element in a split-shell app (junction-live's LOS scale,
 * route-details' speed ramp):
 * - Prepends a `.tta-legend-toggle` pill (`.tta-btn.tta-btn-pill` chrome,
 *   see controls.css) that toggles a `collapsed` class on the legend
 *   element; app-shell.css hides everything else inside `.legend` while
 *   collapsed.
 * - Shares the drawer's NARROW `mql` (pass `initDrawer(...).mql`) so the
 *   legend defaults collapsed exactly when the drawer defaults open — one
 *   `matchMedia` listener per app, not two.
 *
 * Safe to call every time the legend's content is (re-)rendered: the LOS/
 * ramp legend renderers replace the legend's `innerHTML` wholesale, which
 * wipes out any previously-prepended toggle. This function only creates a
 * new toggle when one isn't already present (i.e., after that wipe) and
 * re-syncs its `aria-expanded` from the `collapsed` class — which lives on
 * the legend element itself, not its children, so it survives the
 * `innerHTML` swap. The default-per-breakpoint and the `mql` "change"
 * listener are gated on a `data-legend-init` flag (also on the element
 * itself) so repeat calls never re-decide the default or double-register
 * the listener.
 */
export function initCollapsibleLegend(legendId: string, mql: NarrowMediaQuery): void {
  const legend = el(legendId);
  if (!legend) return;

  let toggle = legend.querySelector<HTMLButtonElement>(".tta-legend-toggle");
  if (!toggle) {
    toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "tta-btn tta-btn-pill tta-legend-toggle";
    toggle.textContent = "Legend";
    toggle.addEventListener("click", () => {
      const collapsed = legend.classList.toggle("collapsed");
      toggle?.setAttribute("aria-expanded", String(!collapsed));
    });
    legend.prepend(toggle);
  }
  toggle.setAttribute("aria-expanded", String(!legend.classList.contains("collapsed")));

  if (legend.dataset.legendInit === "true") return; // default + mql listener wired once
  legend.dataset.legendInit = "true";

  // Unlike the drawer's `drawer-open` (only meaningful under BP-A, so leaving
  // narrow is a harmless no-op there), `.legend.collapsed` applies at *every*
  // width by design (app-shell.css) — a wide view must default back to
  // expanded just as reliably as a narrow view defaults to collapsed. So this
  // mirrors the drawer's "force the default on a real breakpoint cross"
  // approach, made symmetric: force-collapse on entering narrow, force-EXPAND
  // on entering wide. `mql`'s "change" event only fires on an actual
  // breakpoint crossing (never on a same-width re-render), so a manual
  // toggle survives repeat `initCollapsibleLegend` calls at a stable width.
  const applyBreakpointDefault = (query: { matches: boolean }): void => {
    legend.classList.toggle("collapsed", query.matches);
    legend
      .querySelector<HTMLButtonElement>(".tta-legend-toggle")
      ?.setAttribute("aria-expanded", String(!query.matches));
  };
  mql.addEventListener("change", applyBreakpointDefault);
  applyBreakpointDefault(mql);
}
