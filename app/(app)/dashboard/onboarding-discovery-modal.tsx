"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "@/components/icon";
import {
  basementToChoice,
  choiceToBasement,
  choiceToWaterSource,
  PropertySituationFields,
  waterSourceToChoice,
  type BasementChoice,
  type WaterSourceChoice,
} from "@/components/property-situation-fields";
import {
  useHabitatFindings,
  type HabitatFindingRow,
} from "@/lib/hooks/use-habitat-findings";
import { HABITAT_MODULES } from "@/lib/habitat/registry";
import type { HabitatModule, HouseContext } from "@/lib/habitat/types";
import { getBriefingMessage } from "@/lib/briefing/getBriefingMessage";
import { createClient } from "@/lib/supabase/client";
import type { House } from "@/types/house";
import { triggerHabitatRecheck } from "./actions";
import {
  buildRowList,
  fallbackOnboardingMessage,
  type DiscoveryRowProps,
  type Phase,
} from "./onboarding-discovery-rows";

/**
 * First-run discovery modal. Narrates Hearth's public-data lookups in real
 * time so a new user can see what's being done on their behalf instead of
 * watching quiet inline skeletons populate.
 *
 * Only renders on the first dashboard visit after onboarding (parent
 * decides). Sequencing is visual-only — the briefing and habitat workflows
 * are already running in parallel; this component waits for each piece of
 * data to land and paces the reveal so fast modules still get airtime.
 */

// Held on the intro screen before we transition to "checking public home records".
const PHASE_INTRO_HOLD_MS = 800;
// Minimum time a result line is visible before moving to the next phase.
// Load-bearing — without this, the radon module (sub-ms in-memory lookup)
// would flash by before the user could read it. Tuned for "definitely
// long enough to read", not "as short as feels right" — the first-run
// experience earns its airtime by surfacing concrete findings, and
// the modal is the moment we deliberately slow down.
const RESULT_DISPLAY_MIN_MS = 3000;
// Brief beat between the last result and enabling the dismissal button, so
// the "All set" line gets a moment of its own.
const ALL_DONE_HOLD_MS = 600;

const TERMINAL_FINDING_STATUSES = new Set([
  "completed",
  "failed",
  "not_applicable",
]);

function houseContextFromRow(house: House): HouseContext {
  return {
    houseId: house.id,
    addressLine1: house.address_line1,
    city: house.city,
    state: house.state,
    county: house.county,
    postalCode: house.postal_code,
    latitude: house.latitude,
    longitude: house.longitude,
    parcelId: house.parcel_id,
    waterSource: house.water_source,
    basementPresent: house.basement_present,
  };
}

function modulesApplicableTo(house: House): HabitatModule[] {
  const ctx = houseContextFromRow(house);
  return HABITAT_MODULES.filter((m) => m.isApplicable(ctx));
}

/**
 * The modal serves two surfaces — first-run onboarding (default) and
 * the "Refresh House Facts" workflow. Both run through the same phase
 * machine and reuse the same row renderer; the differences are:
 *
 *   - `mode === "refresh"` skips the `property-questions` phase (the
 *     user's water source / basement answers were captured during their
 *     original onboarding and don't need to be re-asked on refresh).
 *   - `mode === "refresh"` gates each phase's advance on the row's
 *     timestamps EXCEEDING `sessionStartedAt`. Without that, the modal
 *     would see the previous run's terminal status the moment it
 *     mounted and skip straight through.
 *   - Copy and the dismiss-button text are swapped for the refresh
 *     framing ("Refreshing your home" vs. "Setting up your home";
 *     "Done" vs. "Start Managing my Home").
 *
 * In refresh mode the caller (dashboard-live's refresh-button click
 * handler) records `sessionStartedAt = new Date().toISOString()` BEFORE
 * the refresh server action fires, and passes that down. The workflow
 * stamps `briefing_started_at` on its running-status upsert and
 * `checked_at` on each habitat-finding upsert, so comparing those
 * against `sessionStartedAt` is a clean "did the row update after
 * this click?" gate.
 */
export type DiscoveryModalMode = "onboarding" | "refresh";

export function OnboardingDiscoveryModal({
  house,
  onDismiss,
  mode = "onboarding",
  sessionStartedAt,
}: {
  house: House;
  onDismiss: () => void;
  mode?: DiscoveryModalMode;
  /**
   * ISO timestamp captured at refresh-click time. Required in
   * `refresh` mode (used to gate phase advances on row timestamps
   * exceeding it); ignored in `onboarding` mode (the rows are fresh,
   * no prior state to compare against).
   */
  sessionStartedAt?: string;
}) {
  const findings = useHabitatFindings(house.id);
  const modules = useMemo(() => modulesApplicableTo(house), [house]);
  const [phase, setPhase] = useState<Phase>({ kind: "intro" });
  const [buttonEnabled, setButtonEnabled] = useState(false);
  const buttonRef = useRef<HTMLButtonElement | null>(null);

  // Briefing result is computed once on transition into briefing-result
  // and held — recomputing from the live row would make the line flicker
  // if a later realtime update lands while it's still on screen.
  const [briefingLine, setBriefingLine] = useState<string | null>(null);
  // Module result lines are stored by index so navigating forward through
  // phases doesn't recompute (and never reads stale finding state).
  const [moduleLines, setModuleLines] = useState<Record<number, string>>({});

  // Property-questions form state (issue #142). Initialized from the
  // live house row so a user who navigates back to onboarding after
  // already setting these somehow sees their existing choices, but
  // for the first-run path both values are null on the fresh row.
  const [waterSource, setWaterSource] = useState<WaterSourceChoice>(() =>
    waterSourceToChoice(house.water_source),
  );
  const [basementPresent, setBasementPresent] = useState<BasementChoice>(() =>
    basementToChoice(house.basement_present),
  );
  const [propertyQuestionsSaving, setPropertyQuestionsSaving] = useState(false);
  const [propertyQuestionsError, setPropertyQuestionsError] = useState<string | null>(
    null,
  );

  // Move from property-questions to the first habitat module (or done
  // if no modules apply). Shared by the Save and Skip paths so the
  // phase transition is identical either way.
  const advancePastPropertyQuestions = useCallback(() => {
    setPhase(
      modules.length === 0
        ? { kind: "done" }
        : { kind: "module-checking", index: 0 },
    );
  }, [modules.length]);

  const handlePropertyQuestionsSkip = useCallback(() => {
    // The habitat workflow no longer fires from the briefing's persist
    // step on the new-onboarding path (see workflows/briefing.ts for
    // the timing rationale). Skip needs to kick off habitat itself,
    // otherwise the user dismisses the modal without ever getting
    // habitat findings. Soft-fail: a recheck-start failure is logged
    // and the phase still advances; "Refresh House Facts" provides
    // manual recovery if it ever bites.
    void triggerHabitatRecheck(house.id).then((result) => {
      if (!result.ok) {
        console.warn(
          "[onboarding-discovery] habitat kickoff on skip failed:",
          result.error,
        );
      }
    });
    advancePastPropertyQuestions();
  }, [advancePastPropertyQuestions, house.id]);

  const handlePropertyQuestionsSave = useCallback(async () => {
    setPropertyQuestionsError(null);
    setPropertyQuestionsSaving(true);
    try {
      const supabase = createClient();
      const { error: updateError } = await supabase
        .from("houses")
        .update({
          water_source: choiceToWaterSource(waterSource),
          basement_present: choiceToBasement(basementPresent),
        })
        .eq("id", house.id);
      if (updateError) {
        setPropertyQuestionsError(
          updateError.message ||
            "We couldn't save those answers. Try again or skip for now.",
        );
        return;
      }
      // Issue #144: the briefing's persist step no longer fires
      // habitat (see workflows/briefing.ts for the timing rationale).
      // The Save / Skip handler is the single kickoff point on the
      // new-onboarding path — so this call is what actually starts
      // habitat for new users, not a "recheck" against an earlier
      // run. The houses UPDATE above completed first, so when the
      // workflow's loadHouseContext step runs it sees the user's
      // freshly-saved water_source and basement_present. The modal
      // immediately advances to module-checking, which waits on
      // habitat findings to land — same end-user flow as before.
      // Soft-fail: a start() failure is logged and the phase still
      // advances; "Refresh House Facts" provides manual recovery.
      try {
        const result = await triggerHabitatRecheck(house.id);
        if (!result.ok) {
          console.warn(
            "[onboarding-discovery] habitat kickoff on save failed:",
            result.error,
          );
        }
      } catch (recheckErr) {
        console.warn(
          "[onboarding-discovery] habitat kickoff on save threw:",
          recheckErr,
        );
      }
      advancePastPropertyQuestions();
    } catch (err) {
      console.error("property-questions save failed", err);
      setPropertyQuestionsError(
        "Something went wrong saving. Try again or skip for now.",
      );
    } finally {
      setPropertyQuestionsSaving(false);
    }
  }, [waterSource, basementPresent, house.id, advancePastPropertyQuestions]);

  // Map for fast lookups in effects.
  const findingByKey = useMemo(() => {
    const map = new Map<string, HabitatFindingRow>();
    for (const row of findings) map.set(row.module_key, row);
    return map;
  }, [findings]);

  const briefingStatus = house.briefing_status;
  const briefingTerminal =
    briefingStatus === "completed" || briefingStatus === "failed";

  /**
   * In refresh mode, "ready" requires more than terminal status — the
   * row's `briefing_started_at` must have advanced past
   * `sessionStartedAt` so we know this is the NEW run that fired on
   * the user's click and not the prior completed run. In onboarding
   * mode the row is fresh so terminal status is enough.
   */
  const briefingReadyForPhase =
    mode === "refresh"
      ? briefingTerminal &&
        Boolean(
          sessionStartedAt &&
            house.briefing_started_at &&
            house.briefing_started_at > sessionStartedAt,
        )
      : briefingTerminal;

  // Intro hold → briefing-checking.
  useEffect(() => {
    if (phase.kind !== "intro") return;
    const t = setTimeout(
      () => setPhase({ kind: "briefing-checking" }),
      PHASE_INTRO_HOLD_MS,
    );
    return () => clearTimeout(t);
  }, [phase.kind]);

  // briefing-checking → briefing-result when the briefing row reaches a
  // terminal status. We compute the result line at the transition point so
  // it's stable for the whole RESULT_DISPLAY_MIN_MS window.
  useEffect(() => {
    if (phase.kind !== "briefing-checking") return;
    if (!briefingReadyForPhase) return;
    if (briefingStatus === "failed") {
      setBriefingLine("We couldn't find some details — that's OK, you can still get started.");
    } else {
      setBriefingLine(getBriefingMessage(house));
    }
    setPhase({ kind: "briefing-result" });
  }, [phase.kind, briefingReadyForPhase, briefingStatus, house]);

  // briefing-result hold → property-questions (or straight to done if
  // briefing failed). On briefing failure the orchestrator never kicks
  // off habitat (see workflows/briefing.ts — persistBriefingSuccess is the
  // step that calls start(runHabitatChecks)), so we skip both the
  // property-questions prompt and the module-checking phases — the
  // failure message is the last thing the user sees before the Start
  // button enables. Users who skip the form here can fill water_source
  // and basement_present in via the home-details edit modal later.
  useEffect(() => {
    if (phase.kind !== "briefing-result") return;
    const briefingFailed = briefingStatus === "failed";
    const t = setTimeout(() => {
      if (briefingFailed) {
        setPhase({ kind: "done" });
      } else if (mode === "refresh") {
        // Refresh path skips the property-questions phase — those
        // values were captured during the user's original onboarding
        // and don't need to be re-asked on every refresh. Go straight
        // to module-checking (or done if no modules apply).
        setPhase(
          modules.length === 0
            ? { kind: "done" }
            : { kind: "module-checking", index: 0 },
        );
      } else {
        setPhase({ kind: "property-questions" });
      }
    }, RESULT_DISPLAY_MIN_MS);
    return () => clearTimeout(t);
  }, [phase.kind, briefingStatus, mode, modules.length]);

  // property-questions has no auto-advance — the user's Skip / Save
  // click is what drives the next transition. See the form section
  // below for the Save / Skip handlers.

  // module-checking → module-result when that module's finding row hits a
  // terminal status. Same "compute once on transition" pattern as briefing.
  // In refresh mode, also require the row's checked_at to have advanced
  // past sessionStartedAt — otherwise we'd see the previous run's
  // terminal status and skip past instantly.
  useEffect(() => {
    if (phase.kind !== "module-checking") return;
    const mod = modules[phase.index];
    if (!mod) {
      setPhase({ kind: "done" });
      return;
    }
    const finding = findingByKey.get(mod.key);
    if (!finding) return;
    if (!TERMINAL_FINDING_STATUSES.has(finding.status)) return;
    if (
      mode === "refresh" &&
      sessionStartedAt &&
      (!finding.checked_at || finding.checked_at <= sessionStartedAt)
    ) {
      return;
    }

    let line: string;
    if (finding.status === "failed") {
      line = `We hit a snag checking ${mod.name} — we'll try again later.`;
    } else if (finding.status === "not_applicable") {
      // Modules can theoretically write 'not_applicable' if a future
      // orchestrator version records non-applicable runs. Treat that as a
      // neutral, fast-pass result rather than a failure.
      line = `${mod.name} doesn't apply to your area.`;
    } else {
      // status === 'completed'
      if (mod.getOnboardingMessage) {
        line = mod.getOnboardingMessage({
          severity: (finding.severity ?? "neutral") as never,
          headline: finding.headline ?? "",
          summary: finding.summary ?? "",
          findings: finding.findings ?? {},
          sourceUrl: finding.source_url ?? undefined,
        });
      } else {
        line = fallbackOnboardingMessage(mod);
      }
    }

    const index = phase.index;
    setModuleLines((prev) => ({ ...prev, [index]: line }));
    setPhase({ kind: "module-result", index });
  }, [phase, modules, findingByKey, mode, sessionStartedAt]);

  // module-result hold → next module or done.
  useEffect(() => {
    if (phase.kind !== "module-result") return;
    const nextIndex = phase.index + 1;
    const t = setTimeout(() => {
      if (nextIndex >= modules.length) {
        setPhase({ kind: "done" });
      } else {
        setPhase({ kind: "module-checking", index: nextIndex });
      }
    }, RESULT_DISPLAY_MIN_MS);
    return () => clearTimeout(t);
  }, [phase, modules.length]);

  // Done → enable button after a short hold so the "All set" line gets a beat.
  useEffect(() => {
    if (phase.kind !== "done") return;
    const t = setTimeout(() => setButtonEnabled(true), ALL_DONE_HOLD_MS);
    return () => clearTimeout(t);
  }, [phase.kind]);

  // Scroll-lock while the modal is open. The user has no escape hatch
  // (intentional — the explicit button click is part of the moment), so
  // the background should not scroll behind it.
  useEffect(() => {
    const html = document.documentElement;
    const body = document.body;
    html.classList.add("scroll-locked");
    body.classList.add("scroll-locked");
    return () => {
      html.classList.remove("scroll-locked");
      body.classList.remove("scroll-locked");
    };
  }, []);

  // Focus the button once it's enabled, so keyboard users land on the only
  // affordance the modal exposes.
  useEffect(() => {
    if (buttonEnabled) buttonRef.current?.focus();
  }, [buttonEnabled]);

  // Build the line list that's been revealed so far. We render previous
  // phases as completed lines and the current phase as the live row, so
  // the user sees the discovery accumulating rather than jumping.
  const rows = buildRowList(phase, modules, briefingLine, moduleLines);

  return (
    <div
      aria-hidden={false}
      role="dialog"
      aria-modal="true"
      aria-labelledby="onboarding-discovery-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6"
      style={{
        backgroundColor:
          "color-mix(in oklab, var(--color-bg-base) 80%, transparent)",
        backdropFilter: "blur(6px)",
      }}
    >
      <div
        className="surface-ai relative w-full max-w-lg overflow-hidden flex flex-col"
        style={{ borderRadius: "var(--radius-lg)" }}
      >
        <div className="flex flex-col gap-4 p-5 sm:p-7">
          <div className="flex items-center gap-2">
            <span style={{ color: "var(--color-accent)" }}>
              <Icon name="sparkles" size={16} />
            </span>
            <span className="eyebrow">
              {mode === "refresh" ? "Refreshing your home" : "Setting up your home"}
            </span>
          </div>

          <div>
            <h2
              id="onboarding-discovery-title"
              className="h2"
              style={{ marginTop: 0 }}
            >
              {phase.kind === "done"
                ? mode === "refresh"
                  ? "All up to date."
                  : "All set — your home is ready."
                : phase.kind === "property-questions"
                  ? "Two quick questions about your home"
                  : mode === "refresh"
                    ? "Refreshing what we know about your home."
                    : "We're looking up information about your home."}
            </h2>
            {/*
              Always render the subtitle paragraph so its vertical space
              stays reserved through the "All set" beat. The text is
              hidden (not removed) on done, which keeps the surface
              height stable end-to-end per issue #108.
            */}
            <p
              className="text-small mt-1"
              style={{
                color: "var(--color-text-secondary)",
                visibility: phase.kind === "done" ? "hidden" : "visible",
              }}
              aria-hidden={phase.kind === "done"}
            >
              {phase.kind === "property-questions"
                ? "These help us calibrate environmental findings to your house. Both are optional."
                : "This usually takes about 10 seconds."}
            </p>
          </div>

          <ul className="flex flex-col gap-2">
            {rows.map((row) => (
              <DiscoveryRow key={row.id} {...row} />
            ))}
          </ul>

          {phase.kind === "property-questions" ? (
            <PropertyQuestionsSection
              waterSource={waterSource}
              onWaterSourceChange={setWaterSource}
              basementPresent={basementPresent}
              onBasementChange={setBasementPresent}
              saving={propertyQuestionsSaving}
              error={propertyQuestionsError}
              onSave={handlePropertyQuestionsSave}
              onSkip={handlePropertyQuestionsSkip}
            />
          ) : (
            <div className="mt-2">
              <button
                ref={buttonRef}
                type="button"
                onClick={onDismiss}
                disabled={!buttonEnabled}
                className="btn btn-primary w-full"
                style={{
                  opacity: buttonEnabled ? 1 : 0.5,
                  cursor: buttonEnabled ? "pointer" : "default",
                }}
              >
                {mode === "refresh" ? "Done" : "Start Managing my Home"}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Form region rendered inside the discovery modal during the
 * `property-questions` phase (issue #142). Lifts the two segmented
 * controls + the Skip / Save buttons out of the main component so
 * the modal body's structure stays scannable. Save is awaitable —
 * the parent owns the saving / error state and the phase transition.
 */
function PropertyQuestionsSection({
  waterSource,
  onWaterSourceChange,
  basementPresent,
  onBasementChange,
  saving,
  error,
  onSave,
  onSkip,
}: {
  waterSource: WaterSourceChoice;
  onWaterSourceChange: (v: WaterSourceChoice) => void;
  basementPresent: BasementChoice;
  onBasementChange: (v: BasementChoice) => void;
  saving: boolean;
  error: string | null;
  onSave: () => void;
  onSkip: () => void;
}) {
  return (
    <div className="flex flex-col gap-4 mt-1">
      <PropertySituationFields
        waterSource={waterSource}
        onWaterSourceChange={onWaterSourceChange}
        basementPresent={basementPresent}
        onBasementChange={onBasementChange}
      />

      {error ? (
        <div
          className="surface p-3 text-small"
          role="alert"
          style={{
            backgroundColor:
              "color-mix(in oklab, var(--color-danger) 12%, var(--color-bg-surface))",
            borderColor:
              "color-mix(in oklab, var(--color-danger) 30%, var(--color-border-subtle))",
            color: "var(--color-text-primary)",
          }}
        >
          {error}
        </div>
      ) : null}

      <div className="flex items-center justify-between gap-3 mt-1">
        <button
          type="button"
          onClick={onSkip}
          disabled={saving}
          className="btn btn-ghost"
        >
          Skip for now
        </button>
        <button
          type="button"
          onClick={onSave}
          disabled={saving}
          className="btn btn-primary"
          style={{
            opacity: saving ? 0.6 : 1,
            cursor: saving ? "not-allowed" : "pointer",
          }}
        >
          {saving ? "Saving…" : "Save and continue"}
        </button>
      </div>
    </div>
  );
}

function DiscoveryRow({ state, text }: DiscoveryRowProps) {
  const indicatorColor =
    state === "checking"
      ? "var(--color-accent)"
      : state === "done"
        ? "var(--color-success)"
        : "var(--color-border-subtle)";
  const textColor =
    state === "checking"
      ? "var(--color-text-secondary)"
      : state === "done"
        ? "var(--color-text-primary)"
        : "var(--color-text-tertiary)";
  return (
    <li className="flex items-start gap-3">
      <span
        aria-hidden
        className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center"
        style={{ color: indicatorColor }}
      >
        {state === "checking" ? (
          <span
            className="inline-block h-2.5 w-2.5 rounded-full animate-pulse"
            style={{ backgroundColor: "currentColor" }}
          />
        ) : state === "done" ? (
          <Icon name="circle-check" size={16} />
        ) : (
          <span
            className="inline-block h-2.5 w-2.5 rounded-full"
            style={{
              border: "1px solid currentColor",
              backgroundColor: "transparent",
            }}
          />
        )}
      </span>
      <span style={{ fontSize: 14, lineHeight: 1.45, color: textColor }}>
        {text}
      </span>
    </li>
  );
}
