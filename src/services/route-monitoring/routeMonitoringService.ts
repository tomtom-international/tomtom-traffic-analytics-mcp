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
import { RouteBasicInfo, RouteDetailedInfo } from "./types";

const API_VERSION = 3;

/**
 * Get list of all routes
 */
export async function getRoutes(): Promise<RouteBasicInfo[]> {
  try {
    validateMovePortalApiKey();
    logger.info("Fetching all routes");

    const response = await movePortalAPIClient.get(`/routemonitoring/${API_VERSION}/routes`);

    logger.info(`Retrieved ${response.data.length} routes`);
    return response.data;
  } catch (error) {
    throw handleApiError(error, "getRoutes");
  }
}

/**
 * Get detailed information for a specific route including segments
 */
export async function getRouteDetails(routeId: string): Promise<RouteDetailedInfo> {
  try {
    validateMovePortalApiKey();
    logger.info(`Fetching detailed route information: ${routeId}`);

    const response = await movePortalAPIClient.get(
      `/routemonitoring/${API_VERSION}/routes/${routeId}/details`
    );

    logger.info(`Route details retrieved successfully: ${routeId}`);
    return response.data;
  } catch (error) {
    throw handleApiError(error, "getRouteDetails");
  }
}
