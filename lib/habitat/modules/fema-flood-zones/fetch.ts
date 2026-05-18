/**
 * FEMA National Flood Hazard Layer (NFHL) ArcGIS REST client.
 *
 * Hits MapServer layer 28 (Flood Hazard Zones) on FEMA's public ArcGIS
 * service to ask "what flood zone polygon contains this lat/lon?".
 * Plain fetch, no auth — the response is structured JSON.
 *
 * The endpoint expects an Esri point geometry (longitude,latitude in
 * WGS84) and returns a `features` array, with one entry per polygon
 * that intersects the query point. Typically that's exactly one
 * polygon. Zero features means the point sits outside NFHL digital
 * coverage — about 10% of US addresses, mostly rural/remote.
 *
 * Reference: https://hazards.fema.gov/femaportal/wps/portal/NFHLWMS
 */

/**
 * The raw attributes shape FEMA returns on each feature. All numeric
 * fields use `-9999` as the null sentinel — `normalizeFloodZone` below
 * coerces those to `null` before the data flows downstream.
 */
export type NfhlFloodZoneAttributes = {
  OBJECTID: number;
  DFIRM_ID: string;
  FLD_AR_ID: string;
  STUDY_TYP: string;
  FLD_ZONE: string;
  ZONE_SUBTY: string | null;
  SFHA_TF: string;
  STATIC_BFE: number;
  V_DATUM: string | null;
  DEPTH: number;
  LEN_UNIT: string | null;
  VELOCITY: number;
  VEL_UNIT: string | null;
  AR_REVERT?: string | null;
  AR_SUBTRV?: string | null;
  BFE_REVERT: number;
  DEP_REVERT: number;
  DUAL_ZONE: string | null;
  SOURCE_CIT: string;
  GFID?: string;
  GlobalID?: string;
};

/**
 * Top-level NFHL query response. We only read `features`; the rest of
 * the wrapper is acknowledged for clarity but ignored at parse time.
 */
export type NfhlResponse = {
  displayFieldName?: string;
  fieldAliases?: Record<string, string>;
  fields?: Array<{ name: string; type: string; alias: string; length?: number }>;
  features: Array<{ attributes: NfhlFloodZoneAttributes }>;
};

/**
 * Normalized form of one flood zone polygon — `-9999` sentinels turned
 * into nulls, and the boolean conveniences derived. This is what the
 * classifier and the persisted findings shape consume.
 */
export type NormalizedFloodZone = {
  objectId: number;
  dfirmId: string;
  fldArId: string;
  studyType: string;
  fldZone: string;
  zoneSubty: string | null;
  isSfha: boolean;
  staticBfe: number | null;
  vDatum: string | null;
  depth: number | null;
  lenUnit: string | null;
  velocity: number | null;
  velUnit: string | null;
  floodway: boolean;
  sourceCitation: string;
};

const NFHL_BASE_URL =
  "https://hazards.fema.gov/arcgis/rest/services/public/NFHL/MapServer/28/query";

const DEFAULT_TIMEOUT_MS = 15_000;

/**
 * Build the NFHL query URL for a single point. Exported so the activity
 * log can cite the exact URL that was asked for.
 *
 * Lat/lon are passed straight from `HouseContext` without rounding —
 * Mapbox coordinates are precise enough for a point-in-polygon test.
 * FEMA accepts `geometry=lon,lat` (longitude first, the Esri
 * convention) in WGS84.
 */
export function buildNfhlQueryUrl(
  latitude: number,
  longitude: number,
): string {
  const params = new URLSearchParams({
    geometry: `${longitude},${latitude}`,
    geometryType: "esriGeometryPoint",
    inSR: "4326",
    spatialRel: "esriSpatialRelIntersects",
    outFields: "*",
    returnGeometry: "false",
    f: "json",
  });
  return `${NFHL_BASE_URL}?${params.toString()}`;
}

/**
 * Options for `fetchFloodZonesAtPoint`. The fetch impl and timeout are
 * injectable so the test suite can substitute deterministic responses
 * without monkey-patching globals.
 */
export type FetchFloodZonesOptions = {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
};

/**
 * Query the NFHL for every flood-zone polygon that contains the given
 * point. Returns the normalized zones (sentinels coerced, conveniences
 * derived) in the order FEMA returned them. The empty-array case is the
 * caller's signal that the point is outside NFHL digital coverage; the
 * caller decides how to render that.
 *
 * Throws on network error, non-2xx response, unexpected response shape,
 * or timeout. The orchestrator's failure path turns that into a 'failed'
 * finding with the error message persisted to the `error` column.
 */
export async function fetchFloodZonesAtPoint(
  latitude: number,
  longitude: number,
  options: FetchFloodZonesOptions = {},
): Promise<NormalizedFloodZone[]> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  const url = buildNfhlQueryUrl(latitude, longitude);
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
        `FEMA NFHL request timed out after ${timeoutMs}ms`,
      );
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    throw new Error(
      `FEMA NFHL request failed with HTTP ${response.status}`,
    );
  }

  const payload: unknown = await response.json();
  if (!payload || typeof payload !== "object") {
    throw new Error(
      "FEMA NFHL returned an unexpected response shape (expected an object)",
    );
  }

  const features = (payload as { features?: unknown }).features;
  if (!Array.isArray(features)) {
    throw new Error(
      "FEMA NFHL returned an unexpected response shape (expected features[] array)",
    );
  }

  return features
    .map((feature) => (feature as { attributes?: unknown })?.attributes)
    .filter((attrs): attrs is NfhlFloodZoneAttributes =>
      Boolean(attrs && typeof attrs === "object"),
    )
    .map(normalizeFloodZone);
}

/**
 * Coerce FEMA's `-9999` numeric sentinel to `null`. Applied to every
 * numeric field that the schema documents as nullable (`STATIC_BFE`,
 * `DEPTH`, `VELOCITY`, `BFE_REVERT`, `DEP_REVERT`). Surfacing
 * "-9999 feet" anywhere in the UI would be a memorable bug.
 *
 * Exported for the test suite.
 */
export function coerceFemaNullSentinel(value: number): number | null {
  if (value === -9999 || value === -9999.0) return null;
  return value;
}

/**
 * Turn a raw NFHL attributes record into a `NormalizedFloodZone`.
 * Drops the `-9999` sentinels, derives `isSfha` from `SFHA_TF`, and
 * derives `floodway` from `ZONE_SUBTY === "FLOODWAY"` (case-insensitive).
 *
 * Exported for the test suite.
 */
export function normalizeFloodZone(
  attrs: NfhlFloodZoneAttributes,
): NormalizedFloodZone {
  const subty = normalizeSubtype(attrs.ZONE_SUBTY);
  return {
    objectId: attrs.OBJECTID,
    dfirmId: attrs.DFIRM_ID,
    fldArId: attrs.FLD_AR_ID,
    studyType: attrs.STUDY_TYP,
    fldZone: attrs.FLD_ZONE,
    zoneSubty: subty,
    isSfha: attrs.SFHA_TF === "T",
    staticBfe: coerceFemaNullSentinel(attrs.STATIC_BFE),
    vDatum: attrs.V_DATUM,
    depth: coerceFemaNullSentinel(attrs.DEPTH),
    lenUnit: attrs.LEN_UNIT,
    velocity: coerceFemaNullSentinel(attrs.VELOCITY),
    velUnit: attrs.VEL_UNIT,
    floodway: typeof subty === "string" && subty.toUpperCase() === "FLOODWAY",
    sourceCitation: attrs.SOURCE_CIT,
  };
}

/**
 * Treat empty string and null equivalently — FEMA returns null for the
 * "minimal hazard" subtype on some panels and an empty string on others.
 */
function normalizeSubtype(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  const trimmed = raw.trim();
  return trimmed.length === 0 ? null : trimmed;
}
