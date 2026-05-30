// Pure ranking helper for the dashboard "Lifecycle outlook" panel
// (issue #212). Takes the house's inventory rows and a reference date,
// returns the top three big-ticket items closest to (or past) the end of
// their typical service life, plus the counts the panel's nudge needs.
//
// Lives in its own file, pure + tested, for the same reason
// tier-grouping.ts does: the age math, the fraction ranking, and the
// reference-date normalization are exactly the kind of thing that breaks
// silently (an off-by-one on a boundary, a wall-clock timezone slip) and
// would never be caught by `pnpm build` or a glance at a Vercel preview.
//
// This is a replacement-horizon view, deliberately distinct from the
// maintenance module's recurring-task view — see the maintenance spoke.
// We never write anything; this is a read-only derivation over existing
// inventory rows.

import { resolveServiceLife } from "./service-life";

// Gregorian mean year. Using a single constant (rather than 365) keeps
// the fractional-age math from drifting noticeably across leap years for
// the multi-decade horizons this panel deals in.
const DAYS_PER_YEAR = 365.2425;
const MS_PER_DAY = 1000 * 60 * 60 * 24;
const MS_PER_YEAR = DAYS_PER_YEAR * MS_PER_DAY;

// Fraction-of-life boundaries. >= PAST is past typical lifespan; >=
// APPROACHING (but < PAST) is nearing end of life; below is on track.
const FRACTION_PAST = 1.0;
const FRACTION_APPROACHING = 0.75;

const TOP_N = 3;

export type LifecycleSignal = "past_life" | "approaching" | "on_track";

/** Minimal inventory shape this helper needs. Mirrors the columns the
 * dashboard wrapper selects from hearth.inventory. */
export type LifecycleOutlookItem = {
  id: string;
  name: string;
  installed_on: string | null;
  status: string | null;
};

export type LifecycleOutlookEntry = {
  id: string;
  /** The user's own item name ("Carrier furnace"). */
  name: string;
  /** Canonical category label from the service-life table ("Furnace"). */
  label: string;
  /** Four-digit install year, for the quiet age line. */
  installedYear: number;
  /** Whole-year age, rounded, for display ("12 yr old"). */
  ageYears: number;
  /** Typical service life in years for the matched category. */
  typicalYears: number;
  /** ageYears / typicalYears, unrounded — the ranking key. */
  fractionOfLife: number;
  signal: LifecycleSignal;
};

export type LifecycleOutlook = {
  /** Top-N ranked entries (closest to / past end of life first). */
  entries: LifecycleOutlookEntry[];
  /**
   * Active items that matched a service-life category AND carry a usable
   * install date — i.e. the items that were eligible for ranking.
   */
  rankableCount: number;
  /**
   * Active items that matched a service-life category, regardless of
   * whether they have an install date. The nudge reads
   * `rankableCount of bigTicketCount have an install date`.
   */
  bigTicketCount: number;
};

/**
 * Build the lifecycle outlook from a house's inventory rows.
 *
 * Returns the top three rankable items plus the two counts the panel's
 * nudge line needs. The return shape extends the issue's original
 * `LifecycleOutlookEntry[]` sketch to a struct so the null-install
 * exclusion + count stays in the pure, tested layer rather than being
 * re-derived in the component.
 */
export function buildLifecycleOutlook(
  items: LifecycleOutlookItem[],
  referenceDate: Date,
): LifecycleOutlook {
  const today = normalizeToDateOnly(referenceDate);

  let bigTicketCount = 0;
  const entries: LifecycleOutlookEntry[] = [];

  for (const item of items) {
    if (item.status !== "active") continue;
    const serviceLife = resolveServiceLife(item.name);
    if (!serviceLife) continue;

    // Matched a tracked category — counts as a big-ticket item whether or
    // not we can rank it.
    bigTicketCount += 1;

    const installed = item.installed_on
      ? parseDateOnly(item.installed_on)
      : null;
    if (!installed) continue; // counted above, but not rankable

    const ageMs = today.getTime() - installed.getTime();
    const ageYearsExact = ageMs / MS_PER_YEAR;
    const fractionOfLife = ageYearsExact / serviceLife.typicalYears;

    entries.push({
      id: item.id,
      name: item.name,
      label: serviceLife.label,
      installedYear: installed.getUTCFullYear(),
      ageYears: Math.max(0, Math.round(ageYearsExact)),
      typicalYears: serviceLife.typicalYears,
      fractionOfLife,
      signal: signalFor(fractionOfLife),
    });
  }

  // Closest to / past end of life first. Tie-break: the older item (by
  // absolute age) wins, so on equal fraction the bigger replacement
  // surfaces ahead of a younger one that happens to share the ratio.
  // Since fraction = age / typicalYears, equal fractions imply age is
  // proportional to typicalYears — so the longer-lived category is the
  // older item, and comparing typicalYears is exactly "older age wins"
  // without depending on the rounded display age.
  entries.sort((a, b) => {
    if (b.fractionOfLife !== a.fractionOfLife) {
      return b.fractionOfLife - a.fractionOfLife;
    }
    return b.typicalYears - a.typicalYears;
  });

  return {
    entries: entries.slice(0, TOP_N),
    rankableCount: entries.length,
    bigTicketCount,
  };
}

function signalFor(fractionOfLife: number): LifecycleSignal {
  if (fractionOfLife >= FRACTION_PAST) return "past_life";
  if (fractionOfLife >= FRACTION_APPROACHING) return "approaching";
  return "on_track";
}

function normalizeToDateOnly(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

function parseDateOnly(yyyymmdd: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(yyyymmdd);
  if (!match) return null;
  const [, y, m, d] = match;
  const date = new Date(Date.UTC(Number(y), Number(m) - 1, Number(d)));
  return Number.isNaN(date.getTime()) ? null : date;
}
