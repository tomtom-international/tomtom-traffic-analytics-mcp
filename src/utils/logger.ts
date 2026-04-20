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
 * Logger utility for the MCP server
 * Memory-efficient and JSON-RPC compatible logging implementation
 * No colors by default for clean output in all modes
 */

// Colors are always disabled by default for clean, consistent output
// This ensures JSON-RPC compatibility in all modes
const _useColors = false;

// Empty color codes - we don't use colors by default
const _colors = {
  timestamp: "",
  info: "",
  error: "",
  warn: "",
  debug: "",
  reset: "",
};

// CWE-117 mitigation: inline CR/LF stripping at every sink.
// Veracode pipeline scan does not always recognize custom-function sanitizers,
// so the replacement is kept inline and explicit. Policy-level compliance is
// maintained via mitigations in the Veracode platform.
export const logger = {
  info: (msg: string): void => {
    const timestamp = new Date().toISOString();
    const clean = msg.replace(/\r/g, " ").replace(/\n/g, " ");
    console.error(`[${timestamp}] [INFO]: ${clean}`);
  },

  error: (msg: string): void => {
    const timestamp = new Date().toISOString();
    const clean = msg.replace(/\r/g, " ").replace(/\n/g, " ");
    console.error(`[${timestamp}] [ERROR]: ${clean}`);
  },

  warn: (msg: string): void => {
    const timestamp = new Date().toISOString();
    const clean = msg.replace(/\r/g, " ").replace(/\n/g, " ");
    console.error(`[${timestamp}] [WARN]: ${clean}`);
  },

  debug: (msg: string): void => {
    const timestamp = new Date().toISOString();
    const clean = msg.replace(/\r/g, " ").replace(/\n/g, " ");
    console.error(`[${timestamp}] [DEBUG]: ${clean}`);
  },
};
