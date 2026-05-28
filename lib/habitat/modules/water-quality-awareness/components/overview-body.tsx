"use client";

/**
 * WQA overview body — the rich modal content the
 * `HabitatModule.renderOverviewBody` slot (issue #171) returns.
 *
 * Replaces the standard banner / recommended-actions / overview-cards
 * layout for the WQA module. Renders five sections in order:
 *
 *   1. Branch-aware header strip (conditional per branch)
 *   2. "Your water system" card with 3-stat grid (cws_no_ccr,
 *      non_community, cws_with_ccr — anywhere there's a system_card)
 *   3. Recommended for your situation (when recommended_actions
 *      is populated)
 *   4. Detected in your water (lead and copper measurements with
 *      tier cues; CCR-detected contaminants when ccr_findings is
 *      populated — issue #194 WQA-3 follow-up)
 *   5. Sources block (status pills for each of the four data sources)
 *
 * The `houseId` prop comes from the modal shell's
 * `renderOverviewBody(row, { houseId })` context call. It's required
 * because the Latest CCR tile spawns a house-scoped CCR upload modal
 * — without it, no upload affordance can render.
 */

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import {
  confirmWqaPwsid,
  correctWqaPwsid,
  triggerHabitatModuleRecheck,
} from "@/app/(app)/dashboard/actions";
import { CcrUploadModal } from "@/components/ccr-upload/CcrUploadModal";
import { Icon, type IconName } from "@/components/icon";
import { Tooltip } from "@/components/tooltip";
import { findWqaContaminantByAlias } from "@/lib/habitat/water-quality/contaminants/lookup";
import type { HabitatRecheckSource } from "@/lib/habitat/types";
import type { HabitatFindingRow } from "@/lib/hooks/use-habitat-findings";
import {
  isValidPwsid,
  normalizePwsid,
} from "../pwsid-validation";
import type {
  CcrFindings,
  CcrSummarizedContaminant,
  CcrContaminantTier,
} from "../ccr";
import type { LcrMeasurement } from "../lcr";
import {
  APPROACHING_THRESHOLD_RATIO,
  COPPER_ACTION_LEVEL_MG_L,
  LEAD_ACTION_LEVEL_MG_L,
} from "../lcr";
import type {
  WqaBranch,
  WqaFindings,
  WqaRecommendedAction,
} from "../types";

/* ---------- top-level body --------------------------------------------- */

export function WqaOverviewBody({
  row,
  houseId,
  notifyRecheckTriggered,
}: {
  row: HabitatFindingRow;
  houseId: string;
  /**
   * Issue #196 — let the modal shell pre-arm its fresh-update banner
   * when the body kicks off a recheck on its own (currently the CCR
   * upload success path and the issue #193 PWSID correction path).
   * Optional so the existing test renders that pass `row` + `houseId`
   * only keep working unchanged; in production the modal shell always
   * provides it.
   */
  notifyRecheckTriggered?: (source: HabitatRecheckSource) => void;
}) {
  const f = (row.findings ?? null) as WqaFindings | null;
  const router = useRouter();
  const [ccrModalOpen, setCcrModalOpen] = useState(false);

  // Issue #193 — PWSID correction in-flight state.
  //
  // The "Yes, that's right" confirm path doesn't touch this state — it
  // mutates the finding row directly via Realtime, so the strip
  // disappears the moment the next prop lands.
  //
  // The "No, my utility is different" correct path triggers a full
  // WQA recheck. We track the wall-clock timestamp the trigger fired
  // so we can ignore row updates that arrived before the correction
  // (matches the existing `pendingRecheck.since` pattern in the modal
  // shell, see components/habitat-finding-modal.tsx).
  //
  // Cleared when `row.checked_at` advances past `since` AND
  // `row.status === "completed"` — that's the same convergence rule
  // the modal-shell banner uses, just localized to the WQA body so
  // the system card can show an inline "Re-running…" state while the
  // workflow is in flight.
  const [correctionInFlight, setCorrectionInFlight] = useState<{
    since: number;
  } | null>(null);

  useEffect(() => {
    if (!correctionInFlight) return;
    if (row.status !== "completed") return;
    const checkedAt = row.checked_at
      ? new Date(row.checked_at).getTime()
      : null;
    if (checkedAt === null || checkedAt < correctionInFlight.since) return;
    setCorrectionInFlight(null);
  }, [correctionInFlight, row.status, row.checked_at]);

  if (!f) {
    return (
      <p
        className="text-small"
        style={{ color: "var(--color-text-tertiary)" }}
      >
        We don&rsquo;t have water-system data for this run yet. Try again
        once the next refresh completes.
      </p>
    );
  }

  const card = f.system_card;
  const isReRunningForCorrection = correctionInFlight !== null;

  // Shared callback used by both the InferredHeader "No" path and the
  // SystemCard post-confirmation edit affordance. Pre-arms the modal
  // shell's banner and flips the local in-flight state synchronously
  // so the UI swaps to the "Re-running…" view without waiting for the
  // first realtime push.
  function handleCorrectionSubmitted() {
    notifyRecheckTriggered?.("manual");
    setCorrectionInFlight({ since: Date.now() });
  }

  return (
    <div className="flex flex-col gap-6">
      {!isReRunningForCorrection ? (
        <BranchHeaderStrip
          findings={f}
          houseId={houseId}
          onCorrectionSubmitted={handleCorrectionSubmitted}
        />
      ) : null}
      {isReRunningForCorrection ? (
        <ReRunningSystemCard />
      ) : (
        <SystemCard
          findings={f}
          houseId={houseId}
          onCorrectionSubmitted={handleCorrectionSubmitted}
          onUploadCcrRequest={
            card &&
            card.latest_ccr_status === "not_uploaded" &&
            f.branch === "cws_no_ccr"
              ? () => setCcrModalOpen(true)
              : null
          }
        />
      )}
      <RecommendedActionsSection findings={f} />
      <DetectedInWater findings={f} />
      <SourcesBlock findings={f} />

      {card?.pwsid ? (
        <CcrUploadModal
          open={ccrModalOpen}
          onOpenChange={setCcrModalOpen}
          houseId={houseId}
          pwsid={card.pwsid}
          utilityName={card.pws_name}
          knownSystemContext={card.description}
          onSuccess={() => {
            // Issue #196: pre-arm the modal shell's fresh-update banner
            // so the row update that lands ~10-20s later surfaces the
            // CCR-aware copy variant. Calling this before the trigger
            // makes the source attribution unambiguous — the snapshot
            // captures the current row (latest_ccr_status="not_uploaded")
            // as the "before" state.
            notifyRecheckTriggered?.("ccr_upload");
            // Per-module trigger (#196): only WQA re-runs, not every
            // habitat module against the house. WQA's check() finds
            // the freshly-persisted CCR in the shared cache and writes
            // cws_with_ccr + ccr_findings + latest_ccr_status: { year }
            // onto the finding row. The dashboard's realtime
            // subscription propagates that update into both the
            // dashboard tile and the finding modal the user is still
            // looking at — no manual refresh needed. Fire-and-forget:
            // the server action returns immediately because the
            // workflow runs in the background. router.refresh() also
            // runs to catch server-component surfaces.
            void triggerHabitatModuleRecheck(
              houseId,
              "water_quality_awareness",
            );
            router.refresh();
          }}
        />
      ) : null}
    </div>
  );
}

/**
 * Replaces the System Card while a user-corrected PWSID is being
 * processed. Calm centered message + spinner so the user knows
 * something's happening; the modal shell's footer also shows the
 * generic "Rechecking…" indicator, but this in-place state keeps the
 * eye where the change is about to land. Issue #193.
 */
function ReRunningSystemCard() {
  return (
    <section
      className="rounded-md flex items-center gap-3 p-4"
      style={{
        border: "1px solid var(--color-border-subtle)",
        backgroundColor: "var(--color-bg-surface-raised)",
      }}
      aria-live="polite"
    >
      <InlineSpinner />
      <div className="min-w-0 flex-1">
        <div
          style={{
            fontSize: 14,
            fontWeight: 500,
            color: "var(--color-text-primary)",
          }}
        >
          Re-running your water quality check
        </div>
        <p
          className="text-small"
          style={{
            color: "var(--color-text-secondary)",
            lineHeight: 1.55,
            margin: 0,
            marginTop: 4,
          }}
        >
          Using the utility you just told us about. This usually takes
          a few seconds.
        </p>
      </div>
    </section>
  );
}

function InlineSpinner() {
  return (
    <span
      aria-hidden
      className="inline-block h-4 w-4 rounded-full border-2 shrink-0"
      style={{
        borderColor:
          "color-mix(in oklab, var(--color-text-secondary) 30%, transparent)",
        borderTopColor: "var(--color-accent)",
        animation: "spin 0.8s linear infinite",
      }}
    />
  );
}

/* ---------- 1. branch-aware header strip ------------------------------- */

/**
 * The header strip sits directly under the modal header. Most branches
 * either get a small framing note (private_well, non_community) or no
 * strip at all (cws_no_ccr with verified PWSID). The two interactive
 * cases (cws_no_ccr + inferred, cws_unmapped) ship visual affordances
 * only in this issue — the actual confirm/correct + upload wiring is
 * deferred to follow-up issues (see Open questions on #171).
 */
function BranchHeaderStrip({
  findings,
  houseId,
  onCorrectionSubmitted,
}: {
  findings: WqaFindings;
  houseId: string;
  /**
   * Fires when the user has submitted a PWSID correction and the
   * server action has acknowledged it. Lets the parent flip the
   * in-flight state so the System Card swaps to the "Re-running…"
   * view while the workflow churns. Issue #193.
   */
  onCorrectionSubmitted: () => void;
}) {
  const branch = findings.branch;
  const card = findings.system_card;
  const confidence = card?.pwsid_confidence;

  if (branch === "cws_no_ccr" && confidence === "inferred" && card) {
    return (
      <InferredHeader
        pwsName={card.pws_name}
        pwsid={card.pwsid}
        houseId={houseId}
        onCorrectionSubmitted={onCorrectionSubmitted}
      />
    );
  }
  if (branch === "cws_unmapped") {
    return <CwsUnmappedHeader />;
  }
  if (branch === "private_well") {
    return <PrivateWellHeader />;
  }
  if (branch === "non_community") {
    return <NonCommunityHeader pwsName={card?.pws_name ?? "your water provider"} />;
  }
  if (branch === "stale") {
    return <StaleHeader diagnostic={findings.branch_metadata.diagnostic_note} />;
  }
  // cws_no_ccr verified / user_confirmed / user_corrected, cws_with_ccr
  // — no strip (the system card below carries the framing on its own).
  return null;
}

function HeaderStripCard(props: {
  iconName: Parameters<typeof Icon>[0]["name"];
  title: string;
  body: React.ReactNode;
  cta?: React.ReactNode;
  tone?: "info" | "neutral";
}) {
  const { iconName, title, body, cta, tone = "info" } = props;
  return (
    <div
      className="rounded-md flex items-start gap-3 p-3 sm:p-4"
      style={{
        border: "1px solid var(--color-border-subtle)",
        backgroundColor:
          tone === "info"
            ? "color-mix(in oklab, var(--color-accent) 6%, transparent)"
            : "var(--color-bg-surface-raised)",
      }}
    >
      <span
        aria-hidden
        className="shrink-0 mt-0.5"
        style={{ color: "var(--color-accent)" }}
      >
        <Icon name={iconName} size={18} />
      </span>
      <div className="min-w-0 flex-1">
        <div
          style={{
            fontSize: 14,
            fontWeight: 500,
            color: "var(--color-text-primary)",
          }}
        >
          {title}
        </div>
        <div
          className="text-small mt-1"
          style={{ color: "var(--color-text-secondary)", lineHeight: 1.55 }}
        >
          {body}
        </div>
        {cta ? <div className="mt-2">{cta}</div> : null}
      </div>
    </div>
  );
}

/**
 * Confirmation / correction prompt rendered on the `cws_no_ccr` branch
 * when `pwsid_confidence === "inferred"`. Issue #193 wires the two
 * buttons: "Yes, that's right" flips the persisted confidence to
 * `user_confirmed` in place (no recheck — the PWSID itself didn't
 * change), while "No, my utility is different" expands an inline
 * PWSID input that triggers a full recheck on save.
 */
function InferredHeader({
  pwsName,
  pwsid,
  houseId,
  onCorrectionSubmitted,
}: {
  pwsName: string;
  pwsid: string;
  houseId: string;
  onCorrectionSubmitted: () => void;
}) {
  const [mode, setMode] = useState<"prompt" | "correcting">("prompt");
  const [confirmInFlight, setConfirmInFlight] = useState(false);
  const [confirmError, setConfirmError] = useState<string | null>(null);

  if (mode === "correcting") {
    return (
      <HeaderStripCard
        iconName="info"
        title="Tell us your water utility"
        body={
          <>
            Enter your PWSID — your utility&rsquo;s federal ID. You can
            find it on your most recent water bill, on your utility&rsquo;s
            annual Water Quality Report, or by searching the{" "}
            <a
              href="https://sdwis.epa.gov/ords/sfdw_pub/r/sfdw/sdwis_fed_reports_public/200"
              target="_blank"
              rel="noopener noreferrer"
              style={{ color: "var(--color-accent)" }}
            >
              EPA&rsquo;s SDWIS public search
            </a>
            .
          </>
        }
        cta={
          <PwsidEditor
            houseId={houseId}
            initialValue=""
            onCancel={() => setMode("prompt")}
            onSubmitted={onCorrectionSubmitted}
          />
        }
      />
    );
  }

  return (
    <HeaderStripCard
      iconName="info"
      title={`We think your home is served by ${pwsName}`}
      body={
        <>
          EPA&rsquo;s national map didn&rsquo;t directly cover your address,
          but every public water utility within 500 meters of your home
          is the same one. We&rsquo;re going with that, with medium
          confidence.
        </>
      }
      cta={
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="btn btn-secondary"
              disabled={confirmInFlight}
              onClick={async () => {
                setConfirmError(null);
                setConfirmInFlight(true);
                const result = await confirmWqaPwsid(houseId, pwsid);
                if (!result.ok) {
                  setConfirmError(result.error);
                  setConfirmInFlight(false);
                }
                // On success, the realtime update flips
                // pwsid_confidence on the persisted finding so this
                // component unmounts. No need to clear in-flight state.
              }}
            >
              {confirmInFlight ? "Saving…" : "Yes, that's right"}
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => setMode("correcting")}
            >
              No, my utility is different
            </button>
          </div>
          {confirmError ? (
            <p
              className="text-small"
              style={{ color: "var(--color-danger)" }}
              role="alert"
            >
              {confirmError}
            </p>
          ) : null}
        </div>
      }
    />
  );
}

/**
 * Inline PWSID input. Used by both the "No, my utility is different"
 * path on the inferred-confidence header strip and the post-
 * confirmation edit affordance on the System Card. Format-validates
 * client-side against `^[A-Z]{2}\d{7}$` so the Save button only
 * lights up when the user has typed something the server will accept.
 *
 * On submit, calls `correctWqaPwsid` which writes the override to
 * `hearth.houses` and triggers a single-module WQA recheck. Errors
 * surface inline; the input stays visible so the user can retry
 * without losing what they typed. Issue #193.
 */
function PwsidEditor({
  houseId,
  initialValue,
  onCancel,
  onSubmitted,
}: {
  houseId: string;
  initialValue: string;
  onCancel: () => void;
  /**
   * Fires when `correctWqaPwsid` returns ok. The parent flips its
   * in-flight state so the System Card swaps to the "Re-running…"
   * view; this component unmounts as part of that swap.
   */
  onSubmitted: () => void;
}) {
  const [value, setValue] = useState(initialValue);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // Auto-focus the input when the editor mounts so the user can start
  // typing immediately. requestAnimationFrame defers past the parent's
  // layout settle so the focus call lands in the right tick.
  useEffect(() => {
    const raf = requestAnimationFrame(() => inputRef.current?.focus());
    return () => cancelAnimationFrame(raf);
  }, []);

  const normalized = normalizePwsid(value);
  const isValid = isValidPwsid(normalized);

  async function handleSubmit() {
    if (!isValid || submitting) return;
    setError(null);
    setSubmitting(true);
    const result = await correctWqaPwsid(houseId, normalized);
    if (!result.ok) {
      setError(result.error);
      setSubmitting(false);
      return;
    }
    onSubmitted();
    // The parent unmounts us when the in-flight state flips. Leaving
    // `submitting` true here prevents any flash of an interactive
    // state in the final frame before unmount.
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <label
          htmlFor="wqa-pwsid-input"
          className="text-small"
          style={{ color: "var(--color-text-secondary)" }}
        >
          PWSID
        </label>
        <input
          ref={inputRef}
          id="wqa-pwsid-input"
          type="text"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void handleSubmit();
            } else if (e.key === "Escape") {
              e.preventDefault();
              onCancel();
            }
          }}
          placeholder="MI0003520"
          autoComplete="off"
          spellCheck={false}
          disabled={submitting}
          aria-invalid={value.length > 0 && !isValid}
          aria-describedby="wqa-pwsid-hint"
          className="mono"
          style={{
            width: "12ch",
            padding: "6px 8px",
            border: "1px solid var(--color-border-subtle)",
            borderRadius: "var(--radius-sm)",
            backgroundColor: "var(--color-bg-base)",
            color: "var(--color-text-primary)",
            fontSize: 13,
          }}
        />
        <button
          type="button"
          className="btn btn-secondary"
          onClick={handleSubmit}
          disabled={!isValid || submitting}
        >
          {submitting ? "Saving…" : "Save"}
        </button>
        <button
          type="button"
          className="btn btn-ghost"
          onClick={onCancel}
          disabled={submitting}
        >
          Cancel
        </button>
      </div>
      <p
        id="wqa-pwsid-hint"
        className="text-small"
        style={{ color: "var(--color-text-tertiary)", lineHeight: 1.55 }}
      >
        Format: two-letter state code followed by a seven-digit number
        (e.g. MI0003520).
      </p>
      {error ? (
        <p
          className="text-small"
          style={{ color: "var(--color-danger)" }}
          role="alert"
        >
          {error}
        </p>
      ) : null}
    </div>
  );
}

function CwsUnmappedHeader() {
  return (
    <HeaderStripCard
      iconName="info"
      title="We couldn't pinpoint your utility on EPA's map"
      body={
        <>
          You told us during onboarding that you&rsquo;re on city water,
          but EPA&rsquo;s national map doesn&rsquo;t cover your exact
          address. About one in every seven U.S. addresses falls into a
          gap like this. Once you upload your utility&rsquo;s annual
          Water Quality Report, we&rsquo;ll be able to surface
          personalized findings.
        </>
      }
      cta={
        <DisabledPlaceholderButton
          label="Upload your Water Quality Report"
          note="CCR upload is coming in WQA-3"
        />
      }
    />
  );
}

function PrivateWellHeader() {
  return (
    <HeaderStripCard
      iconName="droplet"
      title="Your home is on a private water system"
      body={
        <>
          The EPA doesn&rsquo;t monitor private wells or shared private
          systems — testing is your responsibility. Most state extension
          services and county health departments recommend testing for
          coliform bacteria annually, and for nitrate / nitrite every
          1–2 years; arsenic, lead, and radon-in-water are good
          additional one-time baseline tests.
        </>
      }
      tone="neutral"
    />
  );
}

function NonCommunityHeader({ pwsName }: { pwsName: string }) {
  return (
    <HeaderStripCard
      iconName="info"
      title={`Served by ${pwsName} — a non-community water system`}
      body={
        <>
          Non-community systems serve places like schools, campgrounds,
          and small businesses. They&rsquo;re regulated by EPA but
          aren&rsquo;t required to publish an annual Water Quality
          Report, so we&rsquo;ll lean on the compliance data below.
        </>
      }
      tone="neutral"
    />
  );
}

function StaleHeader({ diagnostic }: { diagnostic: string | undefined }) {
  return (
    <HeaderStripCard
      iconName="info"
      title="We had trouble reading your utility's record"
      body={
        <>
          EPA returned an unexpected response for your address. This
          sometimes happens for newer addresses or recent system
          changes. We&rsquo;ll try again on the next refresh.
          {diagnostic ? (
            <div
              className="mono mt-2"
              style={{ fontSize: 11, color: "var(--color-text-tertiary)" }}
            >
              {diagnostic}
            </div>
          ) : null}
        </>
      }
      tone="neutral"
    />
  );
}

/**
 * A visual-only button used for affordances whose backend wiring
 * hasn't shipped yet. Disabled at the HTML level; hover state shows
 * the deferred-to-follow-up note. Pattern lets the mockup ship
 * faithfully without false promises about what clicking will do.
 */
function DisabledPlaceholderButton({
  label,
  note,
}: {
  label: string;
  note: string;
}) {
  return (
    <button
      type="button"
      disabled
      title={note}
      className="btn btn-secondary"
      style={{
        opacity: 0.6,
        cursor: "not-allowed",
      }}
      aria-label={`${label} — ${note}`}
    >
      {label}
    </button>
  );
}

/* ---------- 2. "Your water system" card -------------------------------- */

function SystemCard({
  findings,
  houseId,
  onCorrectionSubmitted,
  onUploadCcrRequest,
}: {
  findings: WqaFindings;
  houseId: string;
  /**
   * Issue #193 — fires when the user submits a PWSID correction
   * through the inline edit affordance. The parent flips the
   * in-flight state so this card swaps to the "Re-running…" view.
   */
  onCorrectionSubmitted: () => void;
  /**
   * When set, the Latest CCR tile renders as an interactive button
   * inviting the user to upload their utility's annual report. Null
   * on every state where upload isn't the right next step (CCR
   * already on file, non-CWS branches, cws_unmapped without a PWSID).
   */
  onUploadCcrRequest: (() => void) | null;
}) {
  const card = findings.system_card;
  // Issue #193 — local toggle for the inline PWSID edit affordance.
  // Lives on this component (not lifted) because the editor only
  // visually replaces the PWSID line; the rest of the card stays put.
  const [editingPwsid, setEditingPwsid] = useState(false);
  if (!card) return null;

  const sourceLabel = (() => {
    switch (card.source_type) {
      case "groundwater":
        return "Groundwater";
      case "surface":
        return "Surface water";
      case "groundwater_under_surface":
        return "Mixed (groundwater under surface influence)";
      case "unknown":
      default:
        return "Not specified";
    }
  })();

  const compliance = ((): {
    label: string;
    tone: TileTone;
    icon: IconName | null;
  } => {
    if (card.compliance_status_short === "active_violations") {
      const recent = card.recent_violations;
      const contaminant = recent?.most_recent?.contaminant_name;
      return {
        label: contaminant
          ? `Active violation: ${contaminant}`
          : "Active violation on file",
        tone: "danger",
        icon: "alert-triangle",
      };
    }
    if (card.compliance_status_short === "no_active_violations") {
      return {
        label: "No active violations",
        tone: "success",
        icon: "shield",
      };
    }
    return { label: "Not yet checked", tone: "neutral", icon: null };
  })();

  const ccr = ((): {
    label: string;
    tone: TileTone;
    icon: IconName | null;
  } => {
    if (card.latest_ccr_status === "not_uploaded") {
      return { label: "Not yet uploaded", tone: "info", icon: "file-text" };
    }
    return {
      label: `${card.latest_ccr_status.year} report on file`,
      tone: "success",
      icon: "file-text",
    };
  })();

  return (
    <section
      className="rounded-md"
      style={{
        border: "1px solid var(--color-border-subtle)",
        backgroundColor: "var(--color-bg-surface-raised)",
        padding: "var(--space-4)",
      }}
      aria-labelledby="wqa-system-card-heading"
    >
      <div className="eyebrow mb-1">Your water system</div>
      <h3
        id="wqa-system-card-heading"
        className="h3"
        style={{ marginBottom: 4 }}
      >
        {card.pws_name}
      </h3>
      {editingPwsid ? (
        // Issue #193 — inline correction editor replaces the PWSID
        // display line. Same component the "No, my utility is
        // different" path uses on the inferred-confidence header
        // strip; one editor, two entry points.
        <div style={{ marginBottom: 12 }}>
          <PwsidEditor
            houseId={houseId}
            initialValue={card.pwsid}
            onCancel={() => setEditingPwsid(false)}
            onSubmitted={() => {
              setEditingPwsid(false);
              onCorrectionSubmitted();
            }}
          />
        </div>
      ) : (
        <div
          className="flex items-center gap-2"
          style={{ marginBottom: 12 }}
        >
          <span
            className="mono text-small"
            style={{ color: "var(--color-text-tertiary)" }}
          >
            PWSID {card.pwsid}
          </span>
          {/* Edit affordance only on confirmation-eligible states.
              Suppressed on `inferred` because the dedicated header
              strip carries the confirm/correct affordance — showing
              edit here too would be redundant and confusing. */}
          {card.pwsid_confidence !== "inferred" ? (
            <button
              type="button"
              onClick={() => setEditingPwsid(true)}
              className="inline-flex items-center gap-1 text-small"
              aria-label="Change your water utility's PWSID"
              style={{
                color: "var(--color-text-tertiary)",
                background: "transparent",
                border: "none",
                padding: 0,
              }}
            >
              <Icon name="edit" size={12} aria-hidden />
              <span>Edit</span>
            </button>
          ) : null}
        </div>
      )}

      <div
        className="grid gap-3"
        style={{
          gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
          marginBottom: 12,
        }}
      >
        <StatTile
          label="Compliance"
          value={compliance.label}
          tone={compliance.tone}
          icon={compliance.icon}
          tooltip="EPA's SDWIS database tracks federally regulated contaminant violations — lead, copper, microbials, disinfection byproducts, and more. 'No active violations' means no open enforcement actions against your utility for the most recent reporting period."
        />
        <StatTile
          label="Latest CCR"
          value={onUploadCcrRequest ? "Upload yours" : ccr.label}
          tone={onUploadCcrRequest ? "info" : ccr.tone}
          icon={onUploadCcrRequest ? "upload" : ccr.icon}
          tooltip={
            card.latest_ccr_status === "not_uploaded"
              ? "A Consumer Confidence Report (CCR), also called an Annual Water Quality Report, is the federally-required annual disclosure of every regulated contaminant your utility tested for and detected last year. Utilities mail or email it by July 1 each year — upload yours to populate the rest of this finding."
              : `Your utility's ${card.latest_ccr_status.year} Consumer Confidence Report is on file. The contaminants listed below — along with any free-testing offer and the recommended actions — were extracted directly from that report.`
          }
          onClick={onUploadCcrRequest ?? undefined}
          actionable={onUploadCcrRequest !== null}
        />
        <StatTile
          label="Source"
          value={sourceLabel}
          tone="info"
          icon="droplet"
          tooltip="Where your tap water originates, per EPA's Envirofacts WATER_SYSTEM record. Groundwater systems pump from wells or aquifers; surface-water systems draw from rivers, lakes, or reservoirs; mixed systems use groundwater under the influence of surface water."
        />
      </div>

      <p
        className="text-small"
        style={{ color: "var(--color-text-secondary)", lineHeight: 1.55 }}
      >
        {card.description}
      </p>

      {card.pwsid_confidence === "inferred" ? (
        <p
          className="text-small mt-2"
          style={{ color: "var(--color-text-tertiary)", lineHeight: 1.55 }}
        >
          We inferred this match from nearby utilities — EPA&rsquo;s map
          didn&rsquo;t directly cover your address.
        </p>
      ) : null}
    </section>
  );
}

type TileTone = "neutral" | "success" | "info" | "danger";

/**
 * Visual treatment for the system-card stat tiles. Tinted variants
 * (success / info / danger) lift the dominant state cues — a green
 * "no active violations" tile reads as "good" before the user reads
 * the text, and a blue Source tile breaks up a gray-dominant card.
 *
 * Tints mirror the project's existing pattern (globals.css line ~478):
 * a soft 14% mix for background and a 35% mix for border, so the
 * accents register as a tone, not a stoplight.
 */
const TONE_STYLES: Record<
  TileTone,
  { background: string; border: string; accent: string }
> = {
  neutral: {
    background: "var(--color-bg-base)",
    border: "var(--color-border-subtle)",
    accent: "var(--color-text-secondary)",
  },
  success: {
    background: "color-mix(in oklab, var(--color-success) 14%, transparent)",
    border: "color-mix(in oklab, var(--color-success) 35%, transparent)",
    accent: "var(--color-success)",
  },
  info: {
    background: "color-mix(in oklab, var(--color-info) 14%, transparent)",
    border: "color-mix(in oklab, var(--color-info) 35%, transparent)",
    accent: "var(--color-info)",
  },
  danger: {
    background: "color-mix(in oklab, var(--color-danger) 14%, transparent)",
    border: "color-mix(in oklab, var(--color-danger) 35%, transparent)",
    accent: "var(--color-danger)",
  },
};

function StatTile({
  label,
  value,
  tone = "neutral",
  icon = null,
  tooltip = null,
  onClick,
  actionable = false,
}: {
  label: string;
  value: string;
  tone?: TileTone;
  icon?: IconName | null;
  tooltip?: string | null;
  /** When set together with `actionable`, the tile becomes a button. */
  onClick?: () => void;
  /**
   * Renders the tile as an interactive button rather than a static
   * div. Used by the Latest CCR tile in cws_no_ccr to invite upload.
   */
  actionable?: boolean;
}) {
  const styles = TONE_STYLES[tone];
  const body = (
    <>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 4,
          marginBottom: 4,
        }}
      >
        <span className="eyebrow">{label}</span>
        {tooltip ? (
          <Tooltip content={tooltip}>
            <Icon
              name="info"
              size={13}
              aria-label={`What does ${label.toLowerCase()} mean?`}
              style={{
                color: "var(--color-text-tertiary)",
                cursor: "help",
              }}
            />
          </Tooltip>
        ) : null}
      </div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          fontSize: 14,
          fontWeight: 500,
          color: "var(--color-text-primary)",
        }}
      >
        {icon ? (
          <Icon
            name={icon}
            size={18}
            style={{ color: styles.accent, flexShrink: 0 }}
          />
        ) : null}
        <span>{value}</span>
      </div>
    </>
  );

  if (actionable && onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        className="rounded-md p-3 text-left transition-colors"
        style={{
          border: `1px solid ${styles.border}`,
          backgroundColor: styles.background,
          color: "inherit",
        }}
      >
        {body}
      </button>
    );
  }

  return (
    <div
      className="rounded-md p-3"
      style={{
        border: `1px solid ${styles.border}`,
        backgroundColor: styles.background,
      }}
    >
      {body}
    </div>
  );
}

/* ---------- 3. Recommended for your situation -------------------------- */

function RecommendedActionsSection({ findings }: { findings: WqaFindings }) {
  const actions = findings.recommended_actions ?? [];
  if (actions.length === 0) return null;
  return (
    <section aria-labelledby="wqa-recommended-actions-heading">
      <div
        id="wqa-recommended-actions-heading"
        className="eyebrow mb-2"
      >
        Recommended for your situation
      </div>
      <ul className="flex flex-col gap-2">
        {actions.map((action) => (
          <li key={action.id}>
            <RecommendedActionCard action={action} />
          </li>
        ))}
      </ul>
    </section>
  );
}

function RecommendedActionCard({ action }: { action: WqaRecommendedAction }) {
  return (
    <div
      className="rounded-md flex items-start gap-3 p-3"
      style={{
        border: "1px solid var(--color-border-subtle)",
        backgroundColor: "var(--color-bg-surface-raised)",
      }}
    >
      <span
        aria-hidden
        className="shrink-0 flex items-center justify-center"
        style={{
          width: 32,
          height: 32,
          borderRadius: "var(--radius-md)",
          backgroundColor:
            "color-mix(in oklab, var(--color-accent) 14%, transparent)",
          color: "var(--color-accent)",
        }}
      >
        <Icon name={action.icon as never} size={16} />
      </span>
      <div className="min-w-0 flex-1">
        <div
          style={{
            fontSize: 14,
            fontWeight: 500,
            color: "var(--color-text-primary)",
          }}
        >
          {action.headline}
        </div>
        <p
          className="text-small"
          style={{
            color: "var(--color-text-secondary)",
            margin: 0,
            marginTop: 4,
            lineHeight: 1.55,
          }}
        >
          {action.supporting_line}
        </p>
        {action.provenance ? (
          <p
            className="text-small"
            style={{
              color: "var(--color-text-tertiary)",
              margin: 0,
              marginTop: 6,
              lineHeight: 1.55,
            }}
          >
            {action.provenance}
          </p>
        ) : null}
        {action.link ? (
          <div className="text-small mt-2">
            <a
              href={action.link.url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1"
              style={{ color: "var(--color-accent)" }}
            >
              <span>{action.link.label}</span>
              <Icon name="external-link" size={14} />
            </a>
          </div>
        ) : null}
      </div>
    </div>
  );
}

/* ---------- 4. Detected in your water --------------------------------- */

function DetectedInWater({ findings }: { findings: WqaFindings }) {
  const lcr = findings.lead_copper_summary;
  const ccr = findings.ccr_findings;

  // Suppress section entirely on branches that have no contaminant
  // data and no actionable empty-state copy to offer.
  if (findings.branch === "private_well" || findings.branch === "stale") {
    return null;
  }
  if (findings.branch === "cws_unmapped") {
    return null;
  }

  // On cws_with_ccr, the CCR's contaminant list is the canonical "what's
  // in your water" view — it covers lead/copper plus everything else the
  // utility tested. We render that in place of the SDWIS-only lead/copper
  // rows. On other CWS branches (cws_no_ccr, non_community) we fall
  // back to the SDWIS lead/copper view.
  const renderCcr =
    findings.branch === "cws_with_ccr" && ccr && ccr.contaminants !== null;

  return (
    <section aria-labelledby="wqa-detected-heading">
      <div id="wqa-detected-heading" className="eyebrow mb-2">
        Detected in your water
      </div>
      {renderCcr ? (
        <CcrContaminantList ccr={ccr!} />
      ) : !lcr || lcr.status === "unavailable" ? (
        <EmptyDetected
          body="We couldn't read your utility's lead-and-copper samples on this run. We'll try again on the next refresh."
        />
      ) : lcr.status === "no_samples_on_file" ? (
        <EmptyDetected
          body="EPA doesn't have lead-and-copper sample results on file for this utility yet — rotating sampling schedules mean this is common, especially for smaller utilities."
        />
      ) : (
        <ul className="flex flex-col gap-2">
          <ContaminantRow
            measurement={lcr.most_recent_sampling_period.lead_90th_percentile}
            actionLevel={LEAD_ACTION_LEVEL_MG_L}
            fallbackName="Lead"
            alias="PB90"
          />
          <ContaminantRow
            measurement={lcr.most_recent_sampling_period.copper_90th_percentile}
            actionLevel={COPPER_ACTION_LEVEL_MG_L}
            fallbackName="Copper"
            alias="CU90"
          />
        </ul>
      )}
    </section>
  );
}

/**
 * CCR-derived contaminant list. Read straight off `findings.ccr_findings`
 * which the summarizer already sorted concern → caution → context. Each
 * row shows the detected level, MCL, and source boilerplate from the
 * CCR; the disclosure expands to the contaminant-reference description
 * when one is on file.
 */
function CcrContaminantList({ ccr }: { ccr: CcrFindings }) {
  const contaminants = ccr.contaminants ?? [];

  if (contaminants.length === 0) {
    // The extraction returned a clean contaminant table — a positive
    // signal that the utility tested for the federally regulated set
    // and detected nothing above its reporting threshold. The lead/
    // copper distribution may still have data; surface it as the
    // bottom-line summary.
    return (
      <div className="flex flex-col gap-2">
        <p
          className="text-small"
          style={{ color: "var(--color-text-secondary)", lineHeight: 1.55 }}
        >
          Your utility&rsquo;s {ccr.report_year ?? "latest"} report shows no
          measurable detections above EPA reporting thresholds for the
          federally regulated contaminants.
        </p>
      </div>
    );
  }

  return (
    <ul className="flex flex-col gap-2">
      {contaminants.map((c, i) => (
        <li
          key={`${c.contaminant_name}-${i}`}
          className="rounded-md p-3"
          style={{
            border: "1px solid var(--color-border-subtle)",
            backgroundColor: "var(--color-bg-surface-raised)",
          }}
        >
          <div className="flex items-center gap-2 mb-1">
            <CcrTierBadge tier={c.tier} />
            <span
              style={{
                fontSize: 14,
                fontWeight: 500,
                color: "var(--color-text-primary)",
              }}
            >
              {c.contaminant_name}
            </span>
          </div>
          <div
            className="mono text-small"
            style={{ color: "var(--color-text-secondary)" }}
          >
            {formatCcrLevel(c)}
            {c.mcl !== null ? (
              <span style={{ color: "var(--color-text-tertiary)" }}>
                {" "}
                • MCL {c.mcl}
                {c.unit ? ` ${c.unit}` : ""}
              </span>
            ) : null}
            {c.monitoring_period ? (
              <span style={{ color: "var(--color-text-tertiary)" }}>
                {" "}
                • {c.monitoring_period}
              </span>
            ) : null}
          </div>
          {c.sources || c.notes ? (
            <details className="mt-2">
              <summary
                className="text-small cursor-pointer"
                style={{ color: "var(--color-accent)" }}
              >
                What this means
              </summary>
              <div
                className="text-small mt-2"
                style={{
                  color: "var(--color-text-secondary)",
                  lineHeight: 1.55,
                }}
              >
                {c.sources ? <p>Likely sources: {c.sources}</p> : null}
                {c.notes ? <p>{c.notes}</p> : null}
              </div>
            </details>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

function formatCcrLevel(c: CcrSummarizedContaminant): string {
  if (c.detected_level === null) return "Detection level not reported";
  if (c.unit) return `Detected: ${c.detected_level} ${c.unit}`;
  return `Detected: ${c.detected_level}`;
}

function CcrTierBadge({ tier }: { tier: CcrContaminantTier }) {
  const label =
    tier === "concern"
      ? "Worth acting on"
      : tier === "caution"
        ? "Worth knowing"
        : "Context";
  const tone =
    tier === "context"
      ? { bg: "var(--color-bg-base)", color: "var(--color-text-tertiary)" }
      : {
          bg: "color-mix(in oklab, #d97706 18%, transparent)",
          color: "#d97706",
        };
  return (
    <span
      className="rounded-full px-2 py-0.5 eyebrow"
      style={{
        backgroundColor: tone.bg,
        color: tone.color,
        fontSize: 10,
      }}
    >
      {label}
    </span>
  );
}

function EmptyDetected({ body }: { body: string }) {
  return (
    <p
      className="text-small"
      style={{
        color: "var(--color-text-tertiary)",
        lineHeight: 1.55,
      }}
    >
      {body}
    </p>
  );
}

function ContaminantRow({
  measurement,
  actionLevel,
  fallbackName,
  alias,
}: {
  measurement: LcrMeasurement | null;
  actionLevel: number;
  fallbackName: string;
  alias: string;
}) {
  if (!measurement) return null;
  const contaminant = findWqaContaminantByAlias(alias);
  const name = contaminant?.canonical_name ?? fallbackName;
  const tier = tierFor(measurement, actionLevel);
  const sign =
    measurement.sign === "<" ? "below detection" : `${measurement.value} ${measurement.unit}`;

  return (
    <li
      className="rounded-md p-3"
      style={{
        border: "1px solid var(--color-border-subtle)",
        backgroundColor: "var(--color-bg-surface-raised)",
      }}
    >
      <div className="flex items-center gap-2 mb-1">
        <TierBadge tier={tier} />
        <span
          style={{
            fontSize: 14,
            fontWeight: 500,
            color: "var(--color-text-primary)",
          }}
        >
          {name}
        </span>
      </div>
      <div
        className="mono text-small"
        style={{ color: "var(--color-text-secondary)" }}
      >
        Most recent 90th-percentile sample: {sign}
        <span style={{ color: "var(--color-text-tertiary)" }}>
          {" "}
          • federal action level {actionLevel} mg/L
        </span>
        {measurement.sample_id ? (
          <span style={{ color: "var(--color-text-tertiary)" }}>
            {" "}
            • EPA ref {measurement.sample_id}
          </span>
        ) : null}
      </div>
      {contaminant ? (
        <details className="mt-2">
          <summary
            className="text-small cursor-pointer"
            style={{ color: "var(--color-accent)" }}
          >
            What this means
          </summary>
          <div
            className="text-small mt-2"
            style={{
              color: "var(--color-text-secondary)",
              lineHeight: 1.55,
            }}
          >
            <p>{contaminant.description}</p>
            <div
              className="mt-2"
              style={{ color: "var(--color-text-tertiary)" }}
            >
              {contaminant.federal_limits.map((limit) => (
                <div key={limit.kind}>{limit.label}</div>
              ))}
            </div>
            <a
              href={contaminant.learn_more_url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 mt-2"
              style={{ color: "var(--color-accent)" }}
            >
              <span>Learn more on EPA.gov</span>
              <Icon name="external-link" size={12} />
            </a>
          </div>
        </details>
      ) : null}
    </li>
  );
}

type Tier = "worth_acting_on" | "worth_knowing" | "context";

function tierFor(measurement: LcrMeasurement, actionLevel: number): Tier {
  if (measurement.sign === "<") return "context";
  if (measurement.value >= actionLevel) return "worth_acting_on";
  if (measurement.value >= actionLevel * APPROACHING_THRESHOLD_RATIO) {
    return "worth_knowing";
  }
  return "context";
}

function TierBadge({ tier }: { tier: Tier }) {
  const label =
    tier === "worth_acting_on"
      ? "Worth acting on"
      : tier === "worth_knowing"
        ? "Worth knowing"
        : "Context";
  // Amber for the two attention tiers, gray for context. Using
  // explicit hex values rather than design tokens to keep the badge
  // distinct from the severity dot's color scheme (which uses tokens).
  const tone =
    tier === "context"
      ? { bg: "var(--color-bg-base)", color: "var(--color-text-tertiary)" }
      : {
          bg: "color-mix(in oklab, #d97706 18%, transparent)",
          color: "#d97706",
        };
  return (
    <span
      className="rounded-full px-2 py-0.5 eyebrow"
      style={{
        backgroundColor: tone.bg,
        color: tone.color,
        fontSize: 10,
      }}
    >
      {label}
    </span>
  );
}

/* ---------- 5. Sources block ------------------------------------------ */

function SourcesBlock({ findings }: { findings: WqaFindings }) {
  // For branches with no PWSID and no SDWIS pull, the sources block
  // doesn't carry much signal; suppress it to keep the modal compact.
  if (
    findings.branch === "private_well" ||
    findings.branch === "stale" ||
    findings.branch === "cws_unmapped"
  ) {
    return null;
  }

  const card = findings.system_card;
  const lcr = findings.lead_copper_summary;

  type PillStatus = "ok" | "unavailable" | "not_uploaded";
  const pills: Array<{ label: string; status: PillStatus; note?: string }> = [
    {
      label: "EPA Envirofacts (WATER_SYSTEM)",
      status: card ? "ok" : "unavailable",
    },
    {
      label: "EPA SDWIS Violations",
      status:
        card?.compliance_status_short && card.compliance_status_short !== "unknown"
          ? "ok"
          : "unavailable",
      note:
        card?.compliance_status_short === "unknown"
          ? "Unavailable this run"
          : undefined,
    },
    {
      label: "EPA SDWIS Lead and Copper Samples",
      status:
        lcr?.status === "available"
          ? "ok"
          : lcr?.status === "no_samples_on_file"
            ? "ok"
            : "unavailable",
      note:
        lcr?.status === "no_samples_on_file"
          ? "No samples on file"
          : lcr?.status === "unavailable"
            ? "Unavailable this run"
            : undefined,
    },
    {
      label: "Consumer Confidence Report",
      status:
        card?.latest_ccr_status === "not_uploaded" ? "not_uploaded" : "ok",
      note:
        card?.latest_ccr_status === "not_uploaded" ? "Not yet uploaded" : undefined,
    },
  ];

  return (
    <section aria-labelledby="wqa-sources-heading">
      <div className="flex items-baseline justify-between gap-3 mb-2">
        <div id="wqa-sources-heading" className="eyebrow">
          Sources
        </div>
        <a
          href="/how-it-works#water-quality-awareness"
          target="_blank"
          rel="noopener noreferrer"
          className="text-small"
          style={{
            color: "var(--color-accent)",
            textDecoration: "underline",
            textUnderlineOffset: 3,
          }}
        >
          How Hearth reads these sources
        </a>
      </div>
      <ul className="flex flex-wrap gap-2">
        {pills.map((pill) => (
          <li key={pill.label}>
            <SourcePill {...pill} />
          </li>
        ))}
      </ul>
    </section>
  );
}

function SourcePill({
  label,
  status,
  note,
}: {
  label: string;
  status: "ok" | "unavailable" | "not_uploaded";
  note?: string;
}) {
  const icon =
    status === "ok"
      ? "circle-check"
      : status === "not_uploaded"
        ? "info"
        : "info";
  const color =
    status === "ok"
      ? "var(--color-accent)"
      : "var(--color-text-tertiary)";
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1"
      style={{
        border: "1px solid var(--color-border-subtle)",
        backgroundColor: "var(--color-bg-surface-raised)",
        fontSize: 12,
        color: "var(--color-text-secondary)",
      }}
    >
      <span aria-hidden style={{ color }}>
        <Icon name={icon as never} size={12} />
      </span>
      <span>{label}</span>
      {note ? (
        <span style={{ color: "var(--color-text-tertiary)" }}>· {note}</span>
      ) : null}
    </span>
  );
}

/**
 * Branch-only check helper, used by tests to verify the WQA module
 * never renders the body for branches it shouldn't (today: all
 * branches render something; the helper exists so a future change
 * here is enforced by a test rather than a comment).
 */
export function shouldRenderOverviewBody(branch: WqaBranch): boolean {
  return (
    branch === "cws_no_ccr" ||
    branch === "non_community" ||
    branch === "cws_with_ccr" ||
    branch === "cws_unmapped" ||
    branch === "private_well" ||
    branch === "stale"
  );
}
