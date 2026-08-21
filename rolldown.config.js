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

// rolldown.config.js
//
// Rolldown resolves node modules, mixed ESM/CJS graphs, JSON and TypeScript
// natively, so the @rollup/plugin-{node-resolve,commonjs,json,typescript}
// chain this config used to carry is gone. `platform: "node"` covers what
// node-resolve's `preferBuiltins`/`exportConditions: ["node"]` did. Type
// declarations still come from `tsc --emitDeclarationOnly` (the `build:ts`
// script); the bundler only transpiles.
import { defineConfig } from "rolldown";
import license from "rollup-plugin-license";

const sharedExternal = ["async_hooks"];

/** Input options shared by both entry points. */
const sharedInput = {
  platform: "node",
  tsconfig: "./tsconfig.json",
  plugins: [
    license({
      thirdParty: {
        output: { file: "./dist/THIRD_PARTY.txt" },
      },
    }),
  ],
};

/**
 * @param {string} name
 * @returns {import("rolldown").OutputOptions[]}
 */
const outputsFor = (name) => [
  {
    file: `dist/${name}.esm.js`,
    format: "es",
    sourcemap: true,
    codeSplitting: false,
  },
  {
    file: `dist/${name}.cjs.js`,
    format: "cjs",
    sourcemap: true,
    codeSplitting: false,
  },
];

export default defineConfig([
  // Stdio MCP server entry point
  {
    input: "src/index.ts",
    ...sharedInput,
    external: sharedExternal,
    output: outputsFor("index"),
  },
  // HTTP MCP server entry point
  {
    input: "src/indexHttp.ts",
    ...sharedInput,
    external: [...sharedExternal, "express", "cors", "http"],
    output: outputsFor("indexHttp"),
  },
]);
