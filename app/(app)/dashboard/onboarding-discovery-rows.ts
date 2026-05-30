import type { HabitatModule, HabitatSeverity } from "@/lib/habitat/types";

/**
 * Pure row-building helpers for the onboarding discovery modal.
 *
 * Extracted from onboarding-discovery-modal.tsx so the row-shape logic
 * can be unit-tested without spinning up React. The visual rendering
 * stays in the modal (DiscoveryRow); this file owns the mapping from
 * (phase, applicable modules, accumulated copy, accumulated severities)
 * to the list of rows the modal renders.
 *
 * The list length is always `1 + modules.length` — one home-setup
 * confirmation row plus one row per applicable habitat module — for
 * every phase, including `intro`. Reserving every slot up front (in
 * `idle` state) keeps the modal surface from growing or re-centering
 * as habitat results land. See issue #108.
 *
 * Issue #184 reshaped each row from `{ text }` to
 * `{ lead, secondary?, severity? }` so the modal can render bordered
 * card rows with a severity-coloured glyph + a derived relevance pill.
 *
 * Issue #210 dropped the Zillow-backed briefing workflow. The first
 * row is no longer "PUBLIC RECORD SEARCH — built in 1934, 2,210 sq ft"
 * — it's a fixed "HOME SETUP — Your home has been set up." confirmation
 * that lets the modal's pacing rhythm survive without burning AI
 * Gateway credits on stochastic, ToS-violating scraping.
 */

export type Phase =
  | { kind: "intro" }
  | { kind: "briefing-checking" }
  | { kind: "briefing-result" }
  // Issue #142 — interstitial prompt for the two property-situation
  // questions (water source, basement). Inserted between
  // `briefing-result` and `module-checking` so the home-setup beat
  // lands first, then the user answers (or skips), and only then do
  // the habitat modules check in. No auto-advance: the user's Skip /
  // Save click drives the next transition.
  | { kind: "property-questions" }
  | { kind: "module-checking"; index: number }
  | { kind: "module-result"; index: number }
  | { kind: "done" };

export type DiscoveryRowState = "idle" | "checking" | "done";

/**
 * All-caps eyebrow rendered above the home-setup confirmation row.
 * The setup beat isn't a habitat module so it has no `sourceLabel` to
 * read — the modal would otherwise have to special-case it in two
 * places. Lives here next to `buildRowList` so the row contract owns
 * its own label text and tests can assert against it without reaching
 * into the modal.
 */
export const BRIEFING_SOURCE_LABEL = "HOME SETUP";

/**
 * Copy for the home-setup confirmation row across its three states.
 * Inlined here (rather than threaded through props) because the row is
 * fully static — no facts, no async, no per-house variation — so the
 * rows module owns the text and the modal renders it as-is.
 */
const BRIEFING_CHECKING_LEAD = "Setting up your home…";
const BRIEFING_DONE_LEAD = "Your home has been set up.";

export type DiscoveryRowProps = {
  id: string;
  state: DiscoveryRowState;
  /**
   * All-caps source label rendered above the row's lead line as a
   * subtle eyebrow ("EPA RADON CHECK", "HOME SETUP"). Always present in
   * every state so the modal's vertical rhythm is stable from intro
   * through done — the label signals what each tile will show before
   * the result actually lands.
   */
  eyebrow: string;
  /** Bold lead line. Always present, in every state. */
  lead: string;
  /**
   * Optional secondary line rendered below the lead in 13px secondary
   * text. Only meaningful when the row is `done`; non-done rows render
   * a single line and ignore this field.
   */
  secondary?: string;
  /**
   * Severity for habitat-module rows in the `done` state. Drives the
   * glyph (alert-triangle for flagged severities, circle-check
   * otherwise), the card border treatment, and the relevance pill +
   * tooltip. Omitted on the briefing row and on non-done states.
   */
  severity?: HabitatSeverity;
};

/**
 * Generic fallback rendered when a habitat module doesn't expose
 * getOnboardingMessage. Kept deliberately bland so module authors are
 * nudged toward writing a real onboarding message instead of leaning
 * on the fallback forever.
 */
export function fallbackOnboardingMessage(module: HabitatModule): string {
  return `Checked ${module.name} for your area.`;
}

function checkingText(module: HabitatModule): string {
  return `Checking ${module.name.toLowerCase()}…`;
}

/**
 * Eyebrow text for a habitat-module row. Prefers the module's
 * hand-tuned `sourceLabel` and falls back to an uppercased `name` so
 * a future module that forgets to set the label still renders.
 */
function moduleEyebrow(module: HabitatModule): string {
  return module.sourceLabel ?? module.name.toUpperCase();
}

/**
 * Build the list of rows for the current phase.
 *
 * Every call returns exactly `1 + modules.length` rows, in stable order
 * (home-setup row first, then modules in registry order). Each row
 * carries a state that advances `idle → checking → done` as the
 * corresponding phase activates. The modal renders the list as-is — no
 * slicing or length manipulation downstream.
 *
 * `moduleLines` and `moduleSeverities` are both indexed by the module's
 * position in `modules` so a late-arriving realtime update doesn't
 * reorder anything. `moduleSeverities` is sparse — modules whose
 * severity hasn't landed yet (or that finished `failed` /
 * `not_applicable`) simply omit the key, and the row renders as
 * non-flagged with no pill.
 */
export function buildRowList(
  phase: Phase,
  modules: HabitatModule[],
  moduleLines: Record<number, string>,
  moduleSeverities: Record<number, HabitatSeverity> = {},
): DiscoveryRowProps[] {
  const rows: DiscoveryRowProps[] = [];

  if (phase.kind === "intro") {
    rows.push({
      id: "briefing",
      state: "idle",
      eyebrow: BRIEFING_SOURCE_LABEL,
      lead: BRIEFING_CHECKING_LEAD,
    });
  } else if (phase.kind === "briefing-checking") {
    rows.push({
      id: "briefing",
      state: "checking",
      eyebrow: BRIEFING_SOURCE_LABEL,
      lead: BRIEFING_CHECKING_LEAD,
    });
  } else {
    // Every phase after briefing-checking — briefing-result,
    // property-questions, module-checking, module-result, done —
    // renders the home-setup row as "done" with the fixed confirmation
    // copy. No facts, no secondary line.
    rows.push({
      id: "briefing",
      state: "done",
      eyebrow: BRIEFING_SOURCE_LABEL,
      lead: BRIEFING_DONE_LEAD,
    });
  }

  const currentModuleIndex =
    phase.kind === "module-checking" || phase.kind === "module-result"
      ? phase.index
      : phase.kind === "done"
        ? modules.length - 1
        : -1;

  modules.forEach((m, i) => {
    const eyebrow = moduleEyebrow(m);
    const doneLead = moduleLines[i] ?? fallbackOnboardingMessage(m);
    const severity = moduleSeverities[i];
    const doneRow: DiscoveryRowProps = {
      id: m.key,
      state: "done",
      eyebrow,
      lead: doneLead,
      ...(severity ? { severity } : {}),
    };

    if (phase.kind === "done" || i < currentModuleIndex) {
      rows.push(doneRow);
      return;
    }
    if (i === currentModuleIndex) {
      if (phase.kind === "module-checking") {
        rows.push({
          id: m.key,
          state: "checking",
          eyebrow,
          lead: checkingText(m),
        });
      } else {
        rows.push(doneRow);
      }
      return;
    }
    rows.push({
      id: m.key,
      state: "idle",
      eyebrow,
      lead: checkingText(m),
    });
  });

  return rows;
}
