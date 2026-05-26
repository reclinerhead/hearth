/**
 * EPA SDWIS LCR_SAMPLE_RESULT REST client.
 *
 * Pulls the Lead and Copper Rule 90th-percentile sampling-period
 * summaries for a single PWSID from EPA's Envirofacts service. Same
 * REST family as sources/envirofacts.ts and sources/sdwis-violations.ts
 * — path-encoded values, JSON-suffixed URL, no auth.
 *
 * These are *system-level rollups*, not individual home samples. A
 * single PWSID may have a handful of sample periods rolled up over a
 * decade because EPA's monitoring schedule rotates systems through the
 * sampling pool. An empty array is common and meaningful — the
 * summarizer reports "no_samples_on_file" rather than treating it as
 * an error.
 *
 * Reference: https://www.epa.gov/enviro/envirofacts-data-service-api
 *
 * Endpoint shape:
 *   GET https://data.epa.gov/efservice/LCR_SAMPLE_RESULT/PWSID/<pwsid>/JSON
 *
 * Same testing + soft-fail discipline as the violations client.
 */

/**
 * Subset of fields the LCR summarizer reads. Other columns Envirofacts
 * returns (sample sequencing metadata, regulatory citation codes) are
 * preserved on the raw payload alone.
 */
export type SdwisLcrSampleRecord = {
  pwsid: string;
  sample_id: string;
  // '5000' = lead, '1022' = copper. The summarizer routes on this code
  // to decide which threshold to apply.
  contaminant_code?: string | null;
  sampling_start_date?: string | null;
  sampling_end_date?: string | null;
  // The 90th-percentile measure. Already a number on most rows;
  // Envirofacts occasionally serializes it as a string with a decimal
  // point and the normalizer coerces those.
  sample_measure?: number | null;
  // Typically "MG/L" for both lead and copper. Preserved verbatim so
  // unit-translation mistakes never silently rescale a value.
  unit_of_measure?: string | null;
  // '<' below detection, '=' measured, '>' above quantitation.
  result_sign_code?: string | null;
  [key: string]: unknown;
};

const ENVIROFACTS_LCR_URL = "https://data.epa.gov/efservice/LCR_SAMPLE_RESULT";

const DEFAULT_TIMEOUT_MS = 20_000;

/**
 * Build the URL Envirofacts uses to filter LCR_SAMPLE_RESULT rows on
 * a single PWSID. Exported for the activity log.
 */
export function buildLcrSamplesUrl(pwsid: string): string {
  const normalized = pwsid.trim().toUpperCase();
  return `${ENVIROFACTS_LCR_URL}/PWSID/${encodeURIComponent(normalized)}/JSON`;
}

export type FetchLcrSamplesOptions = {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
};

/**
 * Fetch every LCR_SAMPLE_RESULT row Envirofacts has for a single
 * PWSID. Returns the normalized records, the raw payload, and the
 * URL. Same throw-on-transient / soft-fail-at-caller discipline as
 * fetchViolations.
 */
export async function fetchLcrSamples(
  pwsid: string,
  options: FetchLcrSamplesOptions = {},
): Promise<{
  records: SdwisLcrSampleRecord[];
  rawPayload: unknown;
  sourceUrl: string;
}> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const url = buildLcrSamplesUrl(pwsid);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let response: Response;
  try {
    response = await fetchImpl(url, {
      signal: controller.signal,
      headers: { Accept: "application/json" },
    });
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new Error(
        `EPA SDWIS LCR_SAMPLE_RESULT request timed out after ${timeoutMs}ms`,
      );
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    throw new Error(
      `EPA SDWIS LCR_SAMPLE_RESULT request failed with HTTP ${response.status}`,
    );
  }

  const payload: unknown = await response.json();
  if (!Array.isArray(payload)) {
    throw new Error(
      "EPA SDWIS LCR_SAMPLE_RESULT returned an unexpected response shape (expected an array)",
    );
  }

  const records: SdwisLcrSampleRecord[] = [];
  for (const row of payload) {
    if (!row || typeof row !== "object") continue;
    const normalized = normalizeLcrSample(row as Record<string, unknown>);
    if (
      typeof normalized.pwsid === "string" &&
      typeof normalized.sample_id === "string" &&
      normalized.sample_id.length > 0
    ) {
      records.push(normalized);
    }
  }

  return { records, rawPayload: payload, sourceUrl: url };
}

/**
 * Trim strings, coerce empty-string → null, coerce sample_measure to
 * number when Envirofacts serialized it as a string. Exported for the
 * test suite.
 */
export function normalizeLcrSample(
  record: Record<string, unknown>,
): SdwisLcrSampleRecord {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) {
    if (typeof value === "string") {
      const trimmed = value.trim();
      out[key] = trimmed.length === 0 ? null : trimmed;
    } else {
      out[key] = value;
    }
  }
  if (typeof out.pwsid === "string") {
    out.pwsid = (out.pwsid as string).toUpperCase();
  }
  if (typeof out.sample_measure === "string") {
    const parsed = Number(out.sample_measure);
    out.sample_measure = Number.isFinite(parsed) ? parsed : null;
  }
  return out as SdwisLcrSampleRecord;
}
