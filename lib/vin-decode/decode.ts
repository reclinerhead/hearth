// VIN decode helper using NHTSA's free vDecoder API.
//
// This is deterministic and free — no LLM, no API key, no model
// selection. The API speaks JSON and returns the manufacturer's
// recorded fields for any North American VIN. For Hearth we keep the
// raw output minus the noise (NHTSA returns ~130 fields per VIN; we
// promote only the handful that surface on the detail page) and store
// the rest unparsed inside metadata.vin_decode for future use.

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

// Build the NHTSA vDecoder URL. Public so tests don't have to hard-code
// it and so any future swap (e.g. DecodeVinValuesExtended) becomes a
// one-line change.
export function buildNhtsaDecodeUrl(vin: string): string {
  const normalized = normalizeVin(vin);
  return `https://vpic.nhtsa.dot.gov/api/vehicles/decodevin/${encodeURIComponent(normalized)}?format=json`;
}

// NHTSA's response shape — the parts we care about.
type NhtsaResultRow = {
  Variable: string;
  Value: string | null;
};
type NhtsaResponse = {
  Count?: number;
  Message?: string;
  Results?: NhtsaResultRow[];
};

/**
 * Pure helper: turn an NHTSA response body into our trimmed
 * `{ field: value }` record, dropping NHTSA's all-empty rows and the
 * fields we don't surface. Exposed so the test can exercise the
 * extraction without mocking the network.
 */
export function extractVinFields(body: NhtsaResponse): VinDecodeRaw {
  const wanted = new Set<string>(VIN_DECODE_FIELDS);
  const out: VinDecodeRaw = {};
  for (const row of body.Results ?? []) {
    if (!wanted.has(row.Variable)) continue;
    const value = row.Value;
    // NHTSA returns "" or "Not Applicable" for unknown fields — collapse
    // both to null so the detail page's "render only if present" rule
    // doesn't surface stub strings as if they were real.
    if (
      value === null ||
      value === "" ||
      value === "Not Applicable" ||
      value === "0"
    ) {
      out[row.Variable as VinDecodeField] = null;
    } else {
      out[row.Variable as VinDecodeField] = value;
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
