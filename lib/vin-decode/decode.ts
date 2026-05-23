// VIN decode helper using NHTSA's free vPIC API.
//
// This is deterministic and free — no LLM, no API key, no model
// selection. The API speaks JSON and returns the manufacturer's
// recorded fields for any North American VIN. For Hearth we keep the
// raw output minus the noise (NHTSA returns ~130 fields per VIN; we
// promote only the handful that surface on the detail page) and store
// the rest unparsed inside metadata.vin_decode for future use.
//
// **Endpoint choice (load-bearing).** We use `/DecodeVinValues/` which
// returns `Results: [{ flat camelCase object }]`. The sibling
// `/DecodeVin/` endpoint returns `Results: [{ Variable, Value }, ...]`
// where Variable is the human-readable label ("Model Year" with a
// space) — easy to mismatch against camelCase TS field names. We hit
// that exact bug on this PR's first pass: Make and Model worked because
// they're single-word variables that happen to match either shape, but
// ModelYear silently dropped because the Variable was "Model Year".
// Using the values endpoint makes the field names self-consistent end
// to end.

// Subset of NHTSA's response we actually surface on the detail page.
// Field names match NHTSA's variable names verbatim so they read the
// same in the activity log, the raw response, and the UI.
export const VIN_DECODE_FIELDS = [
  "Make",
  "Model",
  "ModelYear",
  "BodyClass",
  "VehicleType",
  "EngineCylinders",
  "FuelTypePrimary",
  "DriveType",
  "Manufacturer",
  "ManufacturerId",
  "PlantCity",
  "PlantState",
  "PlantCountry",
] as const;

export type VinDecodeField = (typeof VIN_DECODE_FIELDS)[number];

export type VinDecodeRaw = Partial<Record<VinDecodeField, string | null>>;

export type VinDecodeResult = {
  source: "nhtsa_vdecoder";
  decoded_at: string;
  raw: VinDecodeRaw;
};

// Public so the route handler and tests can use the same regex.
// VIN format: 17 chars, A-Z + 0-9, excluding I/O/Q to avoid ambiguity
// with 1/0. We do not validate the check digit here — NHTSA does that
// server-side and will return error codes 1/2/3 when the VIN is invalid.
export const VIN_REGEX = /^[A-HJ-NPR-Z0-9]{17}$/;

export function normalizeVin(raw: string): string {
  return raw.replace(/\s+/g, "").toUpperCase();
}

export function isValidVinFormat(raw: string | null | undefined): boolean {
  if (!raw) return false;
  return VIN_REGEX.test(normalizeVin(raw));
}

// Build the NHTSA DecodeVinValues URL. Public so tests don't have to
// hard-code it and so any future swap (e.g. DecodeVinValuesExtended)
// becomes a one-line change.
export function buildNhtsaDecodeUrl(vin: string): string {
  const normalized = normalizeVin(vin);
  return `https://vpic.nhtsa.dot.gov/api/vehicles/DecodeVinValues/${encodeURIComponent(normalized)}?format=json`;
}

// NHTSA's response shape for DecodeVinValues. The endpoint returns a
// `Results` array of length 1 containing a flat object whose keys are
// the camelCase variable names. Every value is `string` (never null),
// using empty strings or sentinels for absent fields.
type NhtsaValuesRow = Record<string, string>;
type NhtsaResponse = {
  Count?: number;
  Message?: string;
  Results?: NhtsaValuesRow[];
};

/**
 * Pure helper: turn an NHTSA DecodeVinValues response body into our
 * trimmed `{ field: value }` record, dropping NHTSA's sentinel values
 * and the fields we don't surface. Exposed so the test can exercise
 * the extraction without mocking the network.
 *
 * NHTSA fills absent fields with empty strings, `"Not Applicable"`,
 * `"0"`, or `"Not Available"`. Collapse all of those to null so the
 * renderer's "render only if present" rule doesn't surface stub
 * strings as if they were real facts.
 */
export function extractVinFields(body: NhtsaResponse): VinDecodeRaw {
  const row = body.Results?.[0];
  if (!row) return {};
  const out: VinDecodeRaw = {};
  for (const field of VIN_DECODE_FIELDS) {
    const value = row[field];
    if (
      value === undefined ||
      value === null ||
      value === "" ||
      value === "Not Applicable" ||
      value === "Not Available" ||
      value === "0"
    ) {
      out[field] = null;
    } else {
      out[field] = value;
    }
  }
  return out;
}

export type DecodeVinError =
  | { kind: "invalid-format" }
  | { kind: "nhtsa-unreachable"; message: string }
  | { kind: "nhtsa-empty"; message: string };

/**
 * Fetch NHTSA and return the trimmed decoded fields, or a structured
 * error. The caller (the API route) is responsible for persisting the
 * result and surfacing the error to the UI.
 */
export async function decodeVinFromNhtsa(
  rawVin: string,
): Promise<{ ok: true; result: VinDecodeResult } | { ok: false; error: DecodeVinError }> {
  if (!isValidVinFormat(rawVin)) {
    return { ok: false, error: { kind: "invalid-format" } };
  }
  const vin = normalizeVin(rawVin);
  let response: Response;
  try {
    response = await fetch(buildNhtsaDecodeUrl(vin), {
      headers: { accept: "application/json" },
      // The detail-page Decode VIN button is a deliberate user gesture;
      // a 10-second budget is generous and keeps the route from hanging
      // forever on a transient NHTSA outage.
      signal: AbortSignal.timeout(10_000),
    });
  } catch (e) {
    return {
      ok: false,
      error: {
        kind: "nhtsa-unreachable",
        message: e instanceof Error ? e.message : String(e),
      },
    };
  }
  if (!response.ok) {
    return {
      ok: false,
      error: {
        kind: "nhtsa-unreachable",
        message: `NHTSA responded with ${response.status}`,
      },
    };
  }
  let body: NhtsaResponse;
  try {
    body = (await response.json()) as NhtsaResponse;
  } catch (e) {
    return {
      ok: false,
      error: {
        kind: "nhtsa-unreachable",
        message: `Could not parse NHTSA response: ${e instanceof Error ? e.message : String(e)}`,
      },
    };
  }
  const raw = extractVinFields(body);
  // NHTSA never returns "no result" — invalid VINs come back with an
  // ErrorCode field and otherwise-empty data. Treat a response where
  // none of our promoted fields landed as an empty decode.
  if (Object.values(raw).every((v) => v === null || v === undefined)) {
    return {
      ok: false,
      error: {
        kind: "nhtsa-empty",
        message:
          body.Message ?? "NHTSA returned no decoded fields for this VIN.",
      },
    };
  }
  return {
    ok: true,
    result: {
      source: "nhtsa_vdecoder",
      decoded_at: new Date().toISOString(),
      raw,
    },
  };
}
