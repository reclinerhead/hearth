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
 *
 * EPA's canonical schema casing is `PWS_Name` (mixed case); ArcGIS
 * accepts either casing in `outFields` but returns the canonical form,
 * so we read both casings defensively. Documented in `readPwsName`.
 */
export type CwsServiceAreaAttributes = {
  PWSID: string;
  PWS_Name?: string | null;
  PWS_NAME?: string | null;
};

/**
 * Read the utility name out of an attributes object regardless of which
 * casing EPA returns. The service's canonical schema is `PWS_Name`
 * (mixed case); older docs and our own `outFields` request use
 * `PWS_NAME` (upper case). Handle both.
 */
function readPwsName(attrs: CwsServiceAreaAttributes): string | null {
  if (typeof attrs.PWS_Name === "string") return attrs.PWS_Name;
  if (typeof attrs.PWS_NAME === "string") return attrs.PWS_NAME;
  return null;
}

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
      pwsName: readPwsName(attrs),
    },
    totalFeatures,
  };
}

/**
 * Radius for the nearest-polygon fallback search, in meters. Tuned
 * for the canonical regression case (604 Norton Dr Kalamazoo, where
 * the closest in-polygon point is ~250m east): 500m gives margin
 * without expanding into adjacent utilities' territory for typical
 * residential parcels. Exported so the activity log can cite the
 * value and tests can verify the URL builder.
 */
export const NEAREST_POLYGON_FALLBACK_RADIUS_M = 500;

/**
 * Build the URL for the buffer-style "all polygons within N meters"
 * query against the same CWS Service Areas layer. ArcGIS REST
 * supports `distance` + `units` on a point geometry as a shorthand
 * for an N-meter circular buffer — equivalent to building a buffered
 * polygon client-side and querying against it, but a single round
 * trip.
 *
 * Exported for the test suite.
 */
export function buildNearestPwsidQueryUrl(
  latitude: number,
  longitude: number,
  radiusMeters: number = NEAREST_POLYGON_FALLBACK_RADIUS_M,
): string {
  const params = new URLSearchParams({
    geometry: `${longitude},${latitude}`,
    geometryType: "esriGeometryPoint",
    inSR: "4326",
    spatialRel: "esriSpatialRelIntersects",
    distance: String(radiusMeters),
    units: "esriSRUnit_Meter",
    outFields: "PWSID,PWS_NAME",
    returnGeometry: "false",
    f: "json",
  });
  return `${CWS_BASE_URL}?${params.toString()}`;
}

/**
 * Outcome of the nearest-polygon fallback. Three cases for three
 * distinct downstream behaviors:
 *
 *   single-nearby     — every polygon within the radius belongs to
 *                       the same PWSID. High enough confidence to
 *                       treat as an inferred match and run SDWIS
 *                       against the resolved utility.
 *   multiple-competing — polygons from multiple PWSIDs nearby. We
 *                       can't pick one with confidence, but the
 *                       presence of multiple utilities within the
 *                       radius is a strong "you're in/near a city"
 *                       signal. The caller routes to cws_unmapped
 *                       (not private_well) regardless of waterSource.
 *   no-match          — zero polygons in the radius. Genuine
 *                       no-utility-nearby case. The caller falls
 *                       back to the standard branch decision
 *                       (private_well or cws_unmapped depending on
 *                       declared waterSource).
 *
 * The `candidates` array on `multiple-competing` carries the per-
 * PWSID polygon counts so future UI can offer a "did you mean…"
 * choice; the module doesn't surface them today.
 */
export type NearestPwsidResult =
  | {
      kind: "single-nearby";
      pwsid: string;
      pwsName: string | null;
      candidateCount: number;
    }
  | {
      kind: "multiple-competing";
      candidates: Array<{
        pwsid: string;
        pwsName: string | null;
        count: number;
      }>;
    }
  | {
      kind: "no-match";
    };

/**
 * Run the nearest-polygon fallback. Only meaningful when the direct
 * point-in-polygon lookup came up empty — when the direct query
 * matched, we already have a verified PWSID and the fallback is
 * skipped.
 *
 * Same fetch + timeout + soft-fail discipline as `resolvePwsidAtPoint`.
 * Throws on network/5xx/timeout/malformed-shape; the orchestrator's
 * failure path captures the message. A "no nearby polygons" response
 * is the no-match case, not an error.
 */
export async function resolveNearestPwsid(
  latitude: number,
  longitude: number,
  options: ResolvePwsidOptions & { radiusMeters?: number } = {},
): Promise<NearestPwsidResult> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const radius = options.radiusMeters ?? NEAREST_POLYGON_FALLBACK_RADIUS_M;

  const url = buildNearestPwsidQueryUrl(latitude, longitude, radius);
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
        `EPA CWS Service Areas nearest-polygon request timed out after ${timeoutMs}ms`,
      );
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    throw new Error(
      `EPA CWS Service Areas nearest-polygon request failed with HTTP ${response.status}`,
    );
  }

  const payload: unknown = await response.json();
  if (!payload || typeof payload !== "object") {
    throw new Error(
      "EPA CWS Service Areas (nearest) returned an unexpected response shape (expected an object)",
    );
  }
  const features = (payload as { features?: unknown }).features;
  if (!Array.isArray(features)) {
    throw new Error(
      "EPA CWS Service Areas (nearest) returned an unexpected response shape (expected features[] array)",
    );
  }
  if (features.length === 0) {
    return { kind: "no-match" };
  }

  // Tally per-PWSID. A single utility's service area is frequently
  // split into multiple polygons (annexations, non-contiguous
  // territories); we don't care about the polygon count, only which
  // PWSIDs are represented.
  const byPwsid = new Map<
    string,
    { pwsName: string | null; count: number }
  >();
  for (const feature of features) {
    const attrs = (feature as { attributes?: unknown })?.attributes as
      | CwsServiceAreaAttributes
      | undefined;
    if (!attrs || typeof attrs.PWSID !== "string" || attrs.PWSID.length === 0) {
      // Skip malformed features rather than throwing — a single bad
      // row shouldn't crash the fallback. The throw at the top still
      // guards against the entire response being malformed.
      continue;
    }
    const pwsid = attrs.PWSID.trim().toUpperCase();
    const existing = byPwsid.get(pwsid);
    if (existing) {
      existing.count += 1;
    } else {
      byPwsid.set(pwsid, {
        pwsName: readPwsName(attrs),
        count: 1,
      });
    }
  }

  if (byPwsid.size === 0) {
    // Every feature was malformed. Treat as no-match rather than
    // throwing — the data quality is bad but we still have a sensible
    // downstream branch.
    return { kind: "no-match" };
  }

  if (byPwsid.size === 1) {
    const [pwsid, info] = byPwsid.entries().next().value!;
    return {
      kind: "single-nearby",
      pwsid,
      pwsName: info.pwsName,
      candidateCount: info.count,
    };
  }

  const candidates = Array.from(byPwsid.entries())
    .map(([pwsid, info]) => ({
      pwsid,
      pwsName: info.pwsName,
      count: info.count,
    }))
    // Highest-count first — useful for future UI surfaces that might
    // want to highlight the dominant candidate.
    .sort((a, b) => b.count - a.count);
  return { kind: "multiple-competing", candidates };
}
