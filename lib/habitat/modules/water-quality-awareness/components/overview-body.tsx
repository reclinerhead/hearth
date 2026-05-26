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
 *      tier cues; WQA-3 will expand this with CCR contaminants)
 *   5. Sources block (status pills for each of the four data sources)
 *
 * Pure read off the persisted finding — no hooks, no fetches. The
 * activity log section ("How we got here") is owned by the modal
 * shell, not this component.
 */

import { Icon } from "@/components/icon";
import { findWqaContaminantByAlias } from "@/lib/habitat/water-quality/contaminants/lookup";
import type { HabitatFindingRow } from "@/lib/hooks/use-habitat-findings";
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

export function WqaOverviewBody({ row }: { row: HabitatFindingRow }) {
  const f = (row.findings ?? null) as WqaFindings | null;
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

  return (
    <div className="flex flex-col gap-6">
      <BranchHeaderStrip findings={f} />
      <SystemCard findings={f} />
      <RecommendedActionsSection findings={f} />
      <DetectedInWater findings={f} />
      <SourcesBlock findings={f} />
    </div>
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
function BranchHeaderStrip({ findings }: { findings: WqaFindings }) {
  const branch = findings.branch;
  const card = findings.system_card;
  const confidence = card?.pwsid_confidence;

  if (branch === "cws_no_ccr" && confidence === "inferred") {
    return (
      <InferredHeader pwsName={card?.pws_name ?? "your water utility"} />
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
  // cws_no_ccr verified, cws_with_ccr — no strip (the system card below
  // carries the framing on its own).
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

function InferredHeader({ pwsName }: { pwsName: string }) {
  // The confirm / correct affordance is visual only in this issue. The
  // buttons render disabled with a hover tooltip explaining that the
  // wiring lands in a follow-up. See open questions on #171.
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
        <div className="flex flex-wrap gap-2">
          <DisabledPlaceholderButton
            label="Yes, that&rsquo;s right"
            note="Confirmation is coming in a follow-up"
          />
          <DisabledPlaceholderButton
            label="No, my utility is different"
            note="Manual correction is coming in a follow-up"
          />
        </div>
      }
    />
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

function SystemCard({ findings }: { findings: WqaFindings }) {
  const card = findings.system_card;
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

  const complianceLabel = (() => {
    if (card.compliance_status_short === "active_violations") {
      const recent = card.recent_violations;
      const contaminant = recent?.most_recent?.contaminant_name;
      return contaminant
        ? `Active violation: ${contaminant}`
        : "Active violation on file";
    }
    if (card.compliance_status_short === "no_active_violations") {
      return "No active violations";
    }
    return "Not yet checked";
  })();

  const ccrLabel = (() => {
    if (card.latest_ccr_status === "not_uploaded") {
      return "Not yet uploaded";
    }
    return `${card.latest_ccr_status.year} report on file`;
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
      <div
        className="mono text-small"
        style={{ color: "var(--color-text-tertiary)", marginBottom: 12 }}
      >
        PWSID {card.pwsid}
      </div>

      <div
        className="grid gap-3"
        style={{
          gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
          marginBottom: 12,
        }}
      >
        <StatTile label="Compliance" value={complianceLabel} />
        <StatTile label="Latest CCR" value={ccrLabel} />
        <StatTile label="Source" value={sourceLabel} />
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

function StatTile({ label, value }: { label: string; value: string }) {
  return (
    <div
      className="rounded-md p-3"
      style={{
        border: "1px solid var(--color-border-subtle)",
        backgroundColor: "var(--color-bg-base)",
      }}
    >
      <div
        className="eyebrow"
        style={{ marginBottom: 4 }}
      >
        {label}
      </div>
      <div
        style={{
          fontSize: 14,
          fontWeight: 500,
          color: "var(--color-text-primary)",
        }}
      >
        {value}
      </div>
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

  // Suppress section entirely on branches that have no contaminant
  // data and no actionable empty-state copy to offer.
  if (findings.branch === "private_well" || findings.branch === "stale") {
    return null;
  }
  if (findings.branch === "cws_unmapped") {
    return null;
  }

  return (
    <section aria-labelledby="wqa-detected-heading">
      <div id="wqa-detected-heading" className="eyebrow mb-2">
        Detected in your water
      </div>
      {!lcr || lcr.status === "unavailable" ? (
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
      <div id="wqa-sources-heading" className="eyebrow mb-2">
        Sources
      </div>
      <ul className="flex flex-wrap gap-2">
        {pills.map((pill) => (
          <li key={pill.label}>
            <SourcePill {...pill} />
          </li>
        ))}
      </ul>
      <p
        className="text-small mt-3"
        style={{ color: "var(--color-text-tertiary)" }}
      >
        <a
          href="/how-it-works#water-quality-awareness"
          style={{ color: "var(--color-text-secondary)" }}
        >
          How Hearth reads these sources
        </a>
      </p>
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
