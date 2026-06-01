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
 * Default retry policy for `fetchFloodZonesAtPoint`. Up to 3 attempts
 * total — the initial fetch plus 2 retries — separated by exponential
 * backoff with ±20% jitter. Worst-case wall-clock when every attempt
 * times out is `3 * DEFAULT_TIMEOUT_MS + ~300ms + ~900ms` ≈ 46s; the
 * onboarding modal's tolerance still comfortably accommodates that,
 * and the alternative is a permanent 'failed' finding that requires a
 * manual user refresh.
 *
 * The backoff schedule is intentionally short and tight. FEMA's NFHL
 * service tends to either return quickly or fail quickly; if a longer
 * pause is needed it likely means the service is genuinely down, at
 * which point the cache + unreachable-finding paths in index.ts pick
 * up the load instead.
 *
 * Exported so tests and the cache wrapper can override on a per-call
 * basis (the in-memory cache test double uses `attempts: 1` to keep
 * test latency low when the retry behavior isn't under test).
 */
export const DEFAULT_RETRY_POLICY = {
  attempts: 3,
  baseDelayMs: 300,
  /** Multiplier between attempts. 300ms → 900ms → (no further). */
  factor: 3,
  /** Jitter band as a fraction of the computed delay (±20%). */
  jitter: 0.2,
} as const;

export type RetryPolicy = {
  attempts: number;
  baseDelayMs: number;
  factor: number;
  jitter: number;
};

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
 * without monkey-patching globals. `retryPolicy` overrides the default
 * 3-attempt schedule on a per-call basis (tests use `attempts: 1` to
 * keep their happy-path runs single-shot).
 *
 * `sleepImpl` is a seam for the retry loop's between-attempt wait — the
 * test suite injects a no-op so retry tests don't actually wait 300ms
 * between attempts.
 */
export type FetchFloodZonesOptions = {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  retryPolicy?: RetryPolicy;
  sleepImpl?: (ms: number) => Promise<void>;
  /**
   * Fires once per attempt with the 1-indexed attempt number and
   * the outcome of that attempt. Used by the cache wrapper to know
   * how many retries were needed on a successful fetch — the public
   * return shape of `fetchFloodZonesAtPoint` stays the
   * `NormalizedFloodZone[]` it always was, and this seam is how
   * out-of-band metadata (here: retry count for activity-log
   * narration) reaches the caller.
   */
  onAttempt?: (info: {
    attempt: number;
    outcome: "success" | "retryable-error" | "fatal-error";
  }) => void;
};

/**
 * Error subclass that carries the retry classification of a failed
 * fetch attempt. The retry loop reads `retryable` to decide whether
 * to attempt again — 5xx / 429 / network errors / timeouts are
 * retryable; 4xx (other than 429) and "unexpected shape" errors are
 * deterministic bugs in either our query or FEMA's schema and don't
 * benefit from retry.
 *
 * Exported for the test suite.
 */
export class NfhlFetchError extends Error {
  readonly retryable: boolean;
  readonly status: number | null;
  readonly attempt: number;

  constructor(input: {
    message: string;
    retryable: boolean;
    status: number | null;
    attempt: number;
    cause?: unknown;
  }) {
    super(input.message);
    this.name = "NfhlFetchError";
    this.retryable = input.retryable;
    this.status = input.status;
    this.attempt = input.attempt;
    if (input.cause !== undefined) {
      (this as { cause?: unknown }).cause = input.cause;
    }
  }
}

/**
 * Built-in sleep used by the retry loop between attempts. Exposed via
 * the `sleepImpl` option so tests can replace it with a no-op.
 */
function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Compute the delay before the Nth retry (1-indexed). `attemptNumber=1`
 * is the wait before retry #1 (the second overall attempt). Applies
 * exponential growth from `baseDelayMs` by `factor`, with ±jitter
 * applied multiplicatively. Exported for the test suite.
 */
export function computeBackoffDelayMs(
  attemptNumber: number,
  policy: RetryPolicy,
  random: () => number = Math.random,
): number {
  const expDelay = policy.baseDelayMs * Math.pow(policy.factor, attemptNumber - 1);
  // jitter ∈ [-policy.jitter, +policy.jitter)
  const j = (random() * 2 - 1) * policy.jitter;
  return Math.max(0, Math.round(expDelay * (1 + j)));
}

/**
 * Query the NFHL for every flood-zone polygon that contains the given
 * point, with up to 3 attempts and exponential backoff on transient
 * errors. Returns the normalized zones (sentinels coerced, conveniences
 * derived) in the order FEMA returned them. The empty-array case is the
 * caller's signal that the point is outside NFHL digital coverage; the
 * caller decides how to render that.
 *
 * Retry policy (see `DEFAULT_RETRY_POLICY`):
 *   - Retries on: network errors, 5xx responses, 429 rate-limit,
 *     AbortError (one timeout per attempt).
 *   - Does NOT retry on: 4xx other than 429 (deterministic bug in the
 *     query — retrying just multiplies the failure), unexpected response
 *     shape (likely a FEMA schema change we should flag fast).
 *
 * Throws a `NfhlFetchError` carrying the retry classification of the
 * final failed attempt. The cache wrapper in cache.ts catches this to
 * decide between the stale-cache fallback and the unreachable-finding
 * path; the orchestrator's outer error handling no longer sees raw
 * FEMA failures because the cache wrapper always returns a finding.
 */
export async function fetchFloodZonesAtPoint(
  latitude: number,
  longitude: number,
  options: FetchFloodZonesOptions = {},
): Promise<NormalizedFloodZone[]> {
  const policy = options.retryPolicy ?? DEFAULT_RETRY_POLICY;
  const sleep = options.sleepImpl ?? defaultSleep;

  let lastErr: NfhlFetchError | null = null;
  for (let attempt = 1; attempt <= policy.attempts; attempt++) {
    try {
      const zones = await fetchFloodZonesSingleAttempt(
        latitude,
        longitude,
        attempt,
        options,
      );
      options.onAttempt?.({ attempt, outcome: "success" });
      return zones;
    } catch (err) {
      const classified =
        err instanceof NfhlFetchError
          ? err
          : new NfhlFetchError({
              message:
                err instanceof Error ? err.message : "Unknown FEMA NFHL error",
              retryable: false,
              status: null,
              attempt,
              cause: err,
            });
      lastErr = classified;
      const shouldStop = !classified.retryable || attempt === policy.attempts;
      options.onAttempt?.({
        attempt,
        outcome: shouldStop ? "fatal-error" : "retryable-error",
      });
      if (shouldStop) {
        throw classified;
      }
      const delay = computeBackoffDelayMs(attempt, policy);
      await sleep(delay);
    }
  }
  // Unreachable — the loop either returns or throws — but the compiler
  // needs a terminal expression.
  throw (
    lastErr ??
    new NfhlFetchError({
      message: "FEMA NFHL retry loop exited without a result",
      retryable: false,
      status: null,
      attempt: policy.attempts,
    })
  );
}

/**
 * One pass at the FEMA NFHL endpoint. Translates every failure mode
 * (network, timeout, non-2xx, malformed body) into a NfhlFetchError
 * with the correct `retryable` classification so the outer retry loop
 * can act on it without re-inspecting the error.
 */
async function fetchFloodZonesSingleAttempt(
  latitude: number,
  longitude: number,
  attempt: number,
  options: FetchFloodZonesOptions,
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
      throw new NfhlFetchError({
        message: `FEMA NFHL request timed out after ${timeoutMs}ms`,
        retryable: true,
        status: null,
        attempt,
        cause: err,
      });
    }
    // Generic network/DNS/TLS failures — retry. ENOTFOUND on a single
    // attempt is far more often a transient resolver blip than a
    // permanent misconfiguration; the cache wrapper takes over once
    // retries are exhausted.
    throw new NfhlFetchError({
      message:
        err instanceof Error
          ? err.message
          : "FEMA NFHL request failed with an unknown network error",
      retryable: true,
      status: null,
      attempt,
      cause: err,
    });
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    // 5xx and 429 retry; everything else is a deterministic bug in the
    // query (4xx) that retries can't fix.
    const status = response.status;
    const retryable = status >= 500 || status === 429;
    throw new NfhlFetchError({
      message: `FEMA NFHL request failed with HTTP ${status}`,
      retryable,
      status,
      attempt,
    });
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch (err) {
    // Body read errors get the same treatment as network errors —
    // FEMA's ArcGIS proxy occasionally returns a 200 with a truncated
    // body during deploys, and a single retry is usually enough.
    throw new NfhlFetchError({
      message:
        err instanceof Error
          ? `FEMA NFHL response body parse failed: ${err.message}`
          : "FEMA NFHL response body parse failed",
      retryable: true,
      status: response.status,
      attempt,
      cause: err,
    });
  }

  if (!payload || typeof payload !== "object") {
    throw new NfhlFetchError({
      message:
        "FEMA NFHL returned an unexpected response shape (expected an object)",
      retryable: false,
      status: response.status,
      attempt,
    });
  }

  // ArcGIS brownout signature: a HTTP 200 whose body is an error
  // envelope (`{ error: { code, message } }`) instead of a `features[]`
  // array. FEMA's ArcGIS proxy returns this during deploys and partial
  // outages — it's transient, so it's retryable. Detected ahead of the
  // `features` guard below so it's classified as a retry-worthy outage
  // rather than falling through to the non-retryable "unexpected shape"
  // path (which is reserved for a genuine FEMA schema change) — and so
  // it never reaches the caller as an empty-coverage `features: []`.
  const errorEnvelope = (payload as { error?: unknown }).error;
  if (errorEnvelope && typeof errorEnvelope === "object") {
    const e = errorEnvelope as { code?: unknown; message?: unknown };
    const code = typeof e.code === "number" ? e.code : null;
    const detail =
      typeof e.message === "string" && e.message.length > 0
        ? e.message
        : "no message";
    throw new NfhlFetchError({
      message: `FEMA NFHL returned an ArcGIS error envelope (HTTP ${response.status}, code ${code ?? "?"}): ${detail}`,
      retryable: true,
      status: response.status,
      attempt,
    });
  }

  const features = (payload as { features?: unknown }).features;
  if (!Array.isArray(features)) {
    throw new NfhlFetchError({
      message:
        "FEMA NFHL returned an unexpected response shape (expected features[] array)",
      retryable: false,
      status: response.status,
      attempt,
    });
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
