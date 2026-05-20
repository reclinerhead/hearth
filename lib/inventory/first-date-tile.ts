// Helper for the inventory detail page's hero tile row (issue #77).
//
// The first of the three "Installed / Last serviced / Next due" tiles
// now has a fallback rule: when installed_on is null but a high-
// confidence manufacture date is present, the tile flips its eyebrow
// from "Installed" to "Manufactured" and renders the decoded date.
// Lifted out of inventory-detail-view.tsx so the four-way decision can
// be unit-tested without the React surface.
//
// Persistence contract (mirrored here defensively): the decode-serial
// route only writes manufacture_date when confidence === "high", so in
// practice the only confidence value that ever reaches this helper from
// the DB is "high". The medium/low branch is still covered because the
// schema is column-by-column on hearth.inventory — defending against
// future schema changes that decouple the two is cheap.

export type ManufactureDatePrecision = "year" | "month" | "week";
export type ManufactureDateConfidence = "high" | "medium" | "low";

export type FirstDateTile =
  | { kind: "installed"; isoDate: string }
  | {
      kind: "manufactured";
      manufactureDate: string;
      precision: ManufactureDatePrecision | null;
    }
  | { kind: "unknown" };

export function pickFirstDateTile(input: {
  installedOn: string | null;
  manufactureDate: string | null;
  manufactureDatePrecision: ManufactureDatePrecision | null;
  manufactureDateConfidence: ManufactureDateConfidence | null;
}): FirstDateTile {
  if (input.installedOn) {
    return { kind: "installed", isoDate: input.installedOn };
  }
  if (
    input.manufactureDate &&
    input.manufactureDateConfidence === "high"
  ) {
    return {
      kind: "manufactured",
      manufactureDate: input.manufactureDate,
      precision: input.manufactureDatePrecision,
    };
  }
  return { kind: "unknown" };
}

// Format the decoded manufacture date for display based on its
// precision. Tolerant of malformed input so a bad row never throws —
// falls back to the raw string. Examples:
//   ("2014",     "year")  → "2014"
//   ("2014-10",  "month") → "Oct 2014"
//   ("2014-W44", "week")  → "Oct 2014"  (ISO 8601 week → month)
export function formatManufactureDate(
  value: string,
  precision: ManufactureDatePrecision | null,
): string {
  if (precision === "year") {
    return value.slice(0, 4);
  }
  if (precision === "month") {
    const [yearStr, monthStr] = value.split("-");
    const year = Number(yearStr);
    const month = Number(monthStr);
    if (
      !Number.isFinite(year) ||
      !Number.isFinite(month) ||
      month < 1 ||
      month > 12
    ) {
      return value;
    }
    const date = new Date(Date.UTC(year, month - 1, 1));
    return date.toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      timeZone: "UTC",
    });
  }
  if (precision === "week") {
    const match = /^(\d{4})-W(\d{1,2})$/.exec(value);
    if (!match) return value;
    const year = Number(match[1]);
    const week = Number(match[2]);
    if (week < 1 || week > 53) return value;
    // ISO 8601 week date → UTC Date. The Thursday of an ISO week
    // belongs to that week's "year"; computing from week 1's Thursday
    // and stepping forward by (week-1) weeks yields any Thursday in
    // the target week. We only need the month, so Thursday is fine.
    const jan4 = new Date(Date.UTC(year, 0, 4));
    const jan4Day = jan4.getUTCDay() || 7; // Mon=1..Sun=7
    const week1Thursday = new Date(jan4);
    week1Thursday.setUTCDate(jan4.getUTCDate() + (4 - jan4Day));
    const target = new Date(week1Thursday);
    target.setUTCDate(week1Thursday.getUTCDate() + (week - 1) * 7);
    return target.toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      timeZone: "UTC",
    });
  }
  return value;
}
