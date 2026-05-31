"use client";

/**
 * Remediation matrix view (epic #165, WQA-5).
 *
 * The second WQA surface, reachable from the "See your full remediation
 * matrix" CTA on the findings view's filter card. Rendered as an
 * in-modal sub-view of `WqaOverviewBody` (consistent with WQA-4's
 * "stay in the modal" decision) — the parent swaps its body to this
 * component and back via local state, so there's no new modal-shell
 * slot and no dedicated route.
 *
 * Everything here is a pure read off the persisted finding: the
 * detected-contaminant set is derived the same way the orchestrator
 * derived it for the filter card (`deriveDetectedContaminants`), then
 * fed through the same personalization + recommendation helpers
 * (`personalizeRemediationMatrix`, `recommendRemediationCombination`)
 * so the highlighting and the combination cards always agree with the
 * filter card the user clicked to get here.
 *
 * Sections, top to bottom (per the approved mockup):
 *   1. Back affordance + header strip
 *   2. Recommended combination cards (carbon block + optional RO)
 *   3. Full matrix table (detected rows amber-highlighted)
 *   4. Legend
 *   5. "A few things worth knowing"
 *   6. Plain NSF certified-products browse affordance
 */

import { useEffect, useRef } from "react";
import { Icon } from "@/components/icon";
import {
  NSF_CERTIFIED_PRODUCTS_URL,
  betterEffectiveness,
  type InstallLocation,
  type RemediationEffectiveness,
} from "@/lib/habitat/water-quality/remediation/matrix";
import {
  personalizeRemediationMatrix,
  recommendRemediationCombination,
  type PersonalizedRemediationRow,
} from "@/lib/habitat/water-quality/remediation/recommend";
import { deriveDetectedContaminants } from "../detected";
import type { WqaFindings } from "../types";

/** Amber the rest of the WQA body uses for its attention tier. */
const AMBER = "#d97706";

export function RemediationMatrixView({
  findings,
  onBack,
}: {
  findings: WqaFindings;
  onBack: () => void;
}) {
  const rootRef = useRef<HTMLDivElement | null>(null);

  // Bring the top of the matrix into view when it mounts — the user
  // may have been scrolled down on the findings overview when they
  // clicked the CTA.
  useEffect(() => {
    rootRef.current?.scrollIntoView({ block: "start" });
  }, []);

  const detected = deriveDetectedContaminants({
    branch: findings.branch,
    ccrFindings: findings.ccr_findings ?? null,
    leadCopper: findings.lead_copper_summary ?? null,
  });
  const personalized = personalizeRemediationMatrix(detected);
  const combo = recommendRemediationCombination(detected);

  const ccrYear =
    findings.branch === "cws_with_ccr"
      ? findings.ccr_findings?.report_year ?? null
      : null;
  const personalizedFrom = ccrYear
    ? `Personalized from your ${ccrYear} CCR`
    : "Personalized from your EPA samples";
  const highlightSource = ccrYear
    ? `Rows highlighted in amber are detected in your ${ccrYear} CCR.`
    : "Rows highlighted in amber were detected in your EPA lead & copper samples.";

  // "Carbon block + RO together cover what's detected … except
  // hardness, which is handled separately." Built as one clean
  // sentence; the "except" tail only appears when a whole-house
  // problem (hardness/iron) is among the detections.
  const separately = combo.handled_separately;
  const comboSentence =
    combo.primary.covered_count > 0
      ? `A carbon block${
          combo.ro_addon ? " + RO" : ""
        } together cover what’s detected at your house${
          separately.length > 0
            ? ` except ${joinNames(separately)}, which ${
                separately.length === 1 ? "is" : "are"
              } handled separately.`
            : "."
        }`
      : "";

  return (
    <div ref={rootRef} className="flex flex-col gap-6">
      {/* 1. Back + header ------------------------------------------------ */}
      <div>
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-1 text-small"
          style={{
            color: "var(--color-accent)",
            background: "transparent",
            border: "none",
            padding: 0,
            marginBottom: 12,
          }}
        >
          <Icon name="chevron-left" size={16} aria-hidden />
          <span>Back to findings</span>
        </button>
        <div className="eyebrow mb-1" style={{ color: "var(--color-accent)" }}>
          Remediation matrix · {personalizedFrom}
        </div>
        <h3 className="h3" style={{ marginBottom: 6 }}>
          Which filter technologies address what&rsquo;s actually in your water
        </h3>
        <p
          className="text-small"
          style={{ color: "var(--color-text-secondary)", lineHeight: 1.55 }}
        >
          {highlightSource} Cell shading shows how effective each technology is.
          {comboSentence ? ` ${comboSentence}` : ""}
        </p>
      </div>

      {/* 2. Recommended combination ------------------------------------- */}
      {combo.primary.detected_count > 0 ? (
        <section aria-labelledby="wqa-matrix-combo-heading">
          <div id="wqa-matrix-combo-heading" className="eyebrow mb-2">
            Recommended combination for your house
          </div>
          <div
            className="grid gap-3"
            style={{
              gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
            }}
          >
            <CombinationCard
              icon="filter"
              accent="var(--color-accent)"
              title={combo.primary.label}
              certLine={`${combo.primary.nsf_standards.join(" + ")} certified`}
              body={
                combo.primary.covered_count > 0
                  ? `Covers ${combo.primary.covered_count} of ${combo.primary.detected_count} detected: ${joinNames(
                      combo.primary.covered,
                    )}.`
                  : "A starting point — see the matrix for what fits your detections."
              }
              cost={`${combo.primary.cost_install} · ${combo.primary.cost_ongoing}`}
            />
            {combo.ro_addon ? (
              <CombinationCard
                icon="droplet"
                accent="var(--color-info)"
                title={combo.ro_addon.label}
                certLine="NSF/ANSI 58 certified"
                body={
                  combo.ro_addon.values_based
                    ? `Values-based add-on. Also handles arsenic and nitrate if those ever appear.`
                    : `Adds coverage for ${joinNames(
                        combo.ro_addon.reason_contaminants,
                      )}.`
                }
                cost={`${combo.ro_addon.cost_install} · ${combo.ro_addon.cost_ongoing}`}
              />
            ) : null}
          </div>
        </section>
      ) : null}

      {/* 3. Full matrix ------------------------------------------------- */}
      <section aria-labelledby="wqa-matrix-table-heading">
        <div id="wqa-matrix-table-heading" className="eyebrow mb-2">
          Full matrix
        </div>
        <MatrixTable rows={personalized} />
      </section>

      {/* 4. Legend ------------------------------------------------------ */}
      <Legend />

      {/* 5. Worth knowing ---------------------------------------------- */}
      <section aria-labelledby="wqa-matrix-worth-heading">
        <div id="wqa-matrix-worth-heading" className="eyebrow mb-2">
          A few things worth knowing
        </div>
        <ul className="flex flex-col gap-3">
          <WorthKnowing
            icon="shield"
            title="Certifications matter more than brand"
            body="A $20 pitcher and a $400 under-sink unit can both say “carbon filter.” The NSF/ANSI standards — 53 for lead and VOCs, 58 for reverse osmosis, P473 for PFAS — mean the unit was actually tested against those specific contaminants."
          />
          <WorthKnowing
            icon="flame"
            title="Boiling makes some things worse"
            body="Boiling concentrates lead, arsenic, and disinfection byproducts as water evaporates. Use it only for biological contamination during a boil advisory."
          />
          <WorthKnowing
            icon="home"
            title="Whole-house vs. tap matters"
            body="Lead and disinfection byproducts come from your plumbing or form downstream of the meter — whole-house filters can’t help with those. Hardness, iron, and chlorine taste/odor are the whole-house problems."
          />
        </ul>
      </section>

      {/* 6. Browse affordance (plain, non-affiliate) -------------------- */}
      <section
        className="rounded-md flex items-start gap-3 p-3 sm:p-4"
        style={{
          border: "1px solid var(--color-border-subtle)",
          backgroundColor: "var(--color-bg-surface-raised)",
        }}
      >
        <span
          aria-hidden
          className="shrink-0 mt-0.5"
          style={{ color: "var(--color-accent)" }}
        >
          <Icon name="search" size={18} />
        </span>
        <div className="min-w-0 flex-1">
          <div
            style={{
              fontSize: 14,
              fontWeight: 500,
              color: "var(--color-text-primary)",
            }}
          >
            Browse certified filters
          </div>
          <p
            className="text-small mt-1"
            style={{ color: "var(--color-text-secondary)", lineHeight: 1.55 }}
          >
            Look up products certified to the standards above in NSF&rsquo;s
            official certified-product database — the neutral source for
            confirming a unit was tested against the contaminants you care
            about. Hearth doesn&rsquo;t sell filters or earn commissions on
            them.
          </p>
          <div className="text-small mt-2">
            <a
              href={NSF_CERTIFIED_PRODUCTS_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1"
              style={{ color: "var(--color-accent)" }}
            >
              <span>Search NSF certified products</span>
              <Icon name="external-link" size={14} />
            </a>
          </div>
        </div>
      </section>
    </div>
  );
}

/* ---------- recommended combination card ------------------------------- */

function CombinationCard({
  icon,
  accent,
  title,
  certLine,
  body,
  cost,
}: {
  icon: "filter" | "droplet";
  accent: string;
  title: string;
  certLine: string;
  body: string;
  cost: string;
}) {
  return (
    <div
      className="rounded-md p-4 flex flex-col gap-2"
      style={{
        border: "1px solid var(--color-border-subtle)",
        borderLeft: `3px solid ${accent}`,
        backgroundColor: "var(--color-bg-surface-raised)",
      }}
    >
      <div className="flex items-center gap-2">
        <span aria-hidden style={{ color: accent }}>
          <Icon name={icon} size={18} />
        </span>
        <span
          style={{
            fontSize: 14,
            fontWeight: 500,
            color: "var(--color-text-primary)",
          }}
        >
          {title}
        </span>
      </div>
      <div className="eyebrow" style={{ color: accent }}>
        {certLine}
      </div>
      <p
        className="text-small"
        style={{ color: "var(--color-text-secondary)", lineHeight: 1.55, margin: 0 }}
      >
        {body}
      </p>
      <div
        className="mono text-small"
        style={{ color: "var(--color-text-tertiary)" }}
      >
        {cost}
      </div>
    </div>
  );
}

/* ---------- matrix table ----------------------------------------------- */

// The columns the table renders. `distill_uv` is the collapsed
// best-of(distillation, uv) column from the mockup; the rest map 1:1
// to a technology key.
const COLUMNS: Array<{ key: string; label: string }> = [
  { key: "carbon_block", label: "Carbon block" },
  { key: "pitcher", label: "Pitcher" },
  { key: "reverse_osmosis", label: "RO" },
  { key: "ion_exchange", label: "Softener" },
  { key: "distill_uv", label: "Distill / UV" },
];

function MatrixTable({ rows }: { rows: PersonalizedRemediationRow[] }) {
  return (
    <div
      className="overflow-x-auto rounded-md"
      style={{ border: "1px solid var(--color-border-subtle)" }}
    >
      <table
        style={{
          borderCollapse: "collapse",
          width: "100%",
          minWidth: 520,
        }}
      >
        <thead>
          <tr>
            <th style={thStyle("left")}>Contaminant</th>
            {COLUMNS.map((c) => (
              <th key={c.key} style={thStyle("center")}>
                {c.label}
              </th>
            ))}
            <th style={thStyle("center")}>Install</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ row, detected, context_label }) => {
            const distillUv = betterEffectiveness(
              row.effectiveness.distillation,
              row.effectiveness.uv,
            );
            return (
              <tr
                key={row.key}
                style={{
                  backgroundColor: detected
                    ? `color-mix(in oklab, ${AMBER} 8%, transparent)`
                    : "transparent",
                  borderTop: "1px solid var(--color-border-subtle)",
                }}
              >
                <td style={tdStyle("left")}>
                  <div
                    className="flex items-center gap-1.5"
                    style={{
                      fontSize: 13,
                      fontWeight: 500,
                      color: detected ? AMBER : "var(--color-text-primary)",
                    }}
                  >
                    {detected ? (
                      <span
                        aria-hidden
                        className="inline-block rounded-full shrink-0"
                        style={{
                          width: 6,
                          height: 6,
                          backgroundColor: AMBER,
                        }}
                      />
                    ) : null}
                    {row.label}
                  </div>
                  <div
                    className="text-small"
                    style={{
                      color: "var(--color-text-tertiary)",
                      fontSize: 11,
                      marginTop: 2,
                    }}
                  >
                    {context_label}
                  </div>
                </td>
                <EffectivenessCell value={row.effectiveness.carbon_block} />
                <EffectivenessCell value={row.effectiveness.pitcher} />
                <EffectivenessCell value={row.effectiveness.reverse_osmosis} />
                <EffectivenessCell value={row.effectiveness.ion_exchange} />
                <EffectivenessCell value={distillUv} />
                <td style={tdStyle("center")}>
                  <span
                    className="text-small"
                    style={{ color: "var(--color-text-tertiary)", fontSize: 11 }}
                  >
                    {installLabel(row.install)}
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function EffectivenessCell({ value }: { value: RemediationEffectiveness }) {
  return <td style={tdStyle("center")}>{<EffectivenessPill value={value} />}</td>;
}

const EFFECTIVENESS_STYLE: Record<
  RemediationEffectiveness,
  { label: string; bg: string; color: string } | null
> = {
  full: {
    label: "full",
    bg: "color-mix(in oklab, var(--color-success) 16%, transparent)",
    color: "var(--color-success)",
  },
  partial: {
    label: "partial",
    bg: `color-mix(in oklab, ${AMBER} 18%, transparent)`,
    color: AMBER,
  },
  unreliable: {
    label: "unreliable",
    bg: "color-mix(in oklab, var(--color-danger) 16%, transparent)",
    color: "var(--color-danger)",
  },
  none: null,
};

function EffectivenessPill({ value }: { value: RemediationEffectiveness }) {
  const s = EFFECTIVENESS_STYLE[value];
  if (!s) {
    return (
      <span
        aria-label="not effective"
        style={{ color: "var(--color-text-tertiary)" }}
      >
        &mdash;
      </span>
    );
  }
  return (
    <span
      className="rounded-full px-2 py-0.5"
      style={{
        backgroundColor: s.bg,
        color: s.color,
        fontSize: 10,
        fontWeight: 500,
        whiteSpace: "nowrap",
      }}
    >
      {s.label}
    </span>
  );
}

/* ---------- legend ----------------------------------------------------- */

function Legend() {
  return (
    <ul className="flex flex-wrap items-center gap-x-4 gap-y-2">
      <LegendItem swatch="var(--color-success)" label="Full removal (NSF certified)" />
      <LegendItem swatch={AMBER} label="Partial / variable" />
      <LegendItem swatch="var(--color-danger)" label="Unreliable" />
      <li className="inline-flex items-center gap-1.5">
        <span
          aria-hidden
          className="inline-block rounded-full"
          style={{ width: 8, height: 8, backgroundColor: AMBER }}
        />
        <span
          className="text-small"
          style={{ color: "var(--color-text-tertiary)", fontSize: 11 }}
        >
          Detected in your water
        </span>
      </li>
    </ul>
  );
}

function LegendItem({ swatch, label }: { swatch: string; label: string }) {
  return (
    <li className="inline-flex items-center gap-1.5">
      <span
        aria-hidden
        className="inline-block rounded-sm"
        style={{
          width: 10,
          height: 10,
          backgroundColor: `color-mix(in oklab, ${swatch} 30%, transparent)`,
          border: `1px solid ${swatch}`,
        }}
      />
      <span
        className="text-small"
        style={{ color: "var(--color-text-tertiary)", fontSize: 11 }}
      >
        {label}
      </span>
    </li>
  );
}

/* ---------- worth knowing ---------------------------------------------- */

function WorthKnowing({
  icon,
  title,
  body,
}: {
  icon: "shield" | "flame" | "home";
  title: string;
  body: string;
}) {
  return (
    <li
      className="rounded-md flex items-start gap-3 p-3"
      style={{
        border: "1px solid var(--color-border-subtle)",
        backgroundColor: "var(--color-bg-surface-raised)",
      }}
    >
      <span
        aria-hidden
        className="shrink-0 mt-0.5"
        style={{ color: "var(--color-text-secondary)" }}
      >
        <Icon name={icon} size={18} />
      </span>
      <div className="min-w-0 flex-1">
        <div
          style={{
            fontSize: 13,
            fontWeight: 500,
            color: "var(--color-text-primary)",
          }}
        >
          {title}
        </div>
        <p
          className="text-small mt-1"
          style={{ color: "var(--color-text-secondary)", lineHeight: 1.55, margin: 0 }}
        >
          {body}
        </p>
      </div>
    </li>
  );
}

/* ---------- helpers ---------------------------------------------------- */

function installLabel(loc: InstallLocation): string {
  switch (loc) {
    case "tap":
      return "tap only";
    case "either":
      return "either";
    case "whole_house":
      return "whole house";
  }
}

function joinNames(names: string[]): string {
  if (names.length === 0) return "";
  if (names.length === 1) return names[0];
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(", ")}, and ${names[names.length - 1]}`;
}

function thStyle(align: "left" | "center"): React.CSSProperties {
  return {
    textAlign: align,
    padding: "8px 10px",
    fontSize: 10,
    letterSpacing: "0.06em",
    textTransform: "uppercase",
    color: "var(--color-text-tertiary)",
    backgroundColor: "var(--color-bg-base)",
    fontWeight: 500,
    whiteSpace: "nowrap",
  };
}

function tdStyle(align: "left" | "center"): React.CSSProperties {
  return {
    textAlign: align,
    padding: "8px 10px",
    verticalAlign: "top",
  };
}
