"use client";

// The seeing surface (issue #137). Header context, due-date pill or
// per-use indicator, the "Why this task" expand that finally renders
// the per-task reasoning every prior phase invested in, linked
// artifacts (inventory item, anchor document thumbnail), the prior-
// occurrences chain, and the context-aware primary CTA.
//
// The modal owns the data fetch instead of receiving the full payload
// through props — the panel rows only carry the subset needed for
// rendering, and most opens are read-only ("what is this task?"). The
// extra round trip is the right trade-off.
//
// The primary CTA opens a sub-sheet: MarkRenewedSheet for renewals,
// MarkCompletedSheet for everything else. The detail modal stays
// mounted underneath; saving closes both via onSaved → onClose,
// cancelling returns the user to the detail modal.

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/icon";
import { useCachedSignedUrl } from "@/lib/house-image/use-cached-signed-url";
import { createClient } from "@/lib/supabase/client";
import type { RenewalTermOption } from "@/lib/maintenance/renewal-terms";
import type { TaskReasoning } from "@/lib/maintenance/types";
import { MaintenanceModalShell } from "./maintenance-modal-shell";
import { MarkCompletedSheet } from "./mark-completed-sheet";
import { MarkRenewedSheet } from "./mark-renewed-sheet";
import { TaskHistoryList } from "./task-history-list";
import { WhyThisTaskExpand } from "./why-this-task-expand";

type TaskKind = "renewal" | "service" | "inspection" | "consumable" | "seasonal";
type CadenceKind = "interval" | "seasonal" | "one_time" | "per_use" | null;

export type LoadedTask = {
  id: string;
  house_id: string;
  inventory_id: string | null;
  source: "direct_event" | "synthesis";
  kind: TaskKind;
  title: string;
  subtitle: string | null;
  next_due_at: string;
  status: "open" | "completed" | "superseded";
  cadence_kind: CadenceKind;
  cadence_interval_months: number | null;
  cadence_seasonal_anchor: string | null;
  renewal_options: RenewalTermOption[] | null;
  renewal_url: string | null;
  reasoning: TaskReasoning;
  predecessor_task_id: string | null;
  completed_at: string | null;
  inventory_name: string | null;
  inventory_room: string | null;
  anchor_document: {
    id: string;
    thumbnail_path: string;
    vendor_name: string | null;
    transaction_date: string | null;
  } | null;
};

const COMPLETION_CTA_LABEL: Record<TaskKind, string> = {
  renewal: "Mark renewed",
  service: "Mark serviced",
  inspection: "Mark inspected",
  consumable: "Mark refilled",
  seasonal: "Mark done",
};

const KIND_EYEBROW: Record<TaskKind, string> = {
  renewal: "Renewal",
  service: "Service",
  inspection: "Inspection",
  consumable: "Consumable",
  seasonal: "Seasonal",
};

export function MaintenanceTaskModal({
  taskId,
  onClose,
  getReturnFocusElement,
}: {
  taskId: string;
  onClose: () => void;
  getReturnFocusElement?: () => HTMLElement | null;
}) {
  const router = useRouter();
  const [task, setTask] = useState<LoadedTask | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [completionSheet, setCompletionSheet] = useState<
    "renewed" | "completed" | null
  >(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("maintenance_tasks")
        .select(
          `
            id, house_id, inventory_id, source, kind, title, subtitle,
            next_due_at, status, cadence_kind, cadence_interval_months,
            cadence_seasonal_anchor, renewal_options, renewal_url,
            reasoning, predecessor_task_id, completed_at,
            inventory:inventory(id, name, room:rooms(name))
          `,
        )
        .eq("id", taskId)
        .maybeSingle();

      if (cancelled) return;
      if (error || !data) {
        setLoadError(error?.message ?? "Couldn't load this task.");
        return;
      }

      const reasoning = (data.reasoning ?? {
        source_kind: "class_default",
        cadence_basis: "",
        modifiers: [],
        anchor: {
          kind: "synthesis_default",
          detail: "",
          document_id: null,
        },
      }) as TaskReasoning;

      const anchorDocId = reasoning.anchor?.document_id ?? null;
      let anchorDoc: LoadedTask["anchor_document"] = null;
      if (anchorDocId) {
        const { data: doc } = await supabase
          .from("documents")
          .select("id, thumbnail_path, metadata")
          .eq("id", anchorDocId)
          .maybeSingle();
        if (cancelled) return;
        if (doc && doc.thumbnail_path) {
          const m = (doc.metadata ?? {}) as Record<string, unknown>;
          anchorDoc = {
            id: doc.id as string,
            thumbnail_path: doc.thumbnail_path as string,
            vendor_name:
              typeof m.vendor_name === "string"
                ? (m.vendor_name as string)
                : null,
            transaction_date:
              typeof m.transaction_date === "string"
                ? (m.transaction_date as string)
                : null,
          };
        }
      }

      // The PostgREST FK alias `inventory:inventory(...)` returns either
      // an object or an array of one depending on the join cardinality —
      // strip the array shape so the modal can read fields uniformly.
      const invJoin = Array.isArray(data.inventory)
        ? data.inventory[0]
        : data.inventory;
      const roomJoin = invJoin
        ? Array.isArray(invJoin.room)
          ? invJoin.room[0]
          : invJoin.room
        : null;

      const loaded: LoadedTask = {
        id: data.id as string,
        house_id: data.house_id as string,
        inventory_id: (data.inventory_id as string | null) ?? null,
        source: data.source as LoadedTask["source"],
        kind: data.kind as TaskKind,
        title: data.title as string,
        subtitle: (data.subtitle as string | null) ?? null,
        next_due_at: data.next_due_at as string,
        status: data.status as LoadedTask["status"],
        cadence_kind: (data.cadence_kind as CadenceKind) ?? null,
        cadence_interval_months:
          (data.cadence_interval_months as number | null) ?? null,
        cadence_seasonal_anchor:
          (data.cadence_seasonal_anchor as string | null) ?? null,
        renewal_options:
          (data.renewal_options as RenewalTermOption[] | null) ?? null,
        renewal_url: (data.renewal_url as string | null) ?? null,
        reasoning,
        predecessor_task_id:
          (data.predecessor_task_id as string | null) ?? null,
        completed_at: (data.completed_at as string | null) ?? null,
        inventory_name: (invJoin?.name as string | undefined) ?? null,
        inventory_room: (roomJoin?.name as string | undefined) ?? null,
        anchor_document: anchorDoc,
      };
      setTask(loaded);
    })();
    return () => {
      cancelled = true;
    };
  }, [taskId]);

  function handleSavedCompletion() {
    setCompletionSheet(null);
    // The complete-task action revalidates the dashboard + inventory
    // pages, but the panel rendering on a client navigation needs the
    // router refresh to pick up the new data when the user is already
    // sitting on /dashboard.
    router.refresh();
    onClose();
  }

  if (loadError) {
    return (
      <MaintenanceModalShell
        title="Couldn't load this task"
        onClose={onClose}
        getReturnFocusElement={getReturnFocusElement}
      >
        <p
          className="text-small"
          style={{ color: "var(--color-text-secondary)" }}
        >
          {loadError}
        </p>
      </MaintenanceModalShell>
    );
  }

  if (!task) {
    return (
      <MaintenanceModalShell
        title="Loading…"
        onClose={onClose}
        getReturnFocusElement={getReturnFocusElement}
      >
        <div style={{ height: 240 }} />
      </MaintenanceModalShell>
    );
  }

  const isPerUse = task.cadence_kind === "per_use";
  const isCompleted = task.status === "completed";

  return (
    <>
      <MaintenanceModalShell
        title={task.title}
        eyebrow={KIND_EYEBROW[task.kind]}
        onClose={onClose}
        getReturnFocusElement={getReturnFocusElement}
      >
        <ModalHeaderContext task={task} isPerUse={isPerUse} />

        <WhyThisTaskExpand
          reasoning={task.reasoning}
          cadenceKind={task.cadence_kind}
          cadenceIntervalMonths={task.cadence_interval_months}
          cadenceSeasonalAnchor={task.cadence_seasonal_anchor}
          variant={isPerUse ? "practice" : "task"}
        />

        <LinkedArtifacts task={task} />

        {!isPerUse ? <TaskHistoryList currentTaskId={task.id} /> : null}

        {!isPerUse && !isCompleted ? (
          <ModalPrimaryCTA
            task={task}
            onOpenSheet={(kind) => setCompletionSheet(kind)}
          />
        ) : null}
      </MaintenanceModalShell>

      {completionSheet === "renewed" ? (
        <MarkRenewedSheet
          task={{
            id: task.id,
            title: task.title,
            subtitle: task.subtitle,
            renewal_options: task.renewal_options,
          }}
          onSaved={handleSavedCompletion}
          onCancel={() => setCompletionSheet(null)}
        />
      ) : null}
      {completionSheet === "completed" ? (
        <MarkCompletedSheet
          task={{
            id: task.id,
            kind: task.kind,
            title: task.title,
          }}
          onSaved={handleSavedCompletion}
          onCancel={() => setCompletionSheet(null)}
        />
      ) : null}
    </>
  );
}

function ModalHeaderContext({
  task,
  isPerUse,
}: {
  task: LoadedTask;
  isPerUse: boolean;
}) {
  if (isPerUse) {
    return (
      <TaskInstructionsCallout
        text={task.subtitle ?? "Every time you use it."}
      />
    );
  }

  const due = parseDateOnly(task.next_due_at);
  const isCompleted = task.status === "completed";
  const dueLabel = due
    ? due.toLocaleDateString("en-US", {
        weekday: "short",
        month: "short",
        day: "numeric",
        year: "numeric",
        timeZone: "UTC",
      })
    : task.next_due_at;

  const today = normalizeToDateOnly(new Date());
  const lateDays = due
    ? Math.round((today.getTime() - due.getTime()) / (1000 * 60 * 60 * 24))
    : 0;
  const overdue = !isCompleted && due ? lateDays > 0 : false;

  return (
    <div className="flex flex-col gap-3">
      {task.subtitle ? <TaskInstructionsCallout text={task.subtitle} /> : null}
      <div className="flex items-center gap-2 flex-wrap">
        <div
          className="text-small inline-flex items-center gap-1.5 px-2 py-1 rounded-md"
          style={{
            backgroundColor: overdue
              ? "color-mix(in oklab, var(--color-danger) 14%, transparent)"
              : isCompleted
                ? "color-mix(in oklab, var(--color-success, var(--color-accent)) 14%, transparent)"
                : "var(--color-bg-surface)",
            color: overdue
              ? "var(--color-danger)"
              : isCompleted
                ? "var(--color-text-secondary)"
                : "var(--color-text-primary)",
            border: overdue
              ? "1px solid color-mix(in oklab, var(--color-danger) 30%, transparent)"
              : "1px solid var(--color-border-subtle)",
            fontWeight: 500,
          }}
        >
          <Icon name="calendar" size={14} />
          {isCompleted ? `Was due ${dueLabel}` : `Due ${dueLabel}`}
        </div>
        {overdue ? (
          <span
            className="text-small"
            style={{ color: "var(--color-text-tertiary)" }}
          >
            {lateDays === 1 ? "1 day late" : `${lateDays} days late`}
          </span>
        ) : null}
        {isCompleted && task.completed_at ? (
          <span
            className="text-small"
            style={{ color: "var(--color-text-tertiary)" }}
          >
            Completed {formatCompletedAt(task.completed_at)}
          </span>
        ) : null}
      </div>
    </div>
  );
}

// Issue #177 — the subtitle is what the homeowner actually does for this
// task ("Vacuum blower housing, clean exhaust duct, inspect gas
// connector"); render it as a focal callout rather than muted helper
// text so it reads as the primary content. Surface card + left accent
// stripe + tool icon give it weight without inventing chrome that doesn't
// exist elsewhere in the modal — the treatment echoes the modifier rows
// inside WhyThisTaskExpand at lower intensity.
function TaskInstructionsCallout({ text }: { text: string }) {
  return (
    <div
      className="flex items-start gap-3 p-3"
      style={{
        backgroundColor: "var(--color-bg-surface-raised)",
        border: "1px solid var(--color-border-subtle)",
        borderLeft: "3px solid var(--color-accent)",
        borderRadius: "var(--radius-md)",
      }}
    >
      <Icon
        name="tool"
        size={16}
        style={{
          color: "var(--color-accent)",
          marginTop: 2,
          flexShrink: 0,
        }}
      />
      <p
        style={{
          color: "var(--color-text-primary)",
          fontWeight: 500,
          margin: 0,
        }}
      >
        {text}
      </p>
    </div>
  );
}

function LinkedArtifacts({ task }: { task: LoadedTask }) {
  if (!task.inventory_id && !task.anchor_document) return null;
  return (
    <div className="flex flex-col gap-3">
      {task.inventory_name && task.inventory_id ? (
        <Link
          href={`/inventory/${task.inventory_id}`}
          className="flex items-center gap-3 p-3"
          style={{
            backgroundColor: "var(--color-bg-surface)",
            border: "1px solid var(--color-border-subtle)",
            borderRadius: "var(--radius-md)",
          }}
        >
          <span
            className="flex h-9 w-9 items-center justify-center rounded-md shrink-0"
            style={{
              backgroundColor: "var(--color-bg-surface-raised)",
              color: "var(--color-text-secondary)",
            }}
          >
            <Icon name="package" size={18} />
          </span>
          <div className="min-w-0 flex-1">
            <div style={{ fontWeight: 500 }}>{task.inventory_name}</div>
            {task.inventory_room ? (
              <div
                className="text-small"
                style={{ color: "var(--color-text-tertiary)" }}
              >
                {task.inventory_room}
              </div>
            ) : null}
          </div>
          <Icon
            name="chevron-right"
            size={16}
            style={{ color: "var(--color-text-tertiary)" }}
          />
        </Link>
      ) : null}

      {task.anchor_document ? (
        <DocumentThumbnailRow document={task.anchor_document} />
      ) : null}
    </div>
  );
}

function DocumentThumbnailRow({
  document,
}: {
  document: NonNullable<LoadedTask["anchor_document"]>;
}) {
  const url = useCachedSignedUrl(
    "hearth-documents",
    document.thumbnail_path,
    null,
  );

  return (
    <Link
      href={`/documents/${document.id}`}
      className="flex items-center gap-3 p-3"
      style={{
        backgroundColor: "var(--color-bg-surface)",
        border: "1px solid var(--color-border-subtle)",
        borderRadius: "var(--radius-md)",
      }}
    >
      <span
        className="flex h-12 w-12 items-center justify-center rounded-md shrink-0 overflow-hidden"
        style={{
          backgroundColor: "var(--color-bg-surface-raised)",
          color: "var(--color-text-secondary)",
        }}
      >
        {url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={url}
            alt=""
            className="block w-full h-full object-cover"
          />
        ) : (
          <Icon name="file-text" size={18} />
        )}
      </span>
      <div className="min-w-0 flex-1">
        <div style={{ fontWeight: 500 }}>
          {document.vendor_name ?? "Source document"}
        </div>
        {document.transaction_date ? (
          <div
            className="text-small"
            style={{ color: "var(--color-text-tertiary)" }}
          >
            {formatTransactionDate(document.transaction_date)}
          </div>
        ) : null}
      </div>
      <Icon
        name="chevron-right"
        size={16}
        style={{ color: "var(--color-text-tertiary)" }}
      />
    </Link>
  );
}

function ModalPrimaryCTA({
  task,
  onOpenSheet,
}: {
  task: LoadedTask;
  onOpenSheet: (kind: "renewed" | "completed") => void;
}) {
  if (task.kind === "renewal") {
    return (
      <div className="flex flex-col gap-2">
        <button
          type="button"
          className="btn btn-primary w-full inline-flex items-center justify-center gap-2"
          onClick={() => onOpenSheet("renewed")}
        >
          <Icon name="circle-check" size={16} />
          Mark renewed
        </button>
        {task.renewal_url ? (
          <a
            href={task.renewal_url}
            target="_blank"
            rel="noopener noreferrer"
            className="btn btn-ghost w-full inline-flex items-center justify-center gap-2"
          >
            Renew now
            <Icon name="external-link" size={14} />
          </a>
        ) : null}
      </div>
    );
  }

  const label = COMPLETION_CTA_LABEL[task.kind] ?? "Mark done";
  return (
    <button
      type="button"
      className="btn btn-primary w-full inline-flex items-center justify-center gap-2"
      onClick={() => onOpenSheet("completed")}
    >
      <Icon name="circle-check" size={16} />
      {label}
    </button>
  );
}

function parseDateOnly(yyyymmdd: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(yyyymmdd);
  if (!match) return null;
  const [, y, m, d] = match;
  const date = new Date(Date.UTC(Number(y), Number(m) - 1, Number(d)));
  return Number.isNaN(date.getTime()) ? null : date;
}

function normalizeToDateOnly(d: Date): Date {
  return new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()),
  );
}

function formatCompletedAt(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatTransactionDate(iso: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (match) {
    const [, y, m, d] = match;
    const dt = new Date(Date.UTC(Number(y), Number(m) - 1, Number(d)));
    return dt.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      timeZone: "UTC",
    });
  }
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}
