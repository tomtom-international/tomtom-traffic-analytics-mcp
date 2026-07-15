/*
 * Copyright (C) 2025 TomTom Navigation B.V.
 * Licensed under the Apache License, Version 2.0
 */

/**
 * Circular direction-badge icon for approach lines: white ring, navy disc
 * (matches the junction circle fill #0a3653), white up-arrow. The up-arrow is
 * rotated onto the line direction by the symbol layer's `icon-rotate: 90`.
 */
const ARROW_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24">' +
  '<circle cx="12" cy="12" r="12" fill="#fff"/>' +
  '<circle cx="12" cy="12" r="10" fill="#0a3653"/>' +
  '<path fill="#fff" d="M7.4 12.271 12.2 7.4l4.8 4.871-1.68 1.705-1.92-1.947V17H11v-4.972l-1.92 1.948z"/>' +
  "</svg>";

/**
 * CustomGeoJSONModule's `images` config only accepts synchronous payloads —
 * decode the SVG into an HTMLImageElement before module creation.
 */
export async function loadArrowIcon(): Promise<HTMLImageElement> {
  const img = new Image(24, 24);
  img.src = `data:image/svg+xml;base64,${btoa(ARROW_SVG)}`;
  await img.decode();
  return img;
}
