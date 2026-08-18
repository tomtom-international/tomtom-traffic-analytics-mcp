#!/usr/bin/env node
/*
 * Copyright (C) 2025 TomTom NV
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/**
 * Bundles the geospatial libraries that are injected into the QuickJS sandbox.
 *
 * The sandbox has no module loader and no filesystem, so each library has to
 * arrive as a single self-contained IIFE that can be handed to evalCode(). The
 * bundles are vendored into src/query/vendor as base64 string constants so that
 * rolldown inlines them into dist/ — the server must not read them from disk at
 * runtime, otherwise the MCPB bundle would need side files again.
 *
 * Run: node scripts/build-sandbox-libs.mjs
 */

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const VENDOR_DIR = path.join(PROJECT_ROOT, "src", "query", "vendor");
const TMP_DIR = path.join(PROJECT_ROOT, "node_modules", ".cache", "sandbox-libs");

const LIBS = [
  { package: "@turf/turf", global: "turf", constant: "TURF_BUNDLE_BASE64", file: "turfBundle.ts" },
  { package: "h3-js", global: "h3", constant: "H3_BUNDLE_BASE64", file: "h3Bundle.ts" },
];

const LICENSE_HEADER = `/*
 * Copyright (C) 2025 TomTom NV
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
`;

fs.mkdirSync(TMP_DIR, { recursive: true });
fs.mkdirSync(VENDOR_DIR, { recursive: true });

for (const lib of LIBS) {
  const entry = path.join(TMP_DIR, `${lib.global}-entry.js`);
  const out = path.join(TMP_DIR, `${lib.global}.iife.js`);
  fs.writeFileSync(entry, `export * from ${JSON.stringify(lib.package)};\n`);

  execFileSync(
    path.join(PROJECT_ROOT, "node_modules", ".bin", "rolldown"),
    [entry, "--format", "iife", "--name", lib.global, "--minify", "-o", out],
    { stdio: "inherit", cwd: PROJECT_ROOT }
  );

  const source = fs.readFileSync(out, "utf8");
  const base64 = Buffer.from(source, "utf8").toString("base64");
  const version = JSON.parse(
    fs.readFileSync(path.join(PROJECT_ROOT, "node_modules", lib.package, "package.json"), "utf8")
  ).version;

  const contents = `${LICENSE_HEADER}
/**
 * ${lib.package}@${version} bundled as a single IIFE that defines globalThis.${lib.global}.
 *
 * GENERATED FILE — do not edit. Regenerate with: node scripts/build-sandbox-libs.mjs
 * Stored base64-encoded so the minified source cannot collide with TypeScript
 * string escaping, and so rolldown inlines it into the dist bundle.
 */
export const ${lib.constant} =
  "${base64}";
`;
  fs.writeFileSync(path.join(VENDOR_DIR, lib.file), contents);
  console.log(
    `  ✓ ${lib.package}@${version} → src/query/vendor/${lib.file} ` +
      `(${(source.length / 1024).toFixed(0)} KB source, ${(base64.length / 1024).toFixed(0)} KB base64)`
  );
}
