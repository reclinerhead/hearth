"use client";

import { useEffect, useState, useTransition } from "react";
import { useHouseRealtime } from "@/lib/hooks/use-house-realtime";
import { Icon, type IconName } from "@/components/icon";
import { AICard, MetricCard, PlaceholderImage } from "@/components/ui";
import { diffHouseFacts } from "@/lib/briefing/diff";
import type { MergeableHouseFacts } from "@/lib/briefing/merge";
import type { BriefingStatus, House } from "@/types/house";
import { refreshBriefing } from "./actions";

type RefreshSummary =
  | { kind: "updated"; fields: string[] }
  | { kind: "nothing_new" };

function snapshotFacts(house: House): MergeableHouseFacts {
  return {
    year_built: house.year_built,
    living_area_sqft: house.living_area_sqft,
    lot_size_sqft: house.lot_size_sqft,
    lot_size_acres: house.lot_size_acres,
    bedrooms: house.bedrooms,
    bathrooms: house.bathrooms,
    heating_summary: house.heating_summary,
    cooling_summary: house.cooling_summary,
    parcel_id: house.parcel_id,
    description: house.description,
    description_source: house.description_source,
  };
}

type HouseFact = {
  eyebrow: string;
  icon: IconName;
  value: string | null;
  meta?: string | null;
};

const EMPTY = "—";

function formatNumber(n: number): string {
  return n.toLocaleString("en-US");
}

function formatBuilt(year: number | null): HouseFact {
  if (year === null) return { eyebrow: "Built", icon: "calendar", value: null };
  const age = new Date().getFullYear() - year;
  return {
    eyebrow: "Built",
    icon: "calendar",
    value: String(year),
    meta: age > 0 ? `${age} years old` : undefined,
  };
}

function formatLivingArea(sqft: number | null): HouseFact {
  if (sqft === null)
    return { eyebrow: "Living area", icon: "ruler", value: null };
  return {
    eyebrow: "Living area",
    icon: "ruler",
    value: `${formatNumber(sqft)} sf`,
  };
}

function formatLot(sqft: number | null): HouseFact {
  if (sqft === null) return { eyebrow: "Lot", icon: "map-pin", value: null };
  // Surface acres alongside square feet once the lot crosses ~quarter-acre,
  // since that's the unit listings usually quote at that size.
  const acres = sqft / 43_560;
  if (acres >= 0.1) {
    return {
      eyebrow: "Lot",
      icon: "map-pin",
      value: `${acres.toFixed(2)} ac`,
      meta: `${formatNumber(sqft)} sf`,
    };
  }
  return {
    eyebrow: "Lot",
    icon: "map-pin",
    value: `${formatNumber(sqft)} sf`,
  };
}

function formatBedrooms(n: number | null): HouseFact {
  if (n === null) return { eyebrow: "Bedrooms", icon: "bed", value: null };
  return {
    eyebrow: "Bedrooms",
    icon: "bed",
    value: Number.isInteger(n) ? String(n) : n.toFixed(1),
  };
}

function formatBathrooms(n: number | null): HouseFact {
  if (n === null) return { eyebrow: "Bathrooms", icon: "bath", value: null };
  return {
    eyebrow: "Bathrooms",
    icon: "bath",
    value: Number.isInteger(n) ? String(n) : n.toFixed(1),
  };
}

function buildFacts(house: House): HouseFact[] {
  return [
    formatBuilt(house.year_built),
    formatLivingArea(house.living_area_sqft),
    formatLot(house.lot_size_sqft),
    formatBedrooms(house.bedrooms),
    formatBathrooms(house.bathrooms),
  ];
}

function HeroAddress({
  house,
  onRefresh,
  refreshing,
}: {
  house: House;
  onRefresh: () => void;
  refreshing: boolean;
}) {
  const display = house.nickname ?? house.address_line1;
  const region = `${house.city}, ${house.state}`;
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <div className="eyebrow">Your house</div>
        <h1 className="h1" style={{ marginTop: 4 }}>
          {display}
        </h1>
        <p
          className="text-small mt-1"
          style={{ color: "var(--color-text-secondary)" }}
        >
          {region}
        </p>
      </div>
      <RefreshBriefingButton
        onClick={onRefresh}
        refreshing={refreshing}
      />
    </div>
  );
}

/**
 * Re-runs the Day One Briefing on demand. Sonar's results are stochastic,
 * so a second run usually fills in fields the first run missed. The merge
 * step (lib/briefing/merge.ts) guarantees a null from a fresh run never
 * clobbers an existing non-null value, so re-rolling is always safe.
 */
function RefreshBriefingButton({
  onClick,
  refreshing,
}: {
  onClick: () => void;
  refreshing: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={refreshing}
      aria-label="Refresh house facts"
      title={refreshing ? "Refreshing house facts…" : "Refresh house facts"}
      className="btn btn-ghost shrink-0"
      style={{
        opacity: refreshing ? 0.75 : 1,
        cursor: refreshing ? "default" : "pointer",
      }}
    >
      <span
        aria-hidden
        className={refreshing ? "animate-spin" : undefined}
        style={{ display: "inline-flex" }}
      >
        <Icon name="refresh-cw" size={14} />
      </span>
      <span className="hidden sm:inline">
        {refreshing ? "Refreshing…" : "Refresh"}
      </span>
    </button>
  );
}

/**
 * Renders a metric value in one of three states depending on briefing
 * progress and whether we got a real value back:
 *  - running + no value: a small pulsing skeleton inline
 *  - completed + no value: an em-dash in tertiary text
 *  - any state with a value: render the value
 */
function FactValue({
  value,
  status,
}: {
  value: string | null;
  status: BriefingStatus;
}) {
  if (value !== null) return <span>{value}</span>;
  if (status === "running" || status === "pending") {
    return (
      <span
        aria-label="Discovering"
        className="inline-block animate-pulse rounded-sm align-middle"
        style={{
          width: "3.5rem",
          height: "1em",
          backgroundColor: "var(--color-bg-surface-raised)",
        }}
      />
    );
  }
  return (
    <span style={{ color: "var(--color-text-tertiary)" }}>{EMPTY}</span>
  );
}

function FactMeta({
  meta,
  hasValue,
  status,
}: {
  meta: string | null | undefined;
  hasValue: boolean;
  status: BriefingStatus;
}) {
  if (meta) return <>{meta}</>;
  if (!hasValue && status === "completed") return <>Not found</>;
  return null;
}

/**
 * Summarizes the result of a manual refresh. Uses the surface-ai treatment
 * so it visually reads as an AI-driven update, matching the AICard pattern
 * used elsewhere for assistant output.
 */
function RefreshSummaryBanner({
  summary,
  onDismiss,
}: {
  summary: RefreshSummary;
  onDismiss: () => void;
}) {
  const isUpdated = summary.kind === "updated";
  const title = isUpdated
    ? `Refresh found ${summary.fields.length} new ${
        summary.fields.length === 1 ? "fact" : "facts"
      } about your house.`
    : "We couldn't find anything new — your house facts are up to date.";

  return (
    <div
      className="surface-ai flex items-start gap-3 p-3 sm:p-4"
      style={{ borderRadius: "var(--radius-lg)" }}
      role="status"
    >
      <span
        aria-hidden
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md"
        style={{
          backgroundColor:
            "color-mix(in oklab, var(--color-accent) 16%, transparent)",
          color: "var(--color-accent)",
        }}
      >
        <Icon name={isUpdated ? "sparkles" : "circle-check"} size={16} />
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
        {isUpdated ? (
          <div
            className="text-small mt-0.5"
            style={{ color: "var(--color-text-secondary)" }}
          >
            {summary.fields.join(" · ")}
          </div>
        ) : null}
      </div>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss"
        className="btn btn-ghost btn-icon shrink-0"
      >
        <Icon name="x" size={14} />
      </button>
    </div>
  );
}

function BriefingErrorBanner({ message }: { message: string | null }) {
  return (
    <div
      className="surface flex items-start gap-3 p-3 sm:p-4"
      style={{
        backgroundColor:
          "color-mix(in oklab, var(--color-danger) 10%, var(--color-bg-surface))",
        borderColor:
          "color-mix(in oklab, var(--color-danger) 28%, var(--color-border-subtle))",
      }}
    >
      <span
        aria-hidden
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md"
        style={{
          backgroundColor:
            "color-mix(in oklab, var(--color-danger) 16%, transparent)",
          color: "var(--color-danger)",
        }}
      >
        <Icon name="alert-triangle" size={16} />
      </span>
      <div className="min-w-0 flex-1">
        <div
          style={{
            fontSize: 14,
            fontWeight: 500,
            color: "var(--color-text-primary)",
          }}
        >
          We had trouble pulling all the public data for your house.
        </div>
        <div
          className="text-small mt-0.5"
          style={{ color: "var(--color-text-tertiary)" }}
        >
          Use Refresh above to try again.
          {message ? (
            <>
              {" "}
              <span title={message}>{message}</span>
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}

export function DashboardLive({ houseId }: { houseId: string }) {
  const { house, loading, error } = useHouseRealtime(houseId);
  const [isPending, startTransition] = useTransition();
  const [refreshError, setRefreshError] = useState<string | null>(null);
  // Snapshot of the row at click time, kept until the workflow reaches a
  // terminal state so we can diff before vs after and tell the user what
  // the refresh actually changed. We also capture briefing_generated_at
  // so we can tell "the workflow has actually completed a new run" apart
  // from "briefing_status is still 'completed' from the previous run."
  // Without that guard the effect below would fire immediately on click.
  const [pendingRefresh, setPendingRefresh] = useState<{
    snapshot: MergeableHouseFacts;
    generatedAt: string | null;
  } | null>(null);
  const [summary, setSummary] = useState<RefreshSummary | null>(null);

  // Refresh is "in flight" if either (a) the server action hasn't returned
  // yet, or (b) the workflow has flipped briefing_status to running/pending
  // and the realtime row hasn't yet flipped back to a terminal state. Both
  // signals keep the button disabled so a second click can't double-start
  // the workflow.
  const briefingInFlight =
    house?.briefing_status === "running" ||
    house?.briefing_status === "pending";
  const refreshing = isPending || briefingInFlight;

  function handleRefresh() {
    if (!house) return;
    setRefreshError(null);
    setSummary(null);
    setPendingRefresh({
      snapshot: snapshotFacts(house),
      generatedAt: house.briefing_generated_at,
    });
    startTransition(async () => {
      const result = await refreshBriefing(houseId);
      if (!result.ok) {
        setRefreshError(result.error);
        // The workflow never started, so there's nothing to diff against.
        setPendingRefresh(null);
      }
    });
  }

  // Watch for the workflow reaching a terminal state. On 'completed', diff
  // the snapshot we captured at click time against the current row and
  // surface a summary — but only when briefing_generated_at has actually
  // moved forward, so the click itself doesn't fire the summary against
  // the still-stale 'completed' from the previous run. On 'failed', drop
  // the snapshot — the failed banner already covers the error case.
  useEffect(() => {
    if (!house || !pendingRefresh) return;
    if (house.briefing_status === "completed") {
      if (house.briefing_generated_at === pendingRefresh.generatedAt) return;
      const changes = diffHouseFacts(
        pendingRefresh.snapshot,
        snapshotFacts(house),
      );
      setSummary(
        changes.length > 0
          ? { kind: "updated", fields: changes }
          : { kind: "nothing_new" },
      );
      setPendingRefresh(null);
    } else if (house.briefing_status === "failed") {
      setPendingRefresh(null);
    }
  }, [house, pendingRefresh]);

  if (loading) {
    return (
      <div className="surface p-6">
        <div className="eyebrow mb-2">Loading your house</div>
        <div
          className="text-small"
          style={{ color: "var(--color-text-secondary)" }}
        >
          One moment…
        </div>
      </div>
    );
  }

  if (error || !house) {
    return (
      <div
        className="surface p-6"
        style={{
          backgroundColor:
            "color-mix(in oklab, var(--color-danger) 12%, var(--color-bg-surface))",
        }}
      >
        <div className="eyebrow mb-2">Couldn&apos;t load your house</div>
        <div
          className="text-small"
          style={{ color: "var(--color-text-secondary)" }}
        >
          {error ?? "House not found."}
        </div>
      </div>
    );
  }

  const facts = buildFacts(house);
  const status = house.briefing_status;
  const heroLabel = house.nickname ?? house.address_line1;

  return (
    <section className="grid gap-4 md:grid-cols-2">
      <div className="surface overflow-hidden">
        <PlaceholderImage ratio="4 / 3" label={heroLabel} icon="home" />
      </div>
      <div className="flex flex-col gap-3">
        {summary ? (
          <RefreshSummaryBanner
            summary={summary}
            onDismiss={() => setSummary(null)}
          />
        ) : null}

        <HeroAddress
          house={house}
          onRefresh={handleRefresh}
          refreshing={refreshing}
        />

        {status === "failed" ? (
          <BriefingErrorBanner message={house.briefing_error} />
        ) : null}

        {refreshError ? (
          <div
            className="text-small"
            style={{ color: "var(--color-danger)" }}
            role="status"
          >
            {refreshError}
          </div>
        ) : null}

        <div className="grid gap-2 sm:gap-3 grid-cols-2 sm:grid-cols-3">
          {facts.map((f) => (
            <MetricCard
              key={f.eyebrow}
              eyebrow={f.eyebrow}
              icon={f.icon}
              value={<FactValue value={f.value} status={status} />}
              meta={
                <FactMeta
                  meta={f.meta}
                  hasValue={f.value !== null}
                  status={status}
                />
              }
            />
          ))}
        </div>

        {house.description ? (
          <AICard eyebrow="About your house">
            {house.description}
          </AICard>
        ) : status === "running" || status === "pending" ? (
          <div
            className="surface p-4 text-small flex items-center gap-2"
            style={{ color: "var(--color-text-tertiary)" }}
          >
            <span className="inline-block h-2 w-2 animate-pulse rounded-full" style={{ backgroundColor: "var(--color-accent)" }} />
            Discovering details about your house…
          </div>
        ) : null}
      </div>
    </section>
  );
}
