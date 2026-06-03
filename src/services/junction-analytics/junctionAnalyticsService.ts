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
import {
  JunctionDefinition,
  JunctionDefinitionListResponse,
  JunctionLiveData,
  JunctionArchiveJsonResponse,
  BaseJunctionOptions,
  PaginationOptions,
  DateRangeOptions,
} from "./types";

const API_VERSION = 1;

/**
 * Get list of junction definitions
 */
export async function getJunctionDefinitionList(
  options: PaginationOptions & BaseJunctionOptions = {}
): Promise<JunctionDefinitionListResponse> {
  try {
    validateMovePortalApiKey();
    logger.info("Fetching junction definition list");

    const params: Record<string, any> = {};
    if (options.page !== undefined) params.page = options.page;
    if (options.size !== undefined) params.size = options.size;
    if (options.includeGeometry !== undefined) {
      params.includeGeometry = options.includeGeometry;
    }

    const response = await movePortalAPIClient.get(
      `/junction-analytics/junctions/${API_VERSION}/definition`,
      { params }
    );

    logger.info(`Retrieved ${response.data.numberOfElements} junction definitions`);
    return response.data;
  } catch (error) {
    throw handleApiError(error, "getJunctionDefinitionList");
  }
}

/**
 * Fetch ALL junction definitions by auto-paginating.
 * Fetches page 0 with max size, reads totalPages, fetches remaining pages in parallel.
 *
 * Forwards `options` (currently `includeGeometry`) to every page. The Move Portal
 * list endpoint omits the `junctionModel` field — and therefore countryCode,
 * trafficLights, approaches, exits — unless `includeGeometry=true` is set.
 * Callers that need any of those metadata fields populated must pass it.
 */
export async function getAllJunctionDefinitions(
  options: BaseJunctionOptions = {}
): Promise<JunctionDefinition[]> {
  try {
    validateMovePortalApiKey();
    logger.info("Fetching all junction definitions (auto-paginating)");

    // Fetch first page with max page size
    const firstPage = await getJunctionDefinitionList({ page: 0, size: 1000, ...options });
    const allJunctions: JunctionDefinition[] = [...firstPage.content];
    const totalPages = firstPage.totalPages;

    logger.info(
      `Junction definitions: page 0 fetched (${firstPage.numberOfElements} items), ` +
        `${firstPage.totalElements} total across ${totalPages} pages`
    );

    // Fetch remaining pages in parallel
    if (totalPages > 1) {
      const remainingPages = Array.from({ length: totalPages - 1 }, (_, i) => i + 1);

      const pageResults = await Promise.all(
        remainingPages.map((page) => getJunctionDefinitionList({ page, size: 1000, ...options }))
      );

      for (const pageResult of pageResults) {
        allJunctions.push(...pageResult.content);
      }
    }

    logger.info(`All junction definitions fetched: ${allJunctions.length} total`);
    return allJunctions;
  } catch (error) {
    throw handleApiError(error, "getAllJunctionDefinitions");
  }
}

/**
 * Get junction live data details
 */
export async function getJunctionLiveData(
  junctionId: string,
  options: BaseJunctionOptions = {}
): Promise<JunctionLiveData> {
  try {
    validateMovePortalApiKey();
    logger.info(`Fetching junction live data: ${junctionId}`);

    const params: Record<string, any> = {};
    if (options.includeGeometry !== undefined) {
      params.includeGeometry = options.includeGeometry;
    }

    const response = await movePortalAPIClient.get(
      `/junction-analytics/junctions/${API_VERSION}/${junctionId}/live-data`,
      { params }
    );

    logger.info(`Junction live data retrieved successfully: ${junctionId}`);
    return response.data;
  } catch (error) {
    throw handleApiError(error, "getJunctionLiveData");
  }
}

/**
 * Get junction archive data (returns JSON data)
 */
export async function getJunctionArchive(
  junctionId: string,
  options: DateRangeOptions
): Promise<JunctionArchiveJsonResponse> {
  try {
    validateMovePortalApiKey();
    logger.info(`Fetching junction archive: ${junctionId}`);

    const params: Record<string, any> = {
      from: options.from,
    };
    if (options.to) params.to = options.to;

    const response = await movePortalAPIClient.get(
      `/junction-analytics/junctions/${API_VERSION}/archive/json/${junctionId}/data/flat/daily`,
      { params }
    );

    logger.info(`Junction archive retrieved successfully: ${junctionId}`);
    return response.data;
  } catch (error) {
    throw handleApiError(error, "getJunctionArchive");
  }
}
