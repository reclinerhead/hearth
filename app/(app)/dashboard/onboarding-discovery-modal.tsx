"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "@/components/icon";
import {
  useHabitatFindings,
  type HabitatFindingRow,
} from "@/lib/hooks/use-habitat-findings";
import { HABITAT_MODULES } from "@/lib/habitat/registry";
import type { HabitatModule, HouseContext } from "@/lib/habitat/types";
import { getBriefingMessage } from "@/lib/briefing/getBriefingMessage";
import type { House } from "@/types/house";
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
  };
}

function modulesApplicableTo(house: House): HabitatModule[] {
  const ctx = houseContextFromRow(house);
  return HABITAT_MODULES.filter((m) => m.isApplicable(ctx));
}

export function OnboardingDiscoveryModal({
  house,
  onDismiss,
}: {
  house: House;
  onDismiss: () => void;
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

  // Map for fast lookups in effects.
  const findingByKey = useMemo(() => {
    const map = new Map<string, HabitatFindingRow>();
    for (const row of findings) map.set(row.module_key, row);
    return map;
  }, [findings]);

  const briefingStatus = house.briefing_status;
  const briefingTerminal =
    briefingStatus === "completed" || briefingStatus === "failed";

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
    if (!briefingTerminal) return;
    if (briefingStatus === "failed") {
      setBriefingLine("We couldn't find some details — that's OK, you can still get started.");
    } else {
      setBriefingLine(getBriefingMessage(house));
    }
    setPhase({ kind: "briefing-result" });
  }, [phase.kind, briefingTerminal, briefingStatus, house]);

  // briefing-result hold → first module (or done if no applicable modules,
  // or briefing failed). On briefing failure the orchestrator never kicks
  // off habitat (see workflows/briefing.ts — persistBriefingSuccess is the
  // step that calls start(runHabitatChecks)), so waiting on habitat rows
  // would hang the modal forever. Skip straight to done in that case.
  useEffect(() => {
    if (phase.kind !== "briefing-result") return;
    const briefingFailed = briefingStatus === "failed";
    const t = setTimeout(() => {
      if (modules.length === 0 || briefingFailed) {
        setPhase({ kind: "done" });
      } else {
        setPhase({ kind: "module-checking", index: 0 });
      }
    }, RESULT_DISPLAY_MIN_MS);
    return () => clearTimeout(t);
  }, [phase.kind, modules.length, briefingStatus]);

  // module-checking → module-result when that module's finding row hits a
  // terminal status. Same "compute once on transition" pattern as briefing.
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
  }, [phase, modules, findingByKey]);

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
            <span className="eyebrow">Setting up your home</span>
          </div>

          <div>
            <h2
              id="onboarding-discovery-title"
              className="h2"
              style={{ marginTop: 0 }}
            >
              {phase.kind === "done"
                ? "All set — your home is ready."
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
              This usually takes about 10 seconds.
            </p>
          </div>

          <ul className="flex flex-col gap-2">
            {rows.map((row) => (
              <DiscoveryRow key={row.id} {...row} />
            ))}
          </ul>

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
              Start Managing my Home
            </button>
          </div>
        </div>
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
