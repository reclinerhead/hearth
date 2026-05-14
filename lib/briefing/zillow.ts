import { generateText } from "ai";

// Strictly-typed shape the rest of the system consumes. Mirrors the JSON
// schema the LLM is asked to return, but with camelCase and out-of-range
// values forced to null by validateZillowResponse.
export type ZillowLookupResult = {
  dataFound: boolean;
  yearBuilt: number | null;
  livingAreaSqft: number | null;
  lotSizeSqft: number | null;
  lotSizeAcres: number | null;
  bedrooms: number | null;
  bathrooms: number | null;
  heating: string | null;
  cooling: string | null;
  parcelNumber: string | null;
  description: string | null;
  sourceUrl: string | null;
};

export type ZillowLookupInput = {
  addressLine1: string;
  city: string;
  state: string;
  postalCode: string;
};

// The raw shape we expect back from the LLM. Field names are snake_case
// because that's what the prompt asks for. Everything is optional/unknown
// here because we re-validate before trusting any value.
type ZillowRawResponse = {
  data_found?: unknown;
  year_built?: unknown;
  living_area_sqft?: unknown;
  lot_size_sqft?: unknown;
  lot_size_acres?: unknown;
  bedrooms?: unknown;
  bathrooms?: unknown;
  heating?: unknown;
  cooling?: unknown;
  parcel_number?: unknown;
  description?: unknown;
  source_url?: unknown;
};

// Perplexity Sonar models are search-grounded by default — they fetch live
// web pages (including Zillow) as part of answering. The earlier Claude /
// GPT-5 / Grok defaults had no web access via the AI Gateway, so they
// always returned data_found=false for real addresses. The fallback uses
// the cheaper sonar variant rather than a non-search model so a failover
// still produces real lookup data instead of a silent miss.
const DEFAULT_PRIMARY_MODEL = "perplexity/sonar-pro";
const DEFAULT_FALLBACK_MODELS = "perplexity/sonar";

const SQFT_PER_ACRE = 43560;

const PROMPT_TEMPLATE = `You are an assistant helping to populate a homeowner's record with publicly available information about their property.

Look up the property at this address using Zillow as your primary source:

{ADDRESS_LINE1}, {CITY}, {STATE} {POSTAL_CODE}

Return a JSON object with the fields below. For any field where you cannot find reliable information, use null rather than guessing. Do not fabricate values.

Required JSON schema:

{
  "data_found": "boolean (true if you were able to find this property on Zillow, false if not)",
  "year_built": "integer or null",
  "living_area_sqft": "integer or null",
  "lot_size_sqft": "integer or null (fill if Zillow displays lot size in square feet)",
  "lot_size_acres": "number or null (fill if Zillow displays lot size in acres, decimals allowed)",
  "bedrooms": "number or null (decimals allowed, e.g. 2.5)",
  "bathrooms": "number or null (decimals allowed, e.g. 1.5)",
  "heating": "string or null (e.g. 'Forced air, Gas' — copy what Zillow shows under Heating)",
  "cooling": "string or null (e.g. 'Central' — copy what Zillow shows under Cooling)",
  "parcel_number": "string or null (the parcel number from the Property > Details section, as a string to preserve leading zeros)",
  "description": "string or null (the listing description if one is available, otherwise null)",
  "source_url": "string or null (the Zillow URL you used)"
}

For lot size: if Zillow displays the value in acres (common for lots over ~0.25 acres), fill lot_size_acres. If displayed in square feet, fill lot_size_sqft. Filling both is fine if Zillow provides both. Do not convert between units yourself.

For parcel_number: return it exactly as displayed, including any leading zeros or formatting. Parcel numbers are identifiers, not arithmetic — preserve the original string.

Return only the JSON object. No preamble, no commentary, no markdown code fences.`;

export function buildZillowPrompt(input: ZillowLookupInput): string {
  return PROMPT_TEMPLATE.replace("{ADDRESS_LINE1}", input.addressLine1)
    .replace("{CITY}", input.city)
    .replace("{STATE}", input.state)
    .replace("{POSTAL_CODE}", input.postalCode);
}

/**
 * Validate the LLM's parsed JSON response and produce a clean, strictly-typed
 * result. Out-of-range values are nulled out rather than failing the whole
 * call — we'd rather store partial data than nothing. The data_found flag
 * is preserved on the result so callers can distinguish "we found the house
 * but Zillow had no description" from "we couldn't find the house at all".
 *
 * Throws if the input isn't a plain object — that signals the LLM didn't
 * return JSON at all, and we want the workflow step to retry.
 */
export function validateZillowResponse(raw: unknown): ZillowLookupResult {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("Zillow response is not a JSON object");
  }

  const r = raw as ZillowRawResponse;
  const dataFound = r.data_found === true;

  if (!dataFound) {
    return {
      dataFound: false,
      yearBuilt: null,
      livingAreaSqft: null,
      lotSizeSqft: null,
      lotSizeAcres: null,
      bedrooms: null,
      bathrooms: null,
      heating: null,
      cooling: null,
      parcelNumber: null,
      description: null,
      sourceUrl: null,
    };
  }

  // Reconcile lot size units: prefer what Zillow actually displayed, derive
  // the other if missing. Acres is the higher-precision source for large
  // lots; sqft is the higher-precision source for small lots. When both
  // are present we trust the model and keep both as-is.
  let lotSizeAcres = validateLotAcres(r.lot_size_acres);
  let lotSizeSqft = validateLotSqft(r.lot_size_sqft);

  if (lotSizeAcres !== null && lotSizeSqft === null) {
    lotSizeSqft = Math.round(lotSizeAcres * SQFT_PER_ACRE);
  } else if (lotSizeSqft !== null && lotSizeAcres === null) {
    lotSizeAcres = Math.round((lotSizeSqft / SQFT_PER_ACRE) * 10000) / 10000;
  }

  return {
    dataFound: true,
    yearBuilt: validateYearBuilt(r.year_built),
    livingAreaSqft: validateSqft(r.living_area_sqft),
    lotSizeSqft,
    lotSizeAcres,
    bedrooms: validateBedrooms(r.bedrooms),
    bathrooms: validateBathrooms(r.bathrooms),
    heating: validateString(r.heating),
    cooling: validateString(r.cooling),
    parcelNumber: validateParcelNumber(r.parcel_number),
    description: validateString(r.description),
    sourceUrl: validateString(r.source_url),
  };
}

function validateYearBuilt(v: unknown): number | null {
  if (typeof v !== "number" || !Number.isInteger(v)) return null;
  if (v < 1700 || v > new Date().getFullYear() + 1) return null;
  return v;
}

function validateSqft(v: unknown): number | null {
  if (typeof v !== "number" || !Number.isInteger(v)) return null;
  if (v < 100 || v > 50000) return null;
  return v;
}

// Lot sqft accepts any finite number in range — derive-from-acres produces
// integers, but the model itself may return a non-integer sqft. We round
// to an integer at the boundary since lot_size_sqft is an integer column.
function validateLotSqft(v: unknown): number | null {
  if (typeof v !== "number" || !Number.isFinite(v)) return null;
  // Lots can be quite large — up to ~100 acres before we get suspicious.
  if (v < 100 || v > 4_356_000) return null;
  return Math.round(v);
}

function validateLotAcres(v: unknown): number | null {
  if (typeof v !== "number" || !Number.isFinite(v)) return null;
  if (v <= 0 || v > 100) return null;
  // Round to 4 decimal places to match the numeric(8,4) column precision.
  return Math.round(v * 10000) / 10000;
}

function validateBedrooms(v: unknown): number | null {
  if (typeof v !== "number" || !Number.isFinite(v)) return null;
  if (v <= 0 || v >= 20) return null;
  return v;
}

function validateBathrooms(v: unknown): number | null {
  if (typeof v !== "number" || !Number.isFinite(v)) return null;
  if (v <= 0 || v >= 20) return null;
  return v;
}

function validateString(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const trimmed = v.trim();
  return trimmed.length > 0 ? trimmed : null;
}

// Parcel numbers are identifiers, not arithmetic — they must stay strings
// to preserve leading zeros and any source-specific formatting. The 64-char
// cap is generous (real parcel ids are well under that) and rejects junk
// like a paragraph of description leaking into the wrong field.
function validateParcelNumber(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const trimmed = v.trim();
  if (trimmed.length === 0 || trimmed.length > 64) return null;
  return trimmed;
}

/**
 * Strip a leading ```json fence and a trailing ``` if present. Models
 * sometimes wrap JSON in code fences despite the prompt asking them not to.
 */
function stripJsonFence(text: string): string {
  const trimmed = text.trim();
  if (trimmed.startsWith("```")) {
    return trimmed
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/\s*```$/, "")
      .trim();
  }
  return trimmed;
}

/**
 * Call the AI Gateway to look up a property on Zillow and return structured
 * facts. The function does not write to the database — that happens in the
 * workflow step that wraps this call. Keeping the lookup pure makes it easy
 * to test with a mocked AI Gateway.
 */
export async function lookupHouseOnZillow(
  input: ZillowLookupInput,
): Promise<ZillowLookupResult> {
  const primary = process.env.BRIEFING_PRIMARY_MODEL || DEFAULT_PRIMARY_MODEL;
  const fallbacks = (
    process.env.BRIEFING_FALLBACK_MODELS || DEFAULT_FALLBACK_MODELS
  )
    .split(",")
    .map((m) => m.trim())
    .filter(Boolean);

  const { text, finishReason, usage } = await generateText({
    model: primary,
    prompt: buildZillowPrompt(input),
    providerOptions: {
      gateway: {
        // The full ordered list including the primary; the Gateway tries
        // them in order until one succeeds, so this gives us automatic
        // model-level fallback without re-issuing the call ourselves.
        models: [primary, ...fallbacks],
      },
    },
  });

  // Temporary instrumentation — diagnosing why year_built / lot_size /
  // heating / cooling / parcel come back null on properties Zillow clearly
  // has data for. We want to distinguish three failure modes:
  //   - finishReason === 'length' + JSON ends mid-field  → output token cap
  //   - raw text contains explicit `null`s for missing fields → off-market
  //     page (Zillow hides those fields) or Sonar laziness
  //   - raw text omits the fields entirely → prompt schema not respected
  // Remove once diagnosed (tracked in #11).
  console.log("[briefing.zillow] raw", {
    address: `${input.addressLine1}, ${input.city}, ${input.state} ${input.postalCode}`,
    finishReason,
    usage,
    textLength: text.length,
    text,
  });

  let parsed: unknown;
  try {
    parsed = JSON.parse(stripJsonFence(text));
  } catch (cause) {
    throw new Error("Zillow LLM response was not valid JSON", { cause });
  }

  return validateZillowResponse(parsed);
}
