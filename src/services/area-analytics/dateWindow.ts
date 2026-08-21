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
 * Area Analytics has a processing delay, so a request whose `endDate` is too
 * recent fails with `400 data not present`.
 *
 * This was documented twice — a "Date constraint" block in the tool description
 * and again on the `endDate` schema — and a model still asked for data up to
 * today and got the 400. Roughly 110 tokens of prose failed to prevent the error
 * they were written for, so the rule is enforced here instead: the window is
 * clamped to what the API can answer and the caller is told, in
 * `metadata.warnings`, that it happened.
 *
 * Clamping rather than rejecting because a 29-day answer is more use than an
 * error, and disclosing it rather than clamping silently because "trends for the
 * last month" quietly answered for a different month is the kind of wrong that
 * looks right.
 */

/** Days of processing delay, with no feature timezone set (the API defaults to UTC). */
const DELAY_DAYS_UTC = 2;

/**
 * Days of delay once a feature carries `properties.timezone`. The API applies a
 * stricter rule in that case, so the safe latest date moves back another day.
 */
const DELAY_DAYS_WITH_TIMEZONE = 3;

export interface DateWindowAdjustment {
  endDate: string;
  /** Present only when the request was altered; goes straight into the response warnings. */
  warning?: string;
}

/** `YYYY-MM-DD` for a date, in UTC — the calendar the API's dates are expressed in. */
function toIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * The most recent `endDate` the API can serve today.
 *
 * `now` is a parameter so this is testable without freezing the clock.
 */
export function latestAvailableEndDate(
  hasFeatureTimezone: boolean,
  now: Date = new Date()
): string {
  const delay = hasFeatureTimezone ? DELAY_DAYS_WITH_TIMEZONE : DELAY_DAYS_UTC;
  const latest = new Date(now.getTime());
  latest.setUTCDate(latest.getUTCDate() - delay);
  return toIsoDate(latest);
}

/** True when any feature in the request sets a timezone, which tightens the rule. */
export function hasFeatureTimezone(features: unknown): boolean {
  if (!Array.isArray(features)) return false;
  return features.some((feature) => {
    const properties = (feature as { properties?: Record<string, unknown> } | null)?.properties;
    const timezone = properties?.timezone;
    return typeof timezone === "string" && timezone.trim().length > 0;
  });
}

/**
 * Clamp `endDate` to the latest date the API can answer for.
 *
 * Returns the date unchanged, and no warning, when it is already in range or
 * unparseable — a malformed date is the API's error to report, not ours to
 * silently rewrite into a valid one.
 */
export function clampEndDate(
  endDate: string | undefined,
  features: unknown,
  now: Date = new Date()
): DateWindowAdjustment {
  if (!endDate || !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) {
    return { endDate: endDate as string };
  }

  const latest = latestAvailableEndDate(hasFeatureTimezone(features), now);
  if (endDate <= latest) return { endDate };

  return {
    endDate: latest,
    warning:
      `endDate ${endDate} is inside the Area Analytics processing delay, so it was clamped to ` +
      `${latest} (the most recent date with data). Results cover up to ${latest}, not ${endDate}.`,
  };
}
