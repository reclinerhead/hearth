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
  discoveryRowGlyph,
  isFlaggedSeverity,
  pillLabelForSeverity,
  pillTooltipForSeverity,
  SEVERITY_COLOR,
} from "@/components/habitat-severity";
import { Tooltip } from "@/components/tooltip";
import {
  useHabitatFindings,
  type HabitatFindingRow,
} from "@/lib/hooks/use-habitat-findings";
import { HABITAT_MODULES } from "@/lib/habitat/registry";
import type {
  HabitatModule,
  HabitatSeverity,
  HouseContext,
} from "@/lib/habitat/types";
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

// Three small "let it land" beats between phase transitions. Together
// they keep fast modules (radon is a sub-ms in-memory lookup) from
// flashing past before the user registers them, while staying short
// enough that the overall modal doesn't feel artificially padded.
// Originally tuned higher (800/3000/600) — Todd dialed them down once
// real timings landed: the AI portfolio summary call alone takes
// 10-15 s, so the modal's total wall-clock is dominated by actual
// work and the per-phase beats just need to be visible, not generous.
// 500 ms is the cap.
const PHASE_INTRO_HOLD_MS = 500;
const RESULT_DISPLAY_MIN_MS = 500;
const ALL_DONE_HOLD_MS = 500;

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
    waterSystemUserPwsid: house.water_system_user_pwsid ?? null,
    waterSystemPwsidConfidence: house.water_system_pwsid_confidence ?? null,
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
 *   - `mode === "refresh"` gates module-row advances on the row's
 *     `checked_at` EXCEEDING `sessionStartedAt`. Without that, the modal
 *     would see the previous run's terminal status the moment it mounted
 *     and skip straight through. The briefing row is a static
 *     client-side beat in both modes (issue #210 dropped the Zillow
 *     workflow it used to wait on), so no row gating is needed there.
 *   - Copy and the dismiss-button text are swapped for the refresh
 *     framing ("Refreshing your home" vs. "Setting up your home";
 *     "Done" vs. "Start Managing my Home").
 *
 * In refresh mode the caller (dashboard-live's refresh-button click
 * handler) records `sessionStartedAt = new Date().toISOString()` BEFORE
 * the refresh server action fires, and passes that down. The workflow
 * stamps `checked_at` on each habitat-finding upsert, so comparing
 * those against `sessionStartedAt` is a clean "did the row update after
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

  // Module result lines are stored by index so navigating forward through
  // phases doesn't recompute (and never reads stale finding state).
  const [moduleLines, setModuleLines] = useState<Record<number, string>>({});
  // Captured severity per module index, indexed alongside moduleLines so
  // the row renderer can derive the glyph, border, and relevance pill at
  // any later phase. Sparse — failed / not_applicable rows omit the key.
  const [moduleSeverities, setModuleSeverities] = useState<
    Record<number, HabitatSeverity>
  >({});

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
    // Skip is the only kickoff point for habitat on the new-onboarding
    // path — the previous Day One Briefing workflow used to fire it
    // from a persist step, but issue #210 deleted that workflow.
    // Without this call the user would dismiss the modal without ever
    // getting habitat findings. Soft-fail: a recheck-start failure is
    // logged and the phase still advances; "Refresh House Facts"
    // provides manual recovery if it ever bites.
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
      // The Save / Skip handler is the single kickoff point for
      // habitat on the new-onboarding path — so this call is what
      // actually starts habitat for new users, not a "recheck" against
      // an earlier run. The houses UPDATE above completed first, so
      // when the workflow's loadHouseContext step runs it sees the
      // user's freshly-saved water_source and basement_present. The
      // modal immediately advances to module-checking, which waits on
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

  // Intro hold → briefing-checking.
  useEffect(() => {
    if (phase.kind !== "intro") return;
    const t = setTimeout(
      () => setPhase({ kind: "briefing-checking" }),
      PHASE_INTRO_HOLD_MS,
    );
    return () => clearTimeout(t);
  }, [phase.kind]);

  // briefing-checking → briefing-result on a short timer beat. Issue
  // #210 removed the Zillow lookup the briefing row used to wait on;
  // it now resolves to a static "your home is set up" confirmation in
  // both onboarding and refresh modes. The beat keeps the pacing
  // rhythm so the row reads as something Hearth did, not a flash.
  useEffect(() => {
    if (phase.kind !== "briefing-checking") return;
    const t = setTimeout(
      () => setPhase({ kind: "briefing-result" }),
      RESULT_DISPLAY_MIN_MS,
    );
    return () => clearTimeout(t);
  }, [phase.kind]);

  // briefing-result hold → property-questions (or straight to
  // module-checking in refresh mode, since those answers were captured
  // during the user's original onboarding).
  useEffect(() => {
    if (phase.kind !== "briefing-result") return;
    const t = setTimeout(() => {
      if (mode === "refresh") {
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
  }, [phase.kind, mode, modules.length]);

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
    // Captured alongside the result line so the done-state row can
    // render the right glyph / border / pill at any later phase (issue
    // #184). Failed and not_applicable rows omit severity entirely.
    let capturedSeverity: HabitatSeverity | undefined;
    if (finding.status === "failed") {
      line = `We hit a snag checking ${mod.name} — we'll try again later.`;
    } else if (finding.status === "not_applicable") {
      // Modules can theoretically write 'not_applicable' if a future
      // orchestrator version records non-applicable runs. Treat that as a
      // neutral, fast-pass result rather than a failure.
      line = `${mod.name} doesn't apply to your area.`;
    } else {
      // status === 'completed'
      const severity = (finding.severity ?? "neutral") as HabitatSeverity;
      capturedSeverity = severity;
      if (mod.getOnboardingMessage) {
        line = mod.getOnboardingMessage({
          severity,
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
    if (capturedSeverity) {
      setModuleSeverities((prev) => ({ ...prev, [index]: capturedSeverity }));
    }
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
  const rows = buildRowList(phase, modules, moduleLines, moduleSeverities);

  // Summary chip for the done phase: total rows shown (briefing + each
  // habitat module that landed) and the subset flagged as "worth a
  // closer look." The briefing row never counts toward the flagged N —
  // it has no severity. Derived from `rows` so the count tracks the
  // actually-rendered list, not the registry length.
  const summaryTotal = rows.length;
  const summaryFlagged = rows.filter(
    (r) => r.id !== "briefing" && isFlaggedSeverity(r.severity),
  ).length;

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
      {/*
        max-w-lg (512px) stays the mobile cap so the modal doesn't
        crowd the viewport on phones; md:max-w-2xl (672px) gives
        desktop enough room that the briefing result line
        ("Found your home data — built in 1934, 2,210 sq ft" and
        similar) doesn't wrap mid-sentence.
      */}
      <div
        className="surface-ai relative w-full max-w-lg md:max-w-2xl overflow-hidden flex flex-col"
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
              Subtitle slot — always renders so the vertical space stays
              reserved through the "All set" beat (issue #108 height
              stability). In `done` the slot carries the summary chip
              ("{total} facts found · {N} worth a closer look"); in
              every other phase it carries the existing copy.
            */}
            {phase.kind === "done" ? (
              <SummaryChip total={summaryTotal} flagged={summaryFlagged} />
            ) : (
              <p
                className="text-small mt-1"
                style={{ color: "var(--color-text-secondary)" }}
              >
                {phase.kind === "property-questions"
                  ? "These help us calibrate environmental findings to your house. Both are optional."
                  : "This typically takes 20 to 30 seconds."}
              </p>
            )}
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

/**
 * One discovery-modal row, rendered as a bordered card row (issue #184).
 *
 * Done rows lead with a 14px/500 lead line and an optional 13px secondary
 * line below it. Flagged severities (caution / concern / critical) get
 * a warm-tinted border, an alert-triangle glyph in the severity colour,
 * and a "Worth knowing" / "Worth a closer look" relevance pill with a
 * keyboard- and screen-reader-accessible tooltip. Non-flagged done rows
 * stay subtle: subtle-border, green check, no pill. Checking and idle
 * rows render as a single-line entry with the previous pulsing-dot /
 * hollow-circle treatment so the reveal sequence is preserved.
 */
function DiscoveryRow({
  state,
  eyebrow,
  lead,
  secondary,
  severity,
}: DiscoveryRowProps) {
  const flagged = state === "done" && isFlaggedSeverity(severity);
  const borderColor = flagged
    ? "color-mix(in oklab, var(--color-warning) 22%, var(--color-border-subtle))"
    : "var(--color-border-subtle)";
  const glyphColor =
    state === "checking"
      ? "var(--color-accent)"
      : state === "done"
        ? severity
          ? SEVERITY_COLOR[severity]
          : "var(--color-success)"
        : "var(--color-text-tertiary)";
  const leadColor =
    state === "done"
      ? "var(--color-text-primary)"
      : state === "checking"
        ? "var(--color-text-secondary)"
        : "var(--color-text-tertiary)";
  const idleLeadOpacity = state === "idle" ? 0.7 : 1;
  const pillLabel =
    state === "done" ? pillLabelForSeverity(severity) : null;
  const pillTooltip =
    state === "done" ? pillTooltipForSeverity(severity) : null;

  return (
    <li
      className="flex flex-col"
      style={{
        backgroundColor: "var(--color-bg-surface)",
        border: `1px solid ${borderColor}`,
        borderRadius: "var(--radius-md)",
        padding: "11px 14px 13px",
      }}
    >
      {/*
        Source eyebrow: full-width above the glyph+content row so the
        tile self-identifies its data source ("EPA RADON CHECK",
        "PUBLIC RECORD SEARCH"). Idle rows dim the eyebrow alongside
        the lead so the not-yet-started rows still read as muted.
      */}
      <div
        className="eyebrow"
        style={{
          marginBottom: 6,
          opacity: state === "idle" ? 0.7 : 1,
        }}
      >
        {eyebrow}
      </div>
      <div className="flex items-start gap-3">
        <span
          aria-hidden
          className="flex h-5 w-5 shrink-0 items-center justify-center"
          style={{
            color: glyphColor,
            // Sit with the lead line, not centred on the whole card —
            // the secondary line should grow downward from the lead
            // without dragging the glyph with it.
            marginTop: 1,
          }}
        >
          {state === "checking" ? (
            <span
              className="inline-block h-2.5 w-2.5 rounded-full animate-pulse"
              style={{ backgroundColor: "currentColor" }}
            />
          ) : state === "done" ? (
            <Icon name={discoveryRowGlyph(severity)} size={16} />
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
        <div className="flex-1 min-w-0">
          <div
            style={{
              fontSize: 14,
              fontWeight: 500,
              lineHeight: 1.4,
              color: leadColor,
              opacity: idleLeadOpacity,
            }}
          >
            {lead}
          </div>
          {state === "done" && secondary ? (
            <div
              style={{
                fontSize: 13,
                lineHeight: 1.45,
                color: "var(--color-text-secondary)",
                marginTop: 1,
              }}
            >
              {secondary}
            </div>
          ) : null}
        </div>
        {pillLabel && pillTooltip ? (
          <span className="shrink-0 self-center">
            <Tooltip content={pillTooltip}>
              <RelevancePill label={pillLabel} />
            </Tooltip>
          </span>
        ) : null}
      </div>
    </li>
  );
}

function RelevancePill({ label }: { label: string }) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        fontSize: 11,
        fontWeight: 500,
        lineHeight: 1.4,
        color: "var(--color-warning)",
        backgroundColor:
          "color-mix(in oklab, var(--color-warning) 14%, transparent)",
        border:
          "1px solid color-mix(in oklab, var(--color-warning) 28%, transparent)",
        borderRadius: 999,
        padding: "2px 9px",
        whiteSpace: "nowrap",
      }}
    >
      {label}
    </span>
  );
}

/**
 * Severity summary rendered in the done phase under the headline.
 * Occupies the same slot the subtitle paragraph holds in earlier
 * phases so the modal surface keeps its vertical footprint (issue
 * #108). The warning-coloured dot only appears when there's at least
 * one flagged finding — a clean sweep shouldn't manufacture concern.
 */
function SummaryChip({ total, flagged }: { total: number; flagged: number }) {
  const factsLabel = total === 1 ? "1 fact found" : `${total} facts found`;
  const flaggedLabel =
    flagged === 1 ? "1 worth a closer look" : `${flagged} worth a closer look`;
  return (
    <p
      className="text-small mt-1"
      style={{
        color: "var(--color-text-secondary)",
        display: "flex",
        alignItems: "center",
        flexWrap: "wrap",
        gap: "0 8px",
      }}
    >
      <span>{factsLabel}</span>
      {flagged > 0 ? (
        <>
          <span aria-hidden>·</span>
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              color: "var(--color-text-primary)",
            }}
          >
            <span
              aria-hidden
              style={{
                display: "inline-block",
                width: 8,
                height: 8,
                borderRadius: 999,
                backgroundColor: "var(--color-warning)",
              }}
            />
            <span>{flaggedLabel}</span>
          </span>
        </>
      ) : null}
    </p>
  );
}
