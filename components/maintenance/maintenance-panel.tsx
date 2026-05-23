"use client";

// Shared "On your plate" maintenance panel (issue #133). Renders on the
// dashboard (house-scoped) and the inventory detail page (item-scoped) —
// the data wrapper picks the query, this component picks the look.
//
// Visual hierarchy is doing real work:
//   - Overdue: colored left rail + accent badge, loudest so the user
//     notices real-consequence items (expired registration, way-overdue
//     filter) before anything else.
//   - Next 30 days: calm surface cards with a date pill on the right.
//     "You should know about these."
//   - Later this season: transparent rows with reduced contrast. Aware,
//     not actionable. (House scope: capped to next-30 days, so this tier
//     never appears — the dashboard is a "what's on plate now" surface
//     and the full timeline lives at /maintenance.)
//   - Every time you use it: per-use practices (issue #135). Same
//     visual treatment as Later this season (neutral tone, transparent
//     rows) but with the right-side date label suppressed since there
//     is no meaningful due-date for these. Item-scope only; the
//     dashboard wrapper filters per-use out at the query level since
//     the dashboard is a date-anchored panel.
// The Good Steward footer beneath everything turns the panel from a nag
// into a daily-positive moment whenever the user has completed any tasks.

import Link from "next/link";
import type { ReactNode } from "react";
import { Icon } from "@/components/icon";
import { SectionHeader } from "@/components/ui";
import {
  groupTasksByTier,
  type TierableTask,
} from "@/lib/maintenance/tier-grouping";
import { GoodStewardFooter } from "./good-steward-footer";
import {
  MaintenanceTaskRow,
  type MaintenanceTaskRowData,
  type RightLabelMode,
  type RowTone,
} from "./maintenance-task-row";

export type MaintenancePanelTask = MaintenanceTaskRowData & TierableTask;

export type ItemEmptyState =
  | { kind: "no_plan_yet"; inventoryId: string }
  | { kind: "needs_research" }
  /**
   * Property items (vehicles, pets, generic property) don't have a
   * Research / synthesis pipeline — their maintenance comes from
   * documents the user uploads (registration cards, insurance policies,
   * vet records) that carry an expiration date. The empty state points
   * the user at the "Add document" button instead of Research. Copy
   * branches on the property subtype so vehicles can call out
   * registration / insurance by name while pets and other property get
   * the right framing.
   */
  | { kind: "property_no_documents"; propertyKind: "vehicle" | "pet" | "other_property" };

export type MaintenancePanelProps = {
  scope: "house" | "item";
  tasks: MaintenancePanelTask[];
  completedThisYear: number;
  mostRecentCompletion: { title: string; completed_at: string } | null;
  /** Required when scope === "item"; tells the empty state which CTA to render. */
  itemEmptyState?: ItemEmptyState;
};

export function MaintenancePanel({
  scope,
  tasks,
  completedThisYear,
  mostRecentCompletion,
  itemEmptyState,
}: MaintenancePanelProps) {
  // Partition per-use rows out of the date-anchored set before tier
  // grouping (issue #135). Per-use placeholders have a real next_due_at
  // value, so without this split they would fall into the next30 / later
  // buckets and read as scheduled. The dashboard wrapper filters them
  // out at the query level, so this split is only meaningful in item
  // scope today — but it's cheap and keeps the panel honest if a future
  // surface ever passes per-use rows through.
  const perUse = tasks
    .filter((t) => t.cadence_kind === "per_use")
    .sort((a, b) =>
      a.title.localeCompare(b.title, undefined, { sensitivity: "base" }),
    );
  const scheduled = tasks.filter((t) => t.cadence_kind !== "per_use");

  // Grouping runs on the client so the boundary updates if the user
  // leaves the tab open past midnight without re-fetching. The helper
  // is pure, so this is cheap to recompute on every render.
  const { overdue, next30, later } = groupTasksByTier(scheduled, new Date());

  const totalOpen = tasks.length;
  const overdueCount = overdue.length;
  const hasAnyTasks = totalOpen > 0 || completedThisYear > 0;

  if (totalOpen === 0 && scope === "item") {
    return <ItemEmptyStateBlock state={itemEmptyState} />;
  }

  if (totalOpen === 0 && scope === "house") {
    return <HouseEmptyState completedThisYear={completedThisYear} />;
  }

  const sectionTitle = scope === "item" ? "Maintenance for this item" : "Maintenance";

  return (
    <div className="flex flex-col gap-4">
      <SectionHeader
        eyebrow="On your plate"
        title={sectionTitle}
        trailing={
          <div className="flex items-center gap-3 text-small">
            {overdueCount > 0 ? (
              <span
                className="px-2 py-0.5 rounded-full"
                style={{
                  backgroundColor:
                    "color-mix(in oklab, var(--color-danger) 18%, transparent)",
                  color: "var(--color-danger)",
                  fontSize: 12,
                  fontWeight: 500,
                }}
              >
                {overdueCount} overdue
              </span>
            ) : null}
            {scope === "house" ? (
              // The dashboard query caps at next-30 days, so "N total"
              // here would misrepresent the broader open list. View all
              // is the affordance to see everything; the destination
              // page owns the timeframe controls.
              <Link
                href="/maintenance"
                className="inline-flex items-center gap-1"
                style={{ color: "var(--color-text-secondary)" }}
              >
                View all
                <Icon name="chevron-right" size={14} />
              </Link>
            ) : (
              <span style={{ color: "var(--color-text-tertiary)" }}>
                {totalOpen} total
              </span>
            )}
          </div>
        }
      />

      <div className="flex flex-col gap-4">
        {overdue.length > 0 ? (
          <TierSection
            label="Overdue · Take action"
            tone="danger"
            tasks={overdue}
            relativeMode="overdue"
          />
        ) : null}

        {next30.length > 0 ? (
          <TierSection
            label="Coming up · Next 30 days"
            tone="caution"
            tasks={next30}
            relativeMode="date_pill"
          />
        ) : null}

        {later.length > 0 ? (
          <TierSection
            label="Later this season"
            tone="neutral"
            tasks={later}
            relativeMode="relative_time"
          />
        ) : null}

        {perUse.length > 0 ? (
          <TierSection
            label="Every time you use it"
            tone="neutral"
            tasks={perUse}
            relativeMode="none"
          />
        ) : null}
      </div>

      {hasAnyTasks ? (
        <GoodStewardFooter
          completedThisYear={completedThisYear}
          mostRecent={mostRecentCompletion}
        />
      ) : null}
    </div>
  );
}

function TierSection({
  label,
  tone,
  tasks,
  relativeMode,
}: {
  label: string;
  tone: RowTone;
  tasks: MaintenancePanelTask[];
  relativeMode: RightLabelMode;
}) {
  const dividerColor =
    tone === "danger"
      ? "var(--color-danger)"
      : tone === "caution"
        ? "var(--color-warning)"
        : "var(--color-text-tertiary)";
  return (
    <div className="flex flex-col gap-2">
      <div
        className="flex items-center gap-2"
        style={{ color: dividerColor }}
      >
        <span
          aria-hidden
          style={{
            flex: 1,
            height: 1,
            backgroundColor:
              "color-mix(in oklab, currentColor 30%, transparent)",
          }}
        />
        <span
          className="eyebrow"
          style={{ color: "inherit", whiteSpace: "nowrap" }}
        >
          {label}
        </span>
        <span
          aria-hidden
          style={{
            flex: 1,
            height: 1,
            backgroundColor:
              "color-mix(in oklab, currentColor 30%, transparent)",
          }}
        />
      </div>
      <div className="flex flex-col gap-2">
        {tasks.map((t) => (
          <MaintenanceTaskRow
            key={t.id}
            task={t}
            tone={tone}
            relativeMode={relativeMode}
          />
        ))}
      </div>
    </div>
  );
}

function HouseEmptyState({
  completedThisYear,
}: {
  completedThisYear: number;
}) {
  return (
    <div className="flex flex-col gap-4">
      <SectionHeader eyebrow="On your plate" title="Maintenance" />
      <div className="surface p-5 flex flex-col gap-2">
        <p
          className="text-small"
          style={{ color: "var(--color-text-secondary)" }}
        >
          Nothing on your plate yet. Open an appliance or system in your
          inventory and tap{" "}
          <span
            style={{ color: "var(--color-text-primary)", fontWeight: 500 }}
          >
            Build maintenance plan
          </span>
          {" "}— Hearth will build a personalized schedule based on what we
          know about your equipment and the area around your home.
        </p>
        {completedThisYear > 0 ? (
          <p
            className="text-small"
            style={{ color: "var(--color-text-tertiary)", marginTop: 4 }}
          >
            You&rsquo;ve completed {completedThisYear} task
            {completedThisYear === 1 ? "" : "s"} this year. Nice work.
          </p>
        ) : null}
      </div>
    </div>
  );
}

function ItemEmptyStateBlock({ state }: { state: ItemEmptyState | undefined }) {
  if (!state || state.kind === "needs_research") {
    return (
      <EmptyStateShell>
        <p
          className="text-small"
          style={{ color: "var(--color-text-secondary)" }}
        >
          Run Research on this item first. Once Hearth knows what kind of
          equipment this is, you can build a maintenance plan tuned to it.
        </p>
      </EmptyStateShell>
    );
  }

  if (state.kind === "property_no_documents") {
    // Property items don't have a Research / synthesis pipeline — their
    // maintenance comes from documents with expiration dates. Point the
    // user at the "Add document" button above instead of Build / Research.
    return (
      <EmptyStateShell>
        {state.propertyKind === "vehicle" ? (
          <p
            className="text-small"
            style={{ color: "var(--color-text-secondary)" }}
          >
            Vehicle maintenance lives in your documents. Tap{" "}
            <span
              style={{ color: "var(--color-text-primary)", fontWeight: 500 }}
            >
              Add document
            </span>{" "}
            above to upload your registration card or insurance policy —
            Hearth will pull the renewal date and remind you before it
            lapses.
          </p>
        ) : state.propertyKind === "pet" ? (
          <p
            className="text-small"
            style={{ color: "var(--color-text-secondary)" }}
          >
            Pet records live in your documents. Tap{" "}
            <span
              style={{ color: "var(--color-text-primary)", fontWeight: 500 }}
            >
              Add document
            </span>{" "}
            above to upload vet records or license renewals — Hearth will
            track any expiration dates we find.
          </p>
        ) : (
          <p
            className="text-small"
            style={{ color: "var(--color-text-secondary)" }}
          >
            Maintenance for property items is driven by your documents.
            Tap{" "}
            <span
              style={{ color: "var(--color-text-primary)", fontWeight: 500 }}
            >
              Add document
            </span>{" "}
            above to upload a receipt with a renewal or expiration date and
            Hearth will keep an eye on it for you.
          </p>
        )}
      </EmptyStateShell>
    );
  }

  // no_plan_yet — point at the Build button in the title row rather than
  // duplicating it inline. The view's button is the single source of
  // truth for the action; this empty state just makes the panel a clear
  // call to action so the user notices it.
  return (
    <EmptyStateShell>
      <p
        className="text-small"
        style={{ color: "var(--color-text-secondary)" }}
      >
        No maintenance plan yet for this item. Build one based on what we
        know about your equipment and the area around your home.
      </p>
      <p
        className="text-small"
        style={{ color: "var(--color-text-tertiary)" }}
      >
        Tap{" "}
        <span style={{ color: "var(--color-text-primary)", fontWeight: 500 }}>
          Build maintenance plan
        </span>{" "}
        above to get started.
      </p>
    </EmptyStateShell>
  );
}

function EmptyStateShell({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-col gap-4">
      <SectionHeader
        eyebrow="On your plate"
        title="Maintenance for this item"
      />
      <div className="surface p-5 flex flex-col gap-3">{children}</div>
    </div>
  );
}
