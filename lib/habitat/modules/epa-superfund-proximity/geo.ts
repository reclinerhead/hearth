/**
 * Geographic helpers used by the EPA Superfund Proximity module.
 *
 * Extracted into their own file so they can be unit-tested in isolation
 * without spinning up the rest of the module. Pure math, no I/O.
 */

const EARTH_RADIUS_MILES = 3958.7613;

export type LatLng = {
  latitude: number;
  longitude: number;
};

/**
 * Great-circle distance between two points on Earth, in miles.
 * Uses the haversine formula — accurate to within a fraction of a percent
 * at the distances this module cares about (sub-10 miles).
 */
export function haversineMiles(a: LatLng, b: LatLng): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.latitude - a.latitude);
  const dLng = toRad(b.longitude - a.longitude);
  const lat1 = toRad(a.latitude);
  const lat2 = toRad(b.latitude);
  const sinDLat = Math.sin(dLat / 2);
  const sinDLng = Math.sin(dLng / 2);
  const h =
    sinDLat * sinDLat + Math.cos(lat1) * Math.cos(lat2) * sinDLng * sinDLng;
  const c = 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
  return EARTH_RADIUS_MILES * c;
}

const COMPASS_POINTS = [
  "N",
  "NNE",
  "NE",
  "ENE",
  "E",
  "ESE",
  "SE",
  "SSE",
  "S",
  "SSW",
  "SW",
  "WSW",
  "W",
  "WNW",
  "NW",
  "NNW",
] as const;

export type CompassBearing = (typeof COMPASS_POINTS)[number];

/**
 * Initial bearing from `from` to `to`, snapped to the nearest 16-point
 * compass label ("N", "NNE", "NE", ...). Returned as a short string for
 * direct use in user-facing copy ("about 1.0 mile north of your home" is
 * generated upstream from this).
 */
export function compassBearing(from: LatLng, to: LatLng): CompassBearing {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const toDeg = (rad: number) => (rad * 180) / Math.PI;
  const lat1 = toRad(from.latitude);
  const lat2 = toRad(to.latitude);
  const dLng = toRad(to.longitude - from.longitude);
  const y = Math.sin(dLng) * Math.cos(lat2);
  const x =
    Math.cos(lat1) * Math.sin(lat2) -
    Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
  const brngDeg = (toDeg(Math.atan2(y, x)) + 360) % 360;
  const idx = Math.round(brngDeg / 22.5) % 16;
  return COMPASS_POINTS[idx];
}
