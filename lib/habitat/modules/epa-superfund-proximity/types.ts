/**
 * Per-site payload shapes that land inside `HabitatFinding.findings`
 * for the EPA Superfund Proximity module. Extracted from index.ts so
 * both the module orchestration code and the per-site detail component
 * (`components/site-detail.tsx`) can consume them without index.ts and
 * site-detail.tsx forming an import cycle.
 *
 * These types are the contract between what `check()` writes to
 * `hearth.habitat_findings.findings` (jsonb) and what the modal's
 * `renderDetail` slot reads back when the user drills into a site.
 */

import type { NplCode, Tier } from "./severity";

/**
 * One Superfund site as it appears inside `findings.sites`. Split into
 * `site` (place-in-the-world facts) and `context` (per-house
 * relationship) so a future cache table can persist `site` and
 * recompute `context` per house.
 */
export type SiteEntry = {
  site: {
    epa_id: string;
    sems_site_id: string;
    /** Title-cased site name suitable for direct UI display. */
    name_display: string;
    /** EPA's raw ALL-CAPS name — preserved for debugging / audit. */
    name_original: string;
    address: {
      street: string;
      city: string;
      county: string;
      state: string;
      zip: string;
    };
    npl_status: {
      code: NplCode;
      label: string;
    };
    /**
     * Display-formatted contaminant strings (already passed through
     * `formatContaminantName` at check() time). May be an empty array
     * — EPA does not publish a contaminant inventory for every site.
     */
    contaminants: string[];
    federal_facility: boolean;
    archived: boolean;
    /**
     * Date EPA archived the site, when `archived` is true. EPA returns
     * an ISO-ish string ("2024-01-15") or null. Passed through verbatim
     * — the display layer formats it. Nullable, and absent on rows
     * persisted before this field landed.
     */
    archived_date: string | null;
    /**
     * EPA Region code, zero-padded ("01", "05", "09"). Passed through
     * verbatim from `fk_ref_region_code` in the EPA response. Nullable,
     * and absent on rows persisted before this field landed.
     */
    epa_region_code: string | null;
    /** Direct link to the site's EPA Cumulis profile. */
    profile_url: string;
  };
  context: {
    distance_miles: number;
    /** 16-point compass abbreviation, e.g. "ENE". */
    bearing: string;
    tier: Tier;
    severity: "concern" | "caution" | "neutral";
    /**
     * Caveat attached when EPA's single representative point is known
     * to be a poor proxy for the actual site footprint (see index.ts
     * for the heuristic). Omitted when the site is single-location.
     */
    precision_note?: string;
  };
};

/**
 * The full `findings` payload the Superfund module writes. The modal's
 * `renderDetail` slot casts `row.findings` to this shape.
 */
export type SuperfundFindings = {
  search_radius_miles: number;
  search_state: string;
  source_dataset: string;
  source_dataset_note: string;
  total_npl_sites_in_state: number;
  total_sites_with_coordinates: number;
  total_qualifying_sites: number;
  sites: SiteEntry[];
};
