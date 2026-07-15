/*
 * Copyright (C) 2025 TomTom Navigation B.V.
 * Licensed under the Apache License, Version 2.0
 */

import { describe, it, expect } from "vitest";
import { escapeHtml } from "./dom";

describe("escapeHtml", () => {
  it("escapes all HTML-significant characters", () => {
    expect(escapeHtml(`<img src=x onerror="alert('xss')">&`)).toBe(
      "&lt;img src=x onerror=&quot;alert(&#39;xss&#39;)&quot;&gt;&amp;"
    );
  });
  it("passes plain text through unchanged", () => {
    expect(escapeHtml("A10 → Amsterdam")).toBe("A10 → Amsterdam");
  });
  it("handles the empty string", () => {
    expect(escapeHtml("")).toBe("");
  });
});
