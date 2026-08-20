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
 * Azure OpenAI model resolution for the tool-selection eval.
 *
 * Deliberately a port of the agent-toolkit's `testing/agent-tool-calling/src/model.ts`
 * so both repositories read the same environment and test against the same
 * deployments. Keep the two in step: the point of matching them is that a
 * routing result here means the same thing as a routing result there.
 *
 * Returns an EMPTY list when credentials are absent so callers can skip rather
 * than fail, which keeps the eval a no-op for contributors without Azure access.
 */

import { createAzure } from "@ai-sdk/azure";

/**
 * Tested against MULTIPLE deployments, so a prompt that routes correctly on one
 * model cannot silently regress on another. The list comes from the same
 * variables the demo apps use: AZURE_MODEL_IDS (comma-separated, takes
 * precedence) or the single AZURE_DEPLOYMENT_ID.
 */
const DEFAULT_DEPLOYMENTS = ["gpt-5.1", "gpt-4.1"];

/**
 * Reads the Azure credentials. Returns null when nothing is configured, but
 * throws when the configuration is half-present — a missing half is a mistake
 * worth surfacing, whereas an empty environment is a legitimate skip.
 */
export function resolveAzureConfig() {
  const resourceName = process.env.AZURE_RESOURCE_NAME;
  const apiKey = process.env.AZURE_API_KEY;
  const apiVersion = process.env.AZURE_API_VERSION;
  if (!resourceName && !apiKey) return null;
  if (!apiKey) throw new Error("AZURE_API_KEY is required to run the eval.");
  if (!resourceName) throw new Error("AZURE_RESOURCE_NAME is required to run the eval.");
  return { resourceName, apiKey, apiVersion };
}

/** Deployment names to evaluate: AZURE_MODEL_IDS, then AZURE_DEPLOYMENT_ID, then the default pair. */
export function resolveDeploymentIds(override) {
  const raw = override ?? process.env.AZURE_MODEL_IDS ?? process.env.AZURE_DEPLOYMENT_ID ?? "";
  const ids = raw
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);
  return ids.length ? ids : DEFAULT_DEPLOYMENTS;
}

/**
 * One `{ id, model }` per configured deployment, or an empty list when no
 * credentials are present.
 *
 * `provider.chat(id)` rather than `provider(id)`: the bare call resolves to the
 * Responses API, and the agent-toolkit suites pin the chat completions API.
 */
export function resolveAzureModels(deploymentOverride) {
  const config = resolveAzureConfig();
  if (!config) return [];
  const provider = createAzure({
    resourceName: config.resourceName,
    apiKey: config.apiKey,
    apiVersion: config.apiVersion,
  });
  return resolveDeploymentIds(deploymentOverride).map((id) => ({
    id,
    model: provider.chat(id),
  }));
}
