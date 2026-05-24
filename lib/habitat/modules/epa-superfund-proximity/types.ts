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

import type { CommunityInvolvementCoordinator } from "./cumulis";
import type { SuperfundLabel } from "./label";
import type { RecommendedAction } from "./recommended-actions";
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
    /** Direct link to the site's EPA Cumulis profile (overview page). */
    profile_url: string;
    /**
     * Direct link to the site's documents library on EPA's Cumulis
     * page (Reports & Documents, Administrative Records). Issue #143.
     * Always present — the URL is constructed from the site_id and
     * does not require a separate HTTP lookup.
     */
    documents_url: string;
    /**
     * Community Involvement Coordinator pulled from EPA's Cumulis
     * Contacts sub-page (issue #143). The CIC is the homeowner-facing
     * EPA contact for the site — distinct from the Remedial Project
     * Manager, which is the technical-cleanup contact and not
     * surfaced here. Null when EPA hasn't designated a CIC for the
     * site (Peerless Plating Co. is the canonical example in our test
     * sample) or when the scrape failed (network error, page error,
     * timeout — soft-fail by design). Each sub-field is independently
     * nullable: most sites publish name + email; phone is occasionally
     * absent.
     *
     * Optional on the contract because rows persisted before #143
     * landed do not carry it; the field backfills on the next yearly
     * cadence run.
     */
    community_involvement_coordinator?: CommunityInvolvementCoordinator | null;
  };
  context: {
    distance_miles: number;
    /** 16-point compass abbreviation, e.g. "ENE". */
    bearing: string;
    tier: Tier;
    severity: "concern" | "caution" | "neutral";
    /**
     * Per-site label computed by `label.ts` (issue #140). A parallel
     * concept to `severity`: rates how relevant this site is to a
     * homeowner reasoning about whether to take action, given
     * distance, NPL status, and contaminant concern levels.
     *
     * Null means "suppressed — we can't characterize confidently"
     * (e.g. Tier 3 site with no contaminants published). The display
     * layer renders nothing rather than defaulting to a bare word
     * that could read as Hearth-endorsed reassurance.
     *
     * Optional on the contract because rows persisted before #140
     * landed do not carry it; they backfill on the next yearly
     * cadence run.
     */
    label?: SuperfundLabel | null;
    /**
     * Caveat attached when EPA's single representative point is known
     * to be a poor proxy for the actual site footprint (see index.ts
     * for the heuristic). Omitted when the site is single-location.
     */
    precision_note?: string;
  };
};

/**
 * Persisted shape of the AI-generated portfolio summary (issue #140).
 * Generated once at check() time and overwritten on the next yearly
 * cadence run — not regenerated per view. Soft-fail: when the model
 * call can't run or returns an invalid shape, `text` is null and
 * `error_reason` carries the explanation for the debug log.
 */
export type PortfolioSummary = {
  text: string | null;
  model: string | null;
  /** ISO timestamp; null when no call ran (env unset, AI error). */
  generated_at: string | null;
  /** Null on success; a short reason string when text is null. */
  error_reason: string | null;
};

/**
 * The full `findings` payload the Superfund module writes. The modal's
 * `renderDetail` slot casts `row.findings` to this shape.
 *
 * `portfolio_label` and `portfolio_summary` landed in issue #140; both
 * are optional on the contract because rows persisted before that PR
 * do not carry them. The display layer guards against absence and the
 * yearly cadence backfills on its next run.
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
  /** Max of the non-null per-site labels; null when all are suppressed. */
  portfolio_label?: SuperfundLabel | null;
  /** AI-generated summary; populated only on the multi-site / single-site path. */
  portfolio_summary?: PortfolioSummary;
  /**
   * Computed at check() time from the qualifying site set plus the
   * user's water source + basement presence (issue #144). Deduplicated
   * across sites; ordered by leverage (water test first, then vapor
   * intrusion). Empty array when no actions apply for this portfolio
   * × user situation. Optional on the contract because rows persisted
   * before #144 don't carry it.
   */
  recommended_actions?: RecommendedAction[];
};
