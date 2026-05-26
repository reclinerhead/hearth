/**
 * EPA Envirofacts WATER_SYSTEM REST client.
 *
 * Hits the public Envirofacts REST endpoint to fetch the full WATER_SYSTEM
 * inventory record for a single PWSID. No auth. Used by WQA-1 to populate
 * the hearth.water_systems shared cache after the CWS Service Areas layer
 * resolves an address to a PWSID.
 *
 * The endpoint returns a JSON array with the single matching row (or an
 * empty array when EPA has no record of the PWSID — which is the
 * canonical "stale data" signal for the branch logic). Many fields in
 * the response are EPA-internal compliance scheduling metadata we don't
 * persist (DBPR/LT2 schedule codes, NPM candidate flags, etc.); the
 * full payload still flows into hearth.water_systems.raw_payload so
 * future column additions don't require re-fetching.
 *
 * Reference: https://www.epa.gov/enviro/envirofacts-data-service-api
 *
 * Endpoint shape:
 *   GET https://data.epa.gov/efservice/WATER_SYSTEM/PWSID/<pwsid>/JSON
 *
 * Same fetch + timeout + error-handling discipline as the CWS Service
 * Areas client. Transient (network / 5xx / timeout) errors propagate so
 * the orchestrator can mark the finding 'failed' and retry on cadence;
 * a 200 with an empty array is a permanent "no record" signal the
 * branch logic translates into the 'stale' branch.
 */

/**
 * Subset of fields the module reads from the Envirofacts response. The
 * full response carries every column from EPA's WATER_SYSTEM table; the
 * unrecognized keys are preserved on the raw_payload column rather than
 * widened into this type as they become useful.
 *
 * All optional fields can come back as null or empty string from
 * Envirofacts — the cache layer normalizes empty strings to null before
 * persisting so downstream copy ("Email at <empty>") doesn't render
 * holes.
 */
export type EnvirofactsWaterSystemRecord = {
  pwsid: string;
  pws_name: string;
  primacy_agency_code?: string | null;
  epa_region?: string | null;
  pws_activity_code: string;
  pws_deactivation_date?: string | null;
  pws_type_code: string;
  gw_sw_code?: string | null;
  primary_source_code?: string | null;
  owner_type_code?: string | null;
  population_served_count?: number | null;
  service_connections_count?: number | null;
  is_school_or_daycare_ind?: string | null;
  submission_status_code?: string | null;
  org_name?: string | null;
  admin_name?: string | null;
  email_addr?: string | null;
  phone_number?: string | null;
  address_line1?: string | null;
  address_line2?: string | null;
  city_name?: string | null;
  zip_code?: string | null;
  state_code?: string | null;
  source_water_protection_code?: string | null;
  source_protection_begin_date?: string | null;
  // Any other fields Envirofacts publishes are preserved in raw_payload
  // via index access on the parent record; not modeled here.
  [key: string]: unknown;
};

const ENVIROFACTS_BASE_URL = "https://data.epa.gov/efservice/WATER_SYSTEM";

const DEFAULT_TIMEOUT_MS = 20_000;

/**
 * Build the Envirofacts WATER_SYSTEM query URL for a single PWSID.
 * Exported so the activity log and the persistence layer can cite the
 * exact URL the row was fetched from.
 *
 * Envirofacts URLs are path-encoded rather than query-encoded — the
 * pattern is /<TABLE>/<COLUMN>/<VALUE>/JSON. PWSID is normalized to
 * uppercase before encoding so a casing variation in the input doesn't
 * spawn a separate row in the shared cache.
 */
export function buildWaterSystemUrl(pwsid: string): string {
  const normalized = pwsid.trim().toUpperCase();
  return `${ENVIROFACTS_BASE_URL}/PWSID/${encodeURIComponent(normalized)}/JSON`;
}

/**
 * Options for fetchWaterSystem. Injectable fetch + timeout for tests.
 */
export type FetchWaterSystemOptions = {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
};

/**
 * Fetch the WATER_SYSTEM record for a single PWSID.
 *
 * Returns null when Envirofacts has no row for the PWSID (the 200-with-
 * empty-array case). The caller maps null to the 'stale' branch. Throws
 * on transient or shape errors so the orchestrator can fail the finding
 * and retry on cadence.
 *
 * Soft-trims string fields and coerces empty strings to null in a
 * single pass to make downstream copy ("Email at " + record.email_addr)
 * safe without scattering ?? null fallbacks at every read site.
 */
export async function fetchWaterSystem(
  pwsid: string,
  options: FetchWaterSystemOptions = {},
): Promise<{
  record: EnvirofactsWaterSystemRecord | null;
  rawPayload: unknown;
  sourceUrl: string;
}> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const url = buildWaterSystemUrl(pwsid);

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
        `EPA Envirofacts WATER_SYSTEM request timed out after ${timeoutMs}ms`,
      );
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    throw new Error(
      `EPA Envirofacts WATER_SYSTEM request failed with HTTP ${response.status}`,
    );
  }

  const payload: unknown = await response.json();
  if (!Array.isArray(payload)) {
    throw new Error(
      "EPA Envirofacts returned an unexpected response shape (expected an array)",
    );
  }

  if (payload.length === 0) {
    return { record: null, rawPayload: payload, sourceUrl: url };
  }

  const first = payload[0];
  if (!first || typeof first !== "object") {
    throw new Error(
      "EPA Envirofacts returned an unexpected response shape (expected an object inside the array)",
    );
  }

  const normalized = normalizeRecord(first as Record<string, unknown>);

  if (typeof normalized.pwsid !== "string" || normalized.pwsid.length === 0) {
    throw new Error(
      "EPA Envirofacts returned a record without a PWSID — refusing to persist",
    );
  }
  if (
    typeof normalized.pws_name !== "string" ||
    typeof normalized.pws_activity_code !== "string" ||
    typeof normalized.pws_type_code !== "string"
  ) {
    throw new Error(
      "EPA Envirofacts returned a record missing one of the required fields (pws_name, pws_activity_code, pws_type_code)",
    );
  }

  return { record: normalized, rawPayload: payload, sourceUrl: url };
}

/**
 * Trim string values and replace empty strings with null in a single
 * pass. Exported for the test suite. Mutates a shallow copy — the
 * original raw payload is preserved by the caller for raw_payload
 * persistence.
 */
export function normalizeRecord(
  record: Record<string, unknown>,
): EnvirofactsWaterSystemRecord {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) {
    if (typeof value === "string") {
      const trimmed = value.trim();
      out[key] = trimmed.length === 0 ? null : trimmed;
    } else {
      out[key] = value;
    }
  }
  // PWSID must stay uppercase regardless of how EPA returned it so the
  // cache key matches between resolve-time and persist-time.
  if (typeof out.pwsid === "string") {
    out.pwsid = (out.pwsid as string).toUpperCase();
  }
  return out as EnvirofactsWaterSystemRecord;
}
