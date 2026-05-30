// Dashboard "Lifecycle outlook" panel (issue #212). Server component that
// reads the active house's inventory, derives the top-three replacement
// horizons with the pure buildLifecycleOutlook helper, and renders them
// in the hero's right column beneath the facts cards.
//
// This is an AWARENESS surface, not a to-do surface: it answers "what
// expensive thing is quietly aging out?" — a question the homeowner
// doesn't know to ask — and never tells them to replace anything. It is
// deliberately distinct from the maintenance "On your plate" panel
// (recurring upkeep); the two must not be conflated. Read-only: no writes,
// no migration.
//
// The presentational markup is kept inline rather than extracted to
// components/dashboard/ — there's a single caller, and the project's
// rule is no extraction until there are two.

import Link from "next/link";
import { Icon } from "@/components/icon";
import { SectionHeader } from "@/components/ui";
import {
  buildLifecycleOutlook,
  type LifecycleOutlookEntry,
  type LifecycleSignal,
} from "@/lib/inventory/lifecycle-outlook";
import { createClient } from "@/lib/supabase/server";

// Below this many rankable items the panel shows the awareness nudge
// instead of a ranked list — a top-three needs enough signal to be worth
// ranking.
const MIN_RANKABLE = 2;

const SIGNAL_LABEL: Record<LifecycleSignal, string> = {
  past_life: "Past typical lifespan",
  approaching: "Approaching end of life",
  on_track: "On track",
};

type Tone = "danger" | "caution" | "neutral";

const SIGNAL_TONE: Record<LifecycleSignal, Tone> = {
  past_life: "danger",
  approaching: "caution",
  on_track: "neutral",
};

const TONE_COLOR: Record<Tone, string> = {
  danger: "var(--color-danger)",
  caution: "var(--color-warning)",
  neutral: "var(--color-text-tertiary)",
};

export async function LifecycleOutlookPanel({ houseId }: { houseId: string }) {
  const supabase = await createClient();

  // Active inventory for the house. RLS scopes the read to the owner. We
  // only need name + install date to rank; status is selected so the pure
  // helper's "active only" guard stays meaningful even though the query
  // already filters it.
  const { data, error } = await supabase
    .from("inventory")
    .select("id, name, installed_on, status")
    .eq("house_id", houseId)
    .eq("status", "active");

  if (error) {
    // Surface the failure rather than collapsing into a silent empty state
    // — as the app approaches real users, schema drift / RLS misconfig /
    // transient outages should be visible, not invisible.
    return (
      <PanelShell hideTrailingLink>
        <div
          className="surface p-5"
          style={{
            backgroundColor:
              "color-mix(in oklab, var(--color-danger) 10%, var(--color-bg-surface))",
          }}
        >
          <p
            className="text-small"
            style={{ color: "var(--color-text-secondary)" }}
          >
            We couldn&rsquo;t load your lifecycle outlook just now. Refresh in
            a moment — if it keeps happening, let us know.
          </p>
        </div>
      </PanelShell>
    );
  }

  const { entries, rankableCount, bigTicketCount } = buildLifecycleOutlook(
    data ?? [],
    new Date(),
  );

  if (rankableCount < MIN_RANKABLE) {
    return (
      <PanelShell hideTrailingLink>
        <NudgeCard bigTicketCount={bigTicketCount} rankableCount={rankableCount} />
      </PanelShell>
    );
  }

  return (
    <PanelShell>
      <div className="flex flex-col gap-2">
        {entries.map((entry) => (
          <OutlookRow key={entry.id} entry={entry} />
        ))}
      </div>
    </PanelShell>
  );
}

function PanelShell({
  children,
  hideTrailingLink,
}: {
  children: React.ReactNode;
  hideTrailingLink?: boolean;
}) {
  return (
    <section className="surface p-4 sm:p-5">
      <SectionHeader
        eyebrow="What's coming"
        title="Lifecycle outlook"
        trailing={
          hideTrailingLink ? undefined : (
            <Link
              href="/maintenance"
              className="inline-flex items-center gap-1 text-small"
              style={{ color: "var(--color-text-secondary)" }}
            >
              See the full timeline
              <Icon name="chevron-right" size={14} />
            </Link>
          )
        }
      />
      {children}
    </section>
  );
}

function OutlookRow({ entry }: { entry: LifecycleOutlookEntry }) {
  const tone = SIGNAL_TONE[entry.signal];
  const toneColor = TONE_COLOR[tone];
  return (
    <div
      className="flex items-center gap-3 rounded-md p-3"
      style={{
        backgroundColor: "var(--color-bg-surface-raised)",
        border: "1px solid var(--color-border-subtle)",
      }}
    >
      <span
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md"
        style={{
          backgroundColor: `color-mix(in oklab, ${toneColor} 14%, transparent)`,
          color: toneColor,
        }}
      >
        <Icon name="clock" size={18} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span
            className="truncate"
            style={{
              fontSize: 14,
              fontWeight: 500,
              color: "var(--color-text-primary)",
            }}
          >
            {entry.name}
          </span>
          <span
            className="text-small truncate"
            style={{ color: "var(--color-text-tertiary)" }}
          >
            {entry.label}
          </span>
        </div>
        <div
          className="text-small truncate"
          style={{ color: "var(--color-text-secondary)" }}
        >
          Installed {entry.installedYear} · ~{entry.typicalYears} yr typical
          life
        </div>
      </div>
      <span
        className="shrink-0 rounded-full px-2 py-0.5 text-center"
        style={{
          backgroundColor: `color-mix(in oklab, ${toneColor} 18%, transparent)`,
          color: toneColor,
          fontSize: 12,
          fontWeight: 500,
        }}
      >
        {SIGNAL_LABEL[entry.signal]}
      </span>
    </div>
  );
}

function NudgeCard({
  bigTicketCount,
  rankableCount,
}: {
  bigTicketCount: number;
  rankableCount: number;
}) {
  // Two framings of the same awareness prompt. When the user has tracked
  // big-ticket systems but hasn't dated them, nudge toward the dates;
  // otherwise nudge toward adding the systems in the first place.
  const needsDatesOnly = bigTicketCount > 0;
  return (
    <div
      className="surface p-5 flex flex-col gap-1"
      style={{
        borderStyle: "dashed",
        borderColor:
          "color-mix(in oklab, var(--color-border-subtle) 70%, transparent)",
      }}
    >
      {needsDatesOnly ? (
        <p
          className="text-small"
          style={{ color: "var(--color-text-secondary)" }}
        >
          {rankableCount > 0
            ? `${rankableCount} of ${bigTicketCount} big-ticket items have an install date. `
            : null}
          Add install dates to your roof, furnace, or water heater and Hearth
          will start tracking which big-ticket systems are quietly aging toward
          replacement.
        </p>
      ) : (
        <p
          className="text-small"
          style={{ color: "var(--color-text-secondary)" }}
        >
          Add your roof, furnace, or water heater and Hearth will start
          tracking what&rsquo;s coming — which big-ticket systems are quietly
          aging toward replacement, before they surprise you.
        </p>
      )}
    </div>
  );
}
