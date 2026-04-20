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

import { movePortalAPIClient, validateMovePortalApiKey } from "../base/tomtomClient";
import { handleApiError } from "../../utils/errorHandler";
import { logger } from "../../utils/logger";
import { AreaAnalyticsStatsRequest, AreaAnalyticsStatsResponse } from "./types";

/**
 * Get quick Area Analytics stats (lite version)
 */
export async function getAreaAnalyticsStats(
  request: AreaAnalyticsStatsRequest
): Promise<AreaAnalyticsStatsResponse> {
  try {
    validateMovePortalApiKey();
    logger.info("Getting Area Analytics stats (lite version)");
    logger.info(`Request body being sent to API: ${JSON.stringify(request, null, 2)}`);

    const response = await movePortalAPIClient.post("/areaanalytics/reports/lite", request, {
      headers: {
        "Content-Type": "application/json",
      },
    });

    logger.info(`Area Analytics stats retrieved successfully`);
    return response.data;
  } catch (error) {
    throw handleApiError(error, "getAreaAnalyticsStats");
  }
}
