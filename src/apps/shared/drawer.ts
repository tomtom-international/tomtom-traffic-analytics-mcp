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

  return { open, close, toggle, isNarrow: () => mql.matches };
}
