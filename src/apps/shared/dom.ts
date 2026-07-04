/*
 * Copyright (C) 2025 TomTom Navigation B.V.
 * Licensed under the Apache License, Version 2.0
 */

/** Shorthand for `document.getElementById` with a typed cast. */
export function el<T extends HTMLElement = HTMLElement>(id: string): T | null {
  return document.getElementById(id) as T | null;
}

/** Hides the `#waiting-state` splash shown while the tool call is in flight. */
export function hideWaiting(): void {
  el("waiting-state")?.classList.add("hidden");
}

/** Empties an element's HTML and hides it (panel reset between tool calls). */
export function clearAndHide(id: string): void {
  const node = el(id);
  if (!node) return;
  node.innerHTML = "";
  node.classList.add("hidden");
}

const HTML_ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

/**
 * Escapes text for interpolation into innerHTML template strings.
 * Pure string implementation (no DOM element) so it is unit-testable in the
 * node vitest environment.
 */
export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => HTML_ESCAPES[c]);
}
