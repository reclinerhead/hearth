// Pure helpers for pulling our canonical address fields out of a Mapbox
// Address Autofill retrieve feature. Kept side-effect free so they can be
// unit-tested without spinning up the form or the database.
//
// The Mapbox feature shape used here is a structural subset of
// `AddressAutofillFeatureSuggestion` from `@mapbox/search-js-core`. We avoid
// importing that type directly so this module stays cheap to test and remains
// usable from a server action that's already trusting the shape over the wire.

export interface MapboxContextItem {
  id?: string;
  text?: string;
  mapbox_id?: string;
}

export interface MapboxRetrievedFeature {
  type?: string;
  geometry?: {
    type?: string;
    coordinates?: [number, number];
  };
  properties?: {
    mapbox_id?: string;
    feature_name?: string;
    full_address?: string;
    address_line1?: string;
    address_line2?: string;
    address_level1?: string; // state (e.g. "Michigan")
    address_level2?: string; // city/locality (e.g. "Kalamazoo")
    postcode?: string;
    country?: string;
    country_code?: string;
    context?: MapboxContextItem[];
  };
}

export interface ExtractedAddress {
  address_line1: string;
  address_line2: string | null;
  city: string;
  state: string;
  postal_code: string;
  country: string;
  county: string | null;
  latitude: number;
  longitude: number;
  mapbox_id: string | null;
}

/**
 * Pull the county name out of a Mapbox feature's context array.
 *
 * Mapbox returns administrative hierarchy in `context`, with each entry's `id`
 * prefixed by its type (`country.123`, `region.123`, `district.123`, ...).
 * In the US, counties are tagged as `district`. We strip a trailing " County"
 * suffix so callers can render "Kalamazoo" rather than "Kalamazoo County".
 *
 * Returns null when no district entry exists or has no usable text — public
 * records lookups outside the US will fail this check, which is fine: the
 * field is nullable on the table.
 */
export function extractCounty(
  context: MapboxContextItem[] | undefined,
): string | null {
  if (!context || context.length === 0) return null;

  const district = context.find((c) => c.id?.startsWith("district."));
  if (!district?.text) return null;

  return district.text.replace(/\s+County$/i, "").trim() || null;
}

/**
 * Extract the address fields we persist on `hearth.houses` from a Mapbox
 * retrieve feature. Throws if required fields are missing — those would
 * indicate the feature didn't come from Address Autofill, since Autofill
 * guarantees a structured address result.
 */
export function extractAddress(
  feature: MapboxRetrievedFeature,
): ExtractedAddress {
  const props = feature.properties ?? {};
  const coords = feature.geometry?.coordinates;

  const addressLine1 = props.address_line1?.trim();
  const city = props.address_level2?.trim();
  const state = props.address_level1?.trim();
  const postalCode = props.postcode?.trim();
  const country = (props.country_code ?? "US").trim().toUpperCase();

  if (!addressLine1) throw new Error("Mapbox feature missing address_line1");
  if (!city) throw new Error("Mapbox feature missing city (address_level2)");
  if (!state) throw new Error("Mapbox feature missing state (address_level1)");
  if (!postalCode) throw new Error("Mapbox feature missing postcode");
  if (!coords || coords.length !== 2) {
    throw new Error("Mapbox feature missing geometry coordinates");
  }

  const [longitude, latitude] = coords;

  return {
    address_line1: addressLine1,
    address_line2: props.address_line2?.trim() || null,
    city,
    state,
    postal_code: postalCode,
    country,
    county: extractCounty(props.context),
    latitude,
    longitude,
    mapbox_id: props.mapbox_id?.trim() || null,
  };
}
