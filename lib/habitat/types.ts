/**
 * Habitat module contract.
 *
 * A "habitat module" is a self-contained piece of code that knows how to
 * query one public-data source (EPA radon zones, FEMA flood zones, EPA
 * Superfund proximity, Walk Score, etc.) and produce a structured
 * finding about the house's surroundings. Modules live under
 * lib/habitat/modules/<key>/ and are wired into the system by the
 * registry in lib/habitat/registry.ts.
 *
 * The orchestrator (workflows/habitat.ts) iterates over the registered
 * modules, asks each whether it applies to a given house via
 * isApplicable(), runs check() on the applicable ones, and upserts the
 * result into hearth.habitat_findings keyed by (house_id, module_key).
 *
 * Modules are pure-ish: check() may perform I/O (HTTP, file reads), but
 * does not write to the database. The orchestrator owns persistence,
 * lifecycle transitions (running/completed/failed), and retries.
 */

/**
 * Read-only view of a house passed to every module. The orchestrator
 * constructs this from a hearth.houses row before invoking any modules,
 * so modules never read from the database directly.
 *
 * Most modules will only read a few fields — state/county for static
 * lookups, latitude/longitude for spatial queries. Adding fields here
 * is cheap; modules ignore what they don't use.
 *
 * Fields populated by later modules (water system, etc.) are optional
 * and reserved for future extension. Modules that depend on them
 * should guard with isApplicable() rather than trusting presence.
 */
export interface HouseContext {
  houseId: string;
  addressLine1: string;
  city: string;
  state: string;
  county: string | null;
  postalCode: string;
  /**
   * Mapbox populates these at onboarding and the houses column is
   * numeric(9,6). Typed as nullable defensively in case of a malformed
   * row; modules that need coordinates should guard with isApplicable.
   */
  latitude: number | null;
  longitude: number | null;
  parcelId: string | null;
}

/**
 * Severity scale for findings. Spans positives ('good') through
 * neutrals to concerns ('critical'), so a single sort key can rank
 * findings for dashboard display.
 *
 * Suggested ordering for UI (concerns first, positives last):
 *   critical > high > moderate > low > neutral > good
 *
 * Modules pick the value that best describes their finding. EPA Radon
 * Zone 1 counties are 'high' because the regional average exceeds the
 * 4 pCi/L action threshold. A Walk Score above 70 might land as
 * 'good'. A typical Zone X flood designation is 'good' (no flood
 * risk). Use 'neutral' for facts that are neither concern nor
 * positive — soil composition, average winter low, etc.
 */
export type HabitatSeverity =
  | "good"
  | "neutral"
  | "low"
  | "moderate"
  | "high"
  | "critical";

/**
 * Module-declared re-check cadence. The orchestrator translates this
 * into a concrete next_check_due_at timestamp at persist time.
 *
 *   'once'    — radon zone, lead-paint disclosure. Never auto-rechecks;
 *               next_check_due_at stays null.
 *   'yearly'  — FEMA flood zone, Superfund proximity. Slow-changing
 *               public data that does occasionally update.
 *   'monthly' — reserved.
 *   'weekly'  — reserved.
 *   'daily'   — reserved.
 *   'fast'    — boil water advisories. Polled hours apart; exact
 *               cadence is module-controlled.
 */
export type HabitatCadence =
  | "once"
  | "yearly"
  | "monthly"
  | "weekly"
  | "daily"
  | "fast";

/**
 * A recommended next-step the user can take in response to a finding.
 *
 * Returned by a module's check() and persisted on the habitat_findings
 * row. Per-finding rather than per-module — Zone 1 radon and Zone 3
 * radon share a module but should not share the same call to action.
 *
 * Kinds:
 *   'product' — a consumable/test kit the user can buy. URL goes through
 *               affiliateLink() at construction time.
 *   'link'    — informational link (EPA page, county GIS, etc).
 *   'service' — a directory or finder for local professionals
 *               (mitigators, inspectors). May be geographic.
 */
export type FindingAction =
  | {
      kind: "product";
      label: string;
      url: string;
      priceHint?: string;
    }
  | {
      kind: "link";
      label: string;
      url: string;
    }
  | {
      kind: "service";
      label: string;
      url: string;
    };

/**
 * What a module's check() returns. The orchestrator translates this
 * into a row in hearth.habitat_findings via upsert on
 * (house_id, module_key).
 *
 * `findings` is the module-specific payload — see each module's file
 * for its canonical shape. The dashboard renders headline and summary
 * directly; findings is read by the chat / LLM layer for deeper
 * questions.
 */
export interface HabitatFinding {
  severity: HabitatSeverity;
  headline: string;
  summary: string;
  findings: Record<string, unknown>;
  sourceUrl?: string;
  /**
   * Recommended next steps for this finding. Optional — modules can
   * return findings without actions while we backfill them.
   */
  actions?: FindingAction[];
}

/**
 * The contract every habitat module implements. Each module exports a
 * single default HabitatModule object from lib/habitat/modules/<key>/.
 *
 * Modules MUST be idempotent — running check() twice for the same
 * house should produce equivalent findings. The orchestrator relies on
 * this for safe re-runs and retries.
 */
export interface HabitatModule {
  /** Stable identifier. Matches the module_key column. snake_case. */
  key: string;

  /** Short, human-readable name. Shown in admin/debug views. */
  name: string;

  /** One-sentence "what this checks." Used in "what we're watching" UI. */
  description: string;

  /** Declared re-check cadence. */
  cadence: HabitatCadence;

  /**
   * Optional path to a hero image for this module, served from /public.
   * When present, HabitatFindingTile renders it as a ~128px square on
   * the left of the card. Use a root-relative public URL
   * ("/habitat_module_images/radon.jpg"), not an imported asset, to keep
   * module definitions serializable.
   */
  iconImage?: string;

  /**
   * Whether this module applies to the given house. Returns false to
   * skip (e.g. wildfire risk in Michigan, coastal flooding inland).
   * The orchestrator records 'not_applicable' findings so the UI can
   * honestly say "we considered this and it doesn't apply."
   *
   * Synchronous by design: applicability decisions must be made from
   * HouseContext alone without async lookups. Keeps the filter pass
   * fast and predictable.
   */
  isApplicable(house: HouseContext): boolean;

  /**
   * Produce the current finding for this house. May perform I/O.
   * Should be deterministic given the same HouseContext and the same
   * external data state.
   *
   * Throws on transient or terminal failures; the orchestrator catches
   * and marks the finding 'failed' with the error message.
   */
  check(house: HouseContext): Promise<HabitatFinding>;

  /**
   * Optional short, user-facing string rendered in the first-run
   * onboarding modal after this module's check() resolves. Should
   * lead with what was found, not what was checked — the modal
   * already renders "Checking <module.name>..." before this fires.
   *
   *   "Found a Zone 1 radon risk — adding to your home's concerns"
   *   "Your area is outside the FEMA flood plain — good news"
   *
   * Modules without this function get a generic "Checked successfully"
   * fallback in the modal.
   */
  getOnboardingMessage?: (finding: HabitatFinding) => string;
}
