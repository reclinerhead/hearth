/**
 * EPA Envirofacts SEMS API client.
 *
 * Hits the public REST endpoint at https://data.epa.gov/efservice/ to
 * pull every NPL-relevant Superfund site in a US state, left-joined to
 * the contaminants table so a single request returns the full picture.
 * Plain fetch, no auth, no LLM, no Perplexity — the response is
 * structured JSON.
 *
 * The join produces one row per (site, contaminant), so a site with N
 * contaminants appears N times. mergeContaminants() collapses those
 * back into a single NplSite per site_id with `contaminants` as a
 * deduplicated array.
 *
 * Envirofacts does not support a "within radius" filter. We pull the
 * whole state and let the consumer (index.ts) filter by distance in
 * memory — typical states have on the order of 50-100 NPL-relevant
 * sites, trivially small for client-side filtering.
 *
 * Reference: https://www.epa.gov/enviro/envirofacts-data-service-api
 */

/**
 * A SEMS envirofacts_site row, as returned by EPA. All text fields
 * arrive in ALL CAPS. Coordinates arrive as strings (or null), and a
 * large fraction of sites have null coordinates — the consumer must
 * filter those out before any distance math.
 */
export type SemsSiteRow = {
  site_id: string;
  epa_id: string;
  name: string;
  street_addr_txt: string | null;
  supplemental_addr_txt: string | null;
  city_name: string | null;
  county_name: string | null;
  fk_ref_state_code: string;
  zip_code: string | null;
  primary_latitude_decimal_val: string | null;
  primary_longitude_decimal_val: string | null;
  npl_status_code: string;
  npl_status_name: string | null;
  non_npl_status_code: string | null;
  non_npl_status_name: string | null;
  archived_ind: string | null;
  archived_date: string | null;
  federal_facility_ind: string | null;
  fips_code: string | null;
  fk_ref_region_code: string | null;
  congressional_district_code: string | null;
  saa_agreement_site_ind: string | null;
};

/**
 * A single NPL-relevant site with its contaminants merged in. One per
 * unique site_id; the EPA join produces one row per (site,
 * contaminant) and mergeContaminants collapses them.
 */
export type NplSite = SemsSiteRow & {
  contaminants: string[];
};

/**
 * Build the EPA Envirofacts URL for an NPL-relevant site fetch joined
 * to contaminants. Exported so the index.ts activity log can cite the
 * exact URL it asked for.
 *
 * The state code is included in the path verbatim — EPA expects the
 * 2-letter USPS code (uppercased here). encodeURIComponent guards
 * against any future caller passing in unexpected characters.
 */
export function buildNplSitesUrl(state: string): string {
  const code = state.trim().toUpperCase();
  return (
    "https://data.epa.gov/efservice/" +
    "sems.envirofacts_site/" +
    `fk_ref_state_code/equals/${encodeURIComponent(code)}/` +
    "npl_status_code/in/F,P,A,D/" +
    "left/sems.envirofacts_contaminants/site_id/equals/fk_site_id/" +
    "JSON"
  );
}

const DEFAULT_TIMEOUT_MS = 15_000;

/**
 * Options for fetchNplSitesInState. The fetch impl and timeout are
 * injectable so the test suite can substitute deterministic responses
 * without monkey-patching globals.
 */
export type FetchNplSitesOptions = {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
};

/**
 * Fetch every NPL-relevant Superfund site for a US state, with
 * contaminants merged in. Throws on network error, non-2xx response,
 * or unexpected response shape — the orchestrator's failure path
 * surfaces this as a 'failed' finding.
 */
export async function fetchNplSitesInState(
  state: string,
  options: FetchNplSitesOptions = {},
): Promise<NplSite[]> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  const url = buildNplSitesUrl(state);
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
        `EPA Envirofacts SEMS request timed out after ${timeoutMs}ms`,
      );
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    throw new Error(
      `EPA Envirofacts SEMS request failed with HTTP ${response.status}`,
    );
  }

  const payload: unknown = await response.json();
  if (!Array.isArray(payload)) {
    throw new Error(
      "EPA Envirofacts SEMS returned an unexpected response shape (expected an array)",
    );
  }

  return mergeContaminants(payload as Record<string, unknown>[]);
}

/**
 * Collapse a left-joined EPA response into one entry per site_id with
 * contaminants merged into a single array. Exported for the test suite.
 *
 * A "contaminant" is whichever field the EPA join surfaces from
 * sems.envirofacts_contaminants. EPA's column naming is not always
 * stable across schema revisions; we read whichever of
 * `contaminant_name`, `name`, or `chemical_name` is present, in that
 * order. If none is present (a site with no contaminants in the
 * joined table) the row still produces an entry with an empty
 * contaminants array.
 */
export function mergeContaminants(
  rows: Record<string, unknown>[],
): NplSite[] {
  const bySiteId = new Map<string, NplSite>();
  for (const row of rows) {
    const siteId = typeof row.site_id === "string" ? row.site_id : null;
    if (!siteId) continue;

    let entry = bySiteId.get(siteId);
    if (!entry) {
      entry = { ...(row as unknown as SemsSiteRow), contaminants: [] };
      bySiteId.set(siteId, entry);
    }

    const contaminant = pickContaminantName(row);
    if (contaminant && !entry.contaminants.includes(contaminant)) {
      entry.contaminants.push(contaminant);
    }
  }
  return Array.from(bySiteId.values());
}

function pickContaminantName(row: Record<string, unknown>): string | null {
  const candidates = ["contaminant_name", "name", "chemical_name"];
  for (const key of candidates) {
    const v = row[key];
    if (typeof v === "string") {
      const trimmed = v.trim();
      if (trimmed) return trimmed;
    }
  }
  return null;
}

/**
 * Parse latitude/longitude strings into numbers, or return null if
 * either is missing or fails Number.isFinite. EPA returns coordinates
 * as strings; many sites have null coords.
 */
export function parseSiteCoordinates(
  site: SemsSiteRow,
): { latitude: number; longitude: number } | null {
  const lat =
    site.primary_latitude_decimal_val == null
      ? NaN
      : Number.parseFloat(site.primary_latitude_decimal_val);
  const lng =
    site.primary_longitude_decimal_val == null
      ? NaN
      : Number.parseFloat(site.primary_longitude_decimal_val);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return { latitude: lat, longitude: lng };
}

/**
 * EPA's public profile URL for a SEMS site, derived from its SEMS
 * site_id. The site_id in the row arrives zero-padded (e.g.
 * "0100185"); the profile page accepts the integer form so we strip
 * leading zeros before constructing the URL.
 */
export function siteProfileUrl(siteId: string): string {
  const stripped = siteId.replace(/^0+/, "") || siteId;
  return `https://cumulis.epa.gov/supercpad/cursites/csitinfo.cfm?id=${encodeURIComponent(
    stripped,
  )}`;
}
