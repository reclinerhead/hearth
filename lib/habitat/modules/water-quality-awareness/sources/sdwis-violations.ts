/**
 * EPA SDWIS VIOLATION REST client.
 *
 * Pulls the compliance/violation history for a single PWSID from EPA's
 * Envirofacts service. Same REST family as the WATER_SYSTEM endpoint in
 * sources/envirofacts.ts — path-encoded values, JSON-suffixed URL, no
 * auth. Returns an array of violation rows the system has ever incurred
 * (since 1993); an empty array is a meaningful positive signal (no
 * violations on file), not an error.
 *
 * Reference: https://www.epa.gov/enviro/envirofacts-data-service-api
 *
 * Endpoint shape:
 *   GET https://data.epa.gov/efservice/VIOLATION/PWSID/<pwsid>/JSON
 *
 * Mirrors the discipline established by sources/envirofacts.ts:
 * injectable fetch + timeout for tests, transient errors propagate (the
 * caller's soft-fail wrapper will catch and degrade the payload),
 * permanent errors return an empty array, every string field gets
 * trimmed and empty-string-coerced to null in a single pass.
 *
 * The two SDWIS clients (this file and sdwis-lcr-samples.ts) are
 * intentionally not deduplicated into a generic "fetch any SDWIS
 * table" abstraction. They're parallel data, not derived — the parsed
 * field lists differ entirely and the consumers (compliance.ts vs
 * lcr.ts) want different normalized shapes. Two ~100-line files read
 * cleaner than one abstraction that has to be re-read every time.
 */

/**
 * Subset of fields the compliance summarizer reads. The full
 * Envirofacts row carries every column from EPA's VIOLATION table
 * (around 50 fields); everything else is preserved on the raw payload
 * for future widening.
 */
export type SdwisViolationRecord = {
  pwsid: string;
  violation_id: string;
  violation_code?: string | null;
  violation_category_code?: string | null;
  // 'Y' for health-based MCL exceedances and treatment-technique
  // failures, 'N' for monitoring/reporting violations.
  is_health_based_ind?: string | null;
  contaminant_code?: string | null;
  // ISO timestamps. Envirofacts returns them as
  // "YYYY-MM-DD HH:mm:ss" — kept as strings so we don't lose the
  // original format. The summarizer parses with new Date() when it
  // needs to compare windows.
  compl_per_begin_date?: string | null;
  compl_per_end_date?: string | null;
  viol_first_reported_date?: string | null;
  rtc_date?: string | null;
  is_major_viol_ind?: string | null;
  viol_measure?: number | null;
  unit_of_measure?: string | null;
  federal_mcl?: string | null;
  [key: string]: unknown;
};

const ENVIROFACTS_VIOLATION_URL = "https://data.epa.gov/efservice/VIOLATION";

const DEFAULT_TIMEOUT_MS = 20_000;

/**
 * Build the URL Envirofacts uses to filter VIOLATION rows on a single
 * PWSID. Exported so the activity log can cite the URL verbatim.
 */
export function buildViolationsUrl(pwsid: string): string {
  const normalized = pwsid.trim().toUpperCase();
  return `${ENVIROFACTS_VIOLATION_URL}/PWSID/${encodeURIComponent(normalized)}/JSON`;
}

/**
 * Options. fetchImpl + timeout are injectable so the test suite can
 * substitute deterministic responses without monkey-patching globals.
 */
export type FetchViolationsOptions = {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
};

/**
 * Fetch every VIOLATION row Envirofacts has for a single PWSID.
 *
 * Returns the normalized records, the raw payload (for raw_payload
 * persistence), and the URL the module hit. An empty array is a
 * legitimate response — a system with zero violations on file. The
 * compliance summarizer treats that as "no_active_violations".
 *
 * Throws on transient or shape errors so the orchestrator's soft-fail
 * wrapper can record a failure step in the activity log and degrade
 * compliance_status_short to "unknown" without aborting the entire
 * module check.
 */
export async function fetchViolations(
  pwsid: string,
  options: FetchViolationsOptions = {},
): Promise<{
  records: SdwisViolationRecord[];
  rawPayload: unknown;
  sourceUrl: string;
}> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const url = buildViolationsUrl(pwsid);

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
        `EPA SDWIS VIOLATION request timed out after ${timeoutMs}ms`,
      );
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    throw new Error(
      `EPA SDWIS VIOLATION request failed with HTTP ${response.status}`,
    );
  }

  const payload: unknown = await response.json();
  if (!Array.isArray(payload)) {
    throw new Error(
      "EPA SDWIS VIOLATION returned an unexpected response shape (expected an array)",
    );
  }

  const records: SdwisViolationRecord[] = [];
  for (const row of payload) {
    if (!row || typeof row !== "object") continue;
    const normalized = normalizeViolation(row as Record<string, unknown>);
    if (
      typeof normalized.pwsid === "string" &&
      typeof normalized.violation_id === "string" &&
      normalized.violation_id.length > 0
    ) {
      records.push(normalized);
    }
  }

  return { records, rawPayload: payload, sourceUrl: url };
}

/**
 * Trim string values, coerce empty strings to null, coerce numeric-
 * looking strings on the few numeric columns the caller reads. Exported
 * for the test suite.
 *
 * `viol_measure` is the one column we coerce from string-to-number —
 * Envirofacts occasionally returns it as a string with a decimal point.
 * Anything that doesn't parse cleanly stays null and the summarizer
 * treats the row as a non-measured violation.
 */
export function normalizeViolation(
  record: Record<string, unknown>,
): SdwisViolationRecord {
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
  if (typeof out.viol_measure === "string") {
    const parsed = Number(out.viol_measure);
    out.viol_measure = Number.isFinite(parsed) ? parsed : null;
  }
  return out as SdwisViolationRecord;
}
