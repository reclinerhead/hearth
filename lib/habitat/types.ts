import type { ReactNode } from "react";
import type { ActivityLog } from "./activity-log";
import type { HabitatFindingRow } from "@/lib/hooks/use-habitat-findings";

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

  /**
   * Issue #142 — property-situation inputs. Used today by the planned
   * Superfund label-calibration and recommended-actions follow-ups
   * (#144, #149); future water-system and radon-refinement modules
   * will read the same fields.
   *
   * `waterSource`:
   *   - `"well"`     — private well
   *   - `"municipal"` — city / utility supply
   *   - `"shared"`   — neighborhood well or shared private system
   *   - `"unknown"`  — user explicitly said they don't know
   *   - `null`       — never captured (legacy row, or onboarding skipped)
   *
   * `basementPresent`:
   *   - `true`  — has a basement
   *   - `false` — no basement
   *   - `null`  — user picked "Not sure" OR never captured (crawl-space
   *               and partial-basement cases land here)
   *
   * Modules should treat `null` and `"unknown"` as "we can't reason
   * about this — suppress rather than guess."
   */
  waterSource: "well" | "municipal" | "shared" | "unknown" | null;
  basementPresent: boolean | null;
}

/**
 * Severity scale for findings. Spans positives ('beneficial') through
 * neutrals to concerns ('critical'), so a single sort key can rank
 * findings for dashboard display. Must stay in sync with the
 * habitat_findings_severity_check constraint in
 * supabase/migrations/20260517171126_habitat-findings-module-changes.sql,
 * and with the severity_weight generated column defined in that same
 * migration.
 *
 * Suggested ordering for UI (concerns first, positives last):
 *   critical > concern > caution > neutral > favorable > beneficial
 *
 * Modules pick the value that best describes their finding. EPA Radon
 * Zone 1 counties are 'concern' because the regional average exceeds the
 * 4 pCi/L action threshold. A Walk Score above 70 might land as
 * 'favorable'. A typical Zone X flood designation is 'favorable' (no
 * flood risk). Use 'neutral' for facts that are neither concern nor
 * positive — soil composition, average winter low, etc. 'beneficial' is
 * reserved for findings that the user should take real comfort in (e.g.
 * a public water system with consistently clean test results); 'critical'
 * for findings that warrant immediate action.
 */
export type HabitatSeverity =
  | "beneficial"
  | "favorable"
  | "neutral"
  | "caution"
  | "concern"
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
  /**
   * Step-by-step record of what the module did during this check().
   * Produced by calling createActivityLogger() at the top of check(),
   * emitting steps as the check progresses, and calling finalize()
   * before returning. The orchestrator persists this verbatim into
   * the activity_log column.
   *
   * Optional during the backfill period — modules retrofitted to emit
   * logs return one; modules not yet retrofitted leave it absent and
   * the column stays null on the row.
   */
  activityLog?: ActivityLog;
  /**
   * Transient debug capture for the dev-only file-based prompt logs
   * (issue #158). Modules that wrap an AI call inside check() can
   * populate keyed slots here; the habitat workflow's
   * `writeModuleDebugLog` step reads `debug` after check() returns
   * and dispatches each populated slot to the matching log helper
   * via dynamic import (which keeps the helper's node:fs/promises
   * dependency out of the static workflow bundle).
   *
   * **Never persisted.** The orchestrator's row-write pulls
   * `finding.findings` / `actions` / `activityLog` / `sourceUrl`
   * explicitly; `debug` is read separately for the log step and
   * then dropped on the floor. Don't put anything in here that
   * needs to survive the workflow.
   *
   * The slot map is open-ended (`Record<string, unknown>`) so future
   * modules can add their own keys without changes here. The
   * matching helper module lives next to the module that emits it
   * (e.g. `lib/habitat/modules/epa-superfund-proximity/debug-log.ts`).
   */
  debug?: Record<string, unknown>;
}

/**
 * One drillable item rendered as a card in the finding modal's overview
 * pane. Visual treatment matches the dashboard's compact finding tile —
 * severity dot, eyebrow, headline, short subtitle.
 *
 * Modules that produce multi-item findings (Superfund returns a list of
 * sites; a future flood-history module might return per-event panels)
 * surface those items as OverviewCards via `HabitatModule.getOverviewCards`.
 * Modules with a single coherent finding leave the field unset and the
 * modal stays purely generic.
 */
export type OverviewCard = {
  /**
   * Stable identifier within this finding. The modal hands this back to
   * `renderDetail()` so the module can locate the right item in the
   * row's findings JSON. For Superfund this is the EPA site ID; for
   * future modules whatever stable key fits.
   */
  id: string;
  /** Short, muted line above the headline (e.g. "Tier 1 · 0.4 mi ENE"). */
  eyebrow: string;
  /** Primary line (e.g. the site name). */
  headline: string;
  /**
   * Optional. A second-line emphasis below the headline and above the
   * subtitle, more prominent than the subtitle but less so than the
   * headline. The Superfund module surfaces a plain-English
   * contaminant-category summary here (issue #145) — e.g. "PCBs and
   * dioxins, heavy metals" — so a triaging user can see what's
   * actually at the site without opening the detail pane. When the
   * module has nothing useful to put here (Georgia-Pacific's empty
   * contaminants array case), leave it undefined and the modal
   * suppresses the row cleanly.
   */
  subheading?: string;
  /** Supporting line, one line tall (e.g. "2426 King Hwy · Part of NPL site"). */
  subtitle: string;
  /** Severity weighting for sort and the severity dot. */
  severity: HabitatSeverity;
  /**
   * Optional per-card source URL. When set, the modal's footer "View
   * source" link points here while the user is in the detail pane for
   * this card; otherwise it falls back to the row's `source_url`.
   */
  sourceUrl?: string;
};

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

  /**
   * Optional all-caps eyebrow label rendered above each tile in the
   * onboarding / refresh discovery modal to surface the data source
   * ("EPA RADON CHECK", "FEMA FLOOD ZONE CHECK"). Falls back to
   * `name.toUpperCase()` when omitted, so legacy modules still render
   * a sensible label — but module authors should prefer a hand-tuned
   * label that reads as an action ("EPA RADON CHECK") rather than a
   * dataset slug ("EPA RADON ZONE"). Plain string, no punctuation;
   * the modal handles styling via the global `.eyebrow` class.
   */
  sourceLabel?: string;

  /** One-sentence "what this checks." Used in "what we're watching" UI. */
  description: string;

  /**
   * Dashboard-grouping category. Persisted into
   * hearth.habitat_findings.category on every upsert by the
   * orchestrator. Backfilled by
   * supabase/migrations/20260517171126_habitat-findings-module-changes.sql
   * for the modules that existed at the time; every new module
   * declares its own category here.
   *
   * Today there's only one category in use. The type is left as a
   * string-literal union so future categories ("structural", "civic"
   * for crime data, etc.) get added explicitly rather than slipping
   * in by typo.
   */
  category: "environmental";

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

  /**
   * Optional. Section header rendered above the list of overview cards
   * in the finding modal. Defaults to "Details" when omitted. Set this
   * to phrasing that fits the module's items — Superfund uses "Sites
   * near your home".
   */
  overviewCardsHeader?: string;

  /**
   * Optional. If the module produces structured items the user can drill
   * into (multiple Superfund sites, multiple flood-zone panels, multiple
   * historical assessments, etc.), this function returns one card
   * descriptor per item from a finding's row.
   *
   * Cards appear in the modal's overview pane below the action shelf
   * and above the activity log. Clicking a card swaps the modal body
   * to the detail pane and invokes `renderDetail` with the card's id.
   *
   * The **module owns the card order** — the modal renders cards in
   * the order this function returns them. (Issue #140: Superfund's
   * label-desc → severity-desc → distance-asc order can't be expressed
   * in a generic modal-side compare because the modal doesn't know
   * about the module-specific label concept.) Modules with no strong
   * opinion on order should sort severity-desc themselves.
   *
   * Return [] or omit the function entirely when no drill-down is
   * needed — the modal then falls back to its pre-slotted behavior.
   *
   * Imports `HabitatFindingRow` from `lib/hooks/use-habitat-findings`
   * as a type-only import — the runtime side of that module is
   * `"use client"` and lives downstream of types.ts, but `import type`
   * is erased at compile time so it never pulls the client runtime
   * into a server bundle.
   */
  getOverviewCards?: (row: HabitatFindingRow) => OverviewCard[];

  /**
   * Optional. Renders the detail pane for a single overview card.
   * Called only after the user clicks a card in the overview.
   *
   * Module authors are responsible for the contents of the returned
   * element, but it should NOT include its own back affordance — the
   * shell provides one above whatever this renders.
   */
  renderDetail?: (row: HabitatFindingRow, cardId: string) => ReactNode;

  /**
   * Optional. Replaces the severity word in the modal header with a
   * module-computed label word + color.
   *
   * Three return values, three behaviors:
   *   - `{ word, color }` — modal renders that word in the eyebrow.
   *   - `null` — explicit suppression. Modal shows the severity dot
   *     and module name only, deliberately omitting any second eyebrow
   *     string. Used when the module computed the label and decided
   *     it can't characterize the finding confidently (a bare label
   *     would read as endorsed reassurance).
   *   - `undefined` — "no opinion for this row." Modal falls back to
   *     the default severity word, same as if the module didn't
   *     implement the slot at all. Used for legacy rows persisted
   *     before the label concept existed, so they keep rendering the
   *     severity word until the yearly cadence backfills.
   *
   * Introduced by the Superfund module in issue #140; the "label"
   * concept is parallel to severity and is suppressed when the module
   * can't characterize the finding confidently.
   */
  getFindingLabel?: (
    row: HabitatFindingRow,
  ) => { word: string; color: string } | null | undefined;

  /**
   * Optional. Renders a short banner paragraph at the top of the
   * modal's overview pane, above the overview-cards list. Returning
   * `null` suppresses the banner — the overview pane falls back to
   * the cards + action shelf + activity log layout it had before.
   *
   * Introduced by the Superfund module in issue #140 for the
   * AI-generated portfolio summary. The slot is deliberately narrow
   * (plain text only) so module code stays free of JSX-runtime
   * imports — the same discipline `renderDetail` uses by passing
   * components through `createElement`.
   */
  getOverviewBanner?: (
    row: HabitatFindingRow,
  ) => { text: string } | null;

  /**
   * Optional. Returns a list of "what you can do next" cards
   * rendered between the overview banner and the overview-cards
   * list. Empty array suppresses the section entirely.
   *
   * Introduced by the Superfund module in issue #144 for the
   * water-source-aware recommended-actions section. The slot is
   * data-only (icon name + plain text + optional link) so module
   * code stays free of React-runtime imports; the modal owns the
   * actual rendering.
   *
   * The action data is precomputed at check() time (the
   * compute call needs the full HouseContext, which isn't on the
   * row), so the slot is a pure read off the persisted finding —
   * the same pattern getFindingLabel and getOverviewBanner use.
   */
  getRecommendedActions?: (
    row: HabitatFindingRow,
  ) => Array<{
    id: string;
    icon: string;
    headline: string;
    supporting_line: string;
    link?: { label: string; url: string };
  }>;

  /**
   * Optional. Renders a module-specific overview pane that replaces
   * the default banner + recommended-actions + overview-cards layout.
   *
   * Modules implementing this slot own the entire body between the
   * modal header and the activity log. Use sparingly — the default
   * generic layout (banner / recommended actions / overview cards /
   * action shelf) is the right answer for most modules. WQA is the
   * first consumer because its overview is a structured landing page,
   * not a card list (issue #171).
   *
   * The slot is passed `row` only — no React hooks, no module-side
   * fetches. All data must already be in the persisted finding.
   *
   * Mechanics when set: the modal renders header → `renderOverviewBody`
   * → activity log → footer. The cards / banner / recommended-actions
   * / generic-actions sections are bypassed entirely; the module
   * includes whatever it needs from those inside its own body.
   *
   * Imports `HabitatFindingRow` from `lib/hooks/use-habitat-findings`
   * as a type-only import, same discipline as `getOverviewCards` and
   * `renderDetail`.
   *
   * The `context` argument carries surface-level facts the module
   * needs to render interactive affordances — currently `houseId` so
   * the WQA module can spawn its CCR upload modal with the right
   * scope. Optional second argument so existing callers (the modal
   * shell) can keep working even before they thread context through.
   */
  renderOverviewBody?: (
    row: HabitatFindingRow,
    context: { houseId: string },
  ) => ReactNode;
}
