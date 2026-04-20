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

// rollup.config.js
import resolve from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';
import json from '@rollup/plugin-json';
import typescript from '@rollup/plugin-typescript';
import license from 'rollup-plugin-license';

const stdioEntryPoint = 'src/index.ts';

const sharedPlugins = [
  resolve({
    preferBuiltins: true,
    exportConditions: ['node']
  }),
  commonjs(),
  json(),
  typescript({
    tsconfig: './tsconfig.json'
  }),
  license({
    thirdParty: {
      output: { file: './dist/THIRD_PARTY.txt' },
    },
  })
];

const sharedExternal = [
  '@duckdb/node-api',
  '@duckdb/node-bindings',
  /^@duckdb\/node-bindings-/,  // All platform-specific bindings
  'async_hooks',
];

/** @type {import('rollup').RollupOptions[]} */
export default [
  // Stdio MCP server entry point
  {
    input: stdioEntryPoint,
    output: [
      {
        file: 'dist/index.esm.js',
        format: 'es',
        sourcemap: true
      },
      {
        file: 'dist/index.cjs.js',
        format: 'cjs',
        sourcemap: true
      }
    ],
    external: sharedExternal,
    plugins: sharedPlugins
  },
  // HTTP MCP server entry point
  {
    input: 'src/indexHttp.ts',
    output: [
      {
        file: 'dist/indexHttp.esm.js',
        format: 'es',
        sourcemap: true,
        inlineDynamicImports: true
      },
      {
        file: 'dist/indexHttp.cjs.js',
        format: 'cjs',
        sourcemap: true,
        inlineDynamicImports: true
      }
    ],
    external: [
      ...sharedExternal,
      'express',
      'cors',
      'http',
    ],
    plugins: sharedPlugins
  }
];
