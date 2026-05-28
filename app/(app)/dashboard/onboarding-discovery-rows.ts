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
 * The list length is always `1 + modules.length` — one briefing row plus
 * one row per applicable habitat module — for every phase, including
 * `intro`. Reserving every slot up front (in `idle` state) keeps the
 * modal surface from growing or re-centering as briefing + habitat
 * results land. See issue #108.
 *
 * Issue #184 reshaped each row from `{ text }` to
 * `{ lead, secondary?, severity? }` so the modal can render bordered
 * card rows with a severity-coloured glyph + a derived relevance pill.
 */

export type Phase =
  | { kind: "intro" }
  | { kind: "briefing-checking" }
  | { kind: "briefing-result" }
  // Issue #142 — interstitial prompt for the two property-situation
  // questions (water source, basement). Inserted between
  // `briefing-result` and `module-checking` so the user sees the
  // briefing result land first, then answers (or skips), and only
  // then watches the habitat modules check in. No auto-advance:
  // the user's Skip / Save click drives the next transition. Skipped
  // on the briefing-failure path so a failed first step isn't
  // immediately followed by a form prompt.
  | { kind: "property-questions" }
  | { kind: "module-checking"; index: number }
  | { kind: "module-result"; index: number }
  | { kind: "done" };

export type DiscoveryRowState = "idle" | "checking" | "done";

export type DiscoveryRowProps = {
  id: string;
  state: DiscoveryRowState;
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
 * Briefing result content captured by the modal at the briefing-result
 * transition and held verbatim through every later phase. `secondary`
 * is null when the workflow produced no concrete facts (Sonar couldn't
 * resolve the address) — the lead line stays honest in that case and
 * the modal renders the row as a single-line entry.
 */
export type BriefingRowContent = {
  lead: string;
  secondary: string | null;
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
 * Build the list of rows for the current phase.
 *
 * Every call returns exactly `1 + modules.length` rows, in stable order
 * (briefing first, then modules in registry order). Each row carries a
 * state that advances `idle → checking → done` as the corresponding
 * phase activates. The modal renders the list as-is — no slicing or
 * length manipulation downstream.
 *
 * `briefing` is captured at the briefing-result transition and held
 * verbatim by the modal; `moduleLines` and `moduleSeverities` are both
 * indexed by the module's position in `modules` so a late-arriving
 * realtime update doesn't reorder anything. `moduleSeverities` is
 * sparse — modules whose severity hasn't landed yet (or that finished
 * `failed` / `not_applicable`) simply omit the key, and the row
 * renders as non-flagged with no pill.
 */
export function buildRowList(
  phase: Phase,
  modules: HabitatModule[],
  briefing: BriefingRowContent | null,
  moduleLines: Record<number, string>,
  moduleSeverities: Record<number, HabitatSeverity> = {},
): DiscoveryRowProps[] {
  const rows: DiscoveryRowProps[] = [];

  if (phase.kind === "intro") {
    rows.push({
      id: "briefing",
      state: "idle",
      lead: "Checking public home records…",
    });
  } else if (phase.kind === "briefing-checking") {
    rows.push({
      id: "briefing",
      state: "checking",
      lead: "Checking public home records…",
    });
  } else {
    // Every phase after briefing-checking — briefing-result,
    // property-questions, module-checking, module-result, done —
    // renders the briefing row as "done" with its result content.
    const lead = briefing?.lead ?? "Public records checked";
    const secondary = briefing?.secondary ?? null;
    rows.push({
      id: "briefing",
      state: "done",
      lead,
      ...(secondary !== null ? { secondary } : {}),
    });
  }

  const currentModuleIndex =
    phase.kind === "module-checking" || phase.kind === "module-result"
      ? phase.index
      : phase.kind === "done"
        ? modules.length - 1
        : -1;

  modules.forEach((m, i) => {
    const doneLead = moduleLines[i] ?? fallbackOnboardingMessage(m);
    const severity = moduleSeverities[i];
    const doneRow: DiscoveryRowProps = {
      id: m.key,
      state: "done",
      lead: doneLead,
      ...(severity ? { severity } : {}),
    };

    if (phase.kind === "done" || i < currentModuleIndex) {
      rows.push(doneRow);
      return;
    }
    if (i === currentModuleIndex) {
      if (phase.kind === "module-checking") {
        rows.push({ id: m.key, state: "checking", lead: checkingText(m) });
      } else {
        rows.push(doneRow);
      }
      return;
    }
    rows.push({ id: m.key, state: "idle", lead: checkingText(m) });
  });

  return rows;
}
