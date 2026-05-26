/**
 * EPA Community Water System Service Areas ArcGIS REST client.
 *
 * Hits the public CWS Service Areas FeatureServer to ask "which public
 * water system serves the parcel at this lat/lon?". The layer is a
 * national mosaic of utility service-area polygons; a point-in-polygon
 * intersect with the house's coordinates resolves a PWSID for municipal
 * customers, or returns no match for private-well addresses outside any
 * polygon.
 *
 * Same shape as the FEMA NFHL client (lib/habitat/modules/fema-flood-
 * zones/fetch.ts) — Esri geometry parameter, WGS84 inSR, intersect
 * spatial relation, JSON response. Different MapServer / FeatureServer,
 * different attributes returned, but the URL-building and timeout
 * mechanics are intentionally identical so anyone debugging one already
 * understands the other.
 *
 * Reference layer:
 *   https://services.arcgis.com/cJ9YHowT8TU7DUyn/arcgis/rest/services/
 *     Water_System_Boundaries/FeatureServer
 *
 * The FeatureServer exposes a single layer (id 0) containing CWS polygons
 * with PWSID and utility name attributes. Empty `features` means the
 * point falls outside any CWS polygon — the caller treats this as the
 * private-well branch.
 */

/**
 * Raw attribute shape EPA returns on each feature. The layer publishes
 * a handful of additional fields (state, system type, population) but
 * the module only needs the PWSID and name — pulling fewer fields keeps
 * the request payload small and the parse path explicit.
 */
export type CwsServiceAreaAttributes = {
  PWSID: string;
  PWS_NAME: string | null;
};

/**
 * Top-level ArcGIS query response. Only `features` is read at parse
 * time; the surrounding metadata is acknowledged for clarity.
 */
export type CwsServiceAreaResponse = {
  features: Array<{ attributes: CwsServiceAreaAttributes }>;
};

/**
 * Resolved PWSID for a point, plus the utility name as a defensive
 * cross-check. Null when the point sits outside every CWS polygon —
 * the private-well case.
 */
export type CwsServiceAreaMatch = {
  pwsid: string;
  pwsName: string | null;
};

const CWS_BASE_URL =
  "https://services.arcgis.com/cJ9YHowT8TU7DUyn/arcgis/rest/services/Water_System_Boundaries/FeatureServer/0/query";

const DEFAULT_TIMEOUT_MS = 15_000;

/**
 * Build the CWS Service Areas query URL for a single point. Exported so
 * the activity log can cite the exact URL.
 *
 * Esri convention is `geometry=lon,lat` in WGS84 (4326). outFields is
 * scoped to PWSID and PWS_NAME — see CwsServiceAreaAttributes above.
 */
export function buildCwsServiceAreaQueryUrl(
  latitude: number,
  longitude: number,
): string {
  const params = new URLSearchParams({
    geometry: `${longitude},${latitude}`,
    geometryType: "esriGeometryPoint",
    inSR: "4326",
    spatialRel: "esriSpatialRelIntersects",
    outFields: "PWSID,PWS_NAME",
    returnGeometry: "false",
    f: "json",
  });
  return `${CWS_BASE_URL}?${params.toString()}`;
}

/**
 * Options for resolvePwsidAtPoint. The fetch impl and timeout are
 * injectable so the test suite can substitute deterministic responses
 * without monkey-patching globals — same pattern as fetchFloodZonesAtPoint.
 */
export type ResolvePwsidOptions = {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
};

/**
 * Resolve a single (lat, lon) point to a PWSID via the EPA Community
 * Water System Service Areas layer. Returns null when the point is not
 * inside any CWS polygon (private well, no-match).
 *
 * Returns the first matching feature when EPA reports multiple
 * overlapping polygons. In practice this is rare for residential
 * addresses; when it happens it usually means a system boundary
 * revision that hasn't been reconciled upstream. The first feature is
 * the deterministic choice EPA returns, and the activity-log
 * narration calls out the overlap count so the user sees the
 * ambiguity rather than the module silently picking.
 *
 * Throws on network error, non-2xx response, unexpected response shape,
 * or timeout — same contract as the FEMA NFHL client. The orchestrator's
 * failure path captures the message as a 'failed' habitat finding.
 */
export async function resolvePwsidAtPoint(
  latitude: number,
  longitude: number,
  options: ResolvePwsidOptions = {},
): Promise<{
  match: CwsServiceAreaMatch | null;
  totalFeatures: number;
}> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  const url = buildCwsServiceAreaQueryUrl(latitude, longitude);
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
        `EPA CWS Service Areas request timed out after ${timeoutMs}ms`,
      );
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    throw new Error(
      `EPA CWS Service Areas request failed with HTTP ${response.status}`,
    );
  }

  const payload: unknown = await response.json();
  if (!payload || typeof payload !== "object") {
    throw new Error(
      "EPA CWS Service Areas returned an unexpected response shape (expected an object)",
    );
  }

  const features = (payload as { features?: unknown }).features;
  if (!Array.isArray(features)) {
    throw new Error(
      "EPA CWS Service Areas returned an unexpected response shape (expected features[] array)",
    );
  }

  const totalFeatures = features.length;
  if (totalFeatures === 0) {
    return { match: null, totalFeatures };
  }

  const first = features[0] as { attributes?: unknown };
  const attrs = first?.attributes as CwsServiceAreaAttributes | undefined;
  if (!attrs || typeof attrs.PWSID !== "string" || attrs.PWSID.length === 0) {
    throw new Error(
      "EPA CWS Service Areas returned a feature without a PWSID attribute",
    );
  }

  return {
    match: {
      pwsid: attrs.PWSID.trim().toUpperCase(),
      pwsName: typeof attrs.PWS_NAME === "string" ? attrs.PWS_NAME : null,
    },
    totalFeatures,
  };
}
