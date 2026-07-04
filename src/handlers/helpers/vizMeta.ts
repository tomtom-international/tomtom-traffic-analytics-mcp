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

import { logger } from "../../utils/logger";
import { storeVizData } from "../../services/cache/vizCache";

export interface VizMeta {
  show_ui: boolean;
  viz_id?: string;
}

/**
 * Caches a raw API payload for the MCP App to render and returns the `_meta`
 * block for the tool response. One code path for all handlers: skips caching
 * when the caller disabled the UI, and degrades to `show_ui: false` (logged)
 * when the cache write fails so the text/SQL response is never blocked by
 * visualization plumbing.
 *
 * @param show_ui - The tool's `show_ui` parameter (undefined = enabled)
 * @param label - Human label for the failure log, e.g. "route search"
 * @param buildPayload - Lazily builds the payload; not called when disabled
 */
export function buildVizMeta(
  show_ui: boolean | undefined,
  label: string,
  buildPayload: () => unknown
): VizMeta {
  if (show_ui === false) {
    return { show_ui: false };
  }
  try {
    return { show_ui: true, viz_id: storeVizData(buildPayload()) };
  } catch (error) {
    logger.error(`Failed to cache ${label} viz payload: ${(error as Error).message}`);
    return { show_ui: false };
  }
}
