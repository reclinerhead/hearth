import type { HabitatModule } from "@/lib/habitat/types";

/**
 * Pure row-building helpers for the onboarding discovery modal.
 *
 * Extracted from onboarding-discovery-modal.tsx so the row-shape logic
 * can be unit-tested without spinning up React. The visual rendering
 * stays in the modal (DiscoveryRow); this file owns the mapping from
 * (phase, applicable modules, accumulated copy) to the list of rows
 * the modal renders.
 *
 * The list length is always `1 + modules.length` — one briefing row plus
 * one row per applicable habitat module — for every phase, including
 * `intro`. Reserving every slot up front (in `idle` state) keeps the
 * modal surface from growing or re-centering as briefing + habitat
 * results land. See issue #108.
 */

export type Phase =
  | { kind: "intro" }
  | { kind: "briefing-checking" }
  | { kind: "briefing-result" }
  | { kind: "module-checking"; index: number }
  | { kind: "module-result"; index: number }
  | { kind: "done" };

export type DiscoveryRowState = "idle" | "checking" | "done";

export type DiscoveryRowProps = {
  id: string;
  state: DiscoveryRowState;
  text: string;
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
 */
export function buildRowList(
  phase: Phase,
  modules: HabitatModule[],
  briefingLine: string | null,
  moduleLines: Record<number, string>,
): DiscoveryRowProps[] {
  const rows: DiscoveryRowProps[] = [];

  if (phase.kind === "intro") {
    rows.push({
      id: "briefing",
      state: "idle",
      text: "Checking public home records…",
    });
  } else if (phase.kind === "briefing-checking") {
    rows.push({
      id: "briefing",
      state: "checking",
      text: "Checking public home records…",
    });
  } else {
    rows.push({
      id: "briefing",
      state: "done",
      text: briefingLine ?? "Looked up your home's public records",
    });
  }

  const currentModuleIndex =
    phase.kind === "module-checking" || phase.kind === "module-result"
      ? phase.index
      : phase.kind === "done"
        ? modules.length - 1
        : -1;

  modules.forEach((m, i) => {
    if (phase.kind === "done" || i < currentModuleIndex) {
      rows.push({
        id: m.key,
        state: "done",
        text: moduleLines[i] ?? fallbackOnboardingMessage(m),
      });
      return;
    }
    if (i === currentModuleIndex) {
      if (phase.kind === "module-checking") {
        rows.push({ id: m.key, state: "checking", text: checkingText(m) });
      } else {
        rows.push({
          id: m.key,
          state: "done",
          text: moduleLines[i] ?? fallbackOnboardingMessage(m),
        });
      }
      return;
    }
    rows.push({ id: m.key, state: "idle", text: checkingText(m) });
  });

  return rows;
}
