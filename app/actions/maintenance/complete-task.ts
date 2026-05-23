"use server";

// User-driven maintenance task completion (issue #137).
//
// Closes the open task (status -> completed, completed_at, optional
// notes) and, when the cadence calls for it, inserts a successor row
// chained via predecessor_task_id. The new row carries the same
// title/subtitle/cadence/renewal_options shape so the panel renders it
// as the next occurrence of the same stream.
//
// This is the manual analogue of the direct-event pipeline. When the
// user later uploads the actual document for the same stream, the
// direct-event pipeline closes the successor we just wrote and chains
// forward again — the manual completion is just one link in the chain.
//
// RLS-gated through the cookie-bound client; the underlying SELECT and
// UPDATE both filter by the user's house ownership. No service-role
// client — this action runs on behalf of the user, and we want the
// database to refuse any update the user couldn't legitimately make.

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { computeSuccessorDueDate } from "@/lib/maintenance/successor-task";
import type { TaskReasoning } from "@/lib/maintenance/types";

export type CompleteTaskInput = {
  taskId: string;
  /** YYYY-MM-DD; the user's chosen completion date (default today on the client). */
  completedOn: string;
  /** YYYY-MM-DD; the user's chosen renewal expiration date for renewal-kind
   *  tasks. Omitted/null for non-renewal kinds — the cadence drives the
   *  successor's next_due_at instead. */
  newExpiration?: string | null;
  /** Optional free-form note attached to the closed task. */
  notes?: string | null;
};

export type CompleteTaskResult =
  | { ok: true; createdTaskId: string | null }
  | { ok: false; error: string };

export async function completeTaskAction(
  input: CompleteTaskInput,
): Promise<CompleteTaskResult> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.completedOn)) {
    return { ok: false, error: "Invalid completion date." };
  }
  if (
    input.newExpiration &&
    !/^\d{4}-\d{2}-\d{2}$/.test(input.newExpiration)
  ) {
    return { ok: false, error: "Invalid expiration date." };
  }

  const supabase = await createClient();

  const { data: currentRaw, error: loadError } = await supabase
    .from("maintenance_tasks")
    .select("*")
    .eq("id", input.taskId)
    .single();

  if (loadError || !currentRaw) {
    return { ok: false, error: loadError?.message ?? "Task not found." };
  }
  // The browser/server clients aren't generated from a Database schema
  // (types/house.ts and friends are hand-typed today — see "Supabase-
  // generated types" under "What isn't built yet"), so the PostgREST
  // response is loosely typed. Cast through a narrow shape that lists
  // the columns this action reads.
  const current = currentRaw as unknown as {
    id: string;
    house_id: string;
    inventory_id: string | null;
    source: "direct_event" | "synthesis";
    kind: "renewal" | "service" | "inspection" | "consumable" | "seasonal";
    title: string;
    subtitle: string | null;
    cadence_kind: "interval" | "seasonal" | "one_time" | "per_use" | null;
    cadence_interval_months: number | null;
    cadence_seasonal_anchor: string | null;
    renewal_options: unknown | null;
    renewal_url: string | null;
    reasoning: TaskReasoning | null;
    status: "open" | "completed" | "superseded";
  };
  if (current.status !== "open") {
    return { ok: false, error: "This task is already completed." };
  }

  // Anchor the completion timestamp at UTC noon so the calendar-day
  // value the user picked is unambiguous regardless of their local time
  // zone, matching the direct-event pipeline's expiration_date handling.
  const completedAtIso = new Date(
    `${input.completedOn}T12:00:00Z`,
  ).toISOString();

  const trimmedNotes = (input.notes ?? "").trim();
  const notesValue = trimmedNotes.length > 0 ? trimmedNotes : null;

  const { error: closeError } = await supabase
    .from("maintenance_tasks")
    .update({
      status: "completed",
      completed_at: completedAtIso,
      completion_notes: notesValue,
    })
    .eq("id", input.taskId);

  if (closeError) {
    return { ok: false, error: closeError.message };
  }

  const nextDueAt = computeSuccessorDueDate({
    cadence_kind: current.cadence_kind,
    cadence_interval_months: current.cadence_interval_months,
    completedOn: input.completedOn,
    newExpirationOverride: input.newExpiration ?? null,
  });

  let createdTaskId: string | null = null;

  if (nextDueAt) {
    // Carry the prior task's modifiers through so the next occurrence's
    // "Why this task" expand keeps showing the habitat / system-age
    // adjustments that shaped the cadence — those don't go away just
    // because the user marked one occurrence done.
    const priorReasoning = (current.reasoning as TaskReasoning | null) ?? null;
    const successorReasoning: TaskReasoning = {
      source_kind: "manual_completion",
      cadence_basis: `Successor of ${current.title}, completed ${input.completedOn}.`,
      modifiers: priorReasoning?.modifiers ?? [],
      anchor: {
        kind: "manual_completion",
        detail: `Anchored from ${input.completedOn} completion.`,
        document_id: null,
      },
    };

    const { data: inserted, error: insertError } = await supabase
      .from("maintenance_tasks")
      .insert({
        house_id: current.house_id,
        inventory_id: current.inventory_id,
        source: current.source,
        kind: current.kind,
        title: current.title,
        subtitle: current.subtitle,
        next_due_at: nextDueAt,
        status: "open",
        cadence_kind: current.cadence_kind,
        cadence_interval_months: current.cadence_interval_months,
        cadence_seasonal_anchor: current.cadence_seasonal_anchor,
        renewal_options: current.renewal_options,
        renewal_url: current.renewal_url,
        reasoning: successorReasoning,
        predecessor_task_id: input.taskId,
      })
      .select("id")
      .single();

    if (insertError || !inserted) {
      // The current task is already closed at this point; surface the
      // insert failure so the user can retry. A retry walks the same
      // path — the close becomes a no-op (status guard returns 'already
      // completed') so we'd need a different recovery flow. For v1 the
      // expectation is that this branch is rare and the user re-opens
      // the modal on the successor row's predecessor, if needed.
      console.error(
        "[complete-task] successor insert failed after close:",
        insertError?.message,
      );
      return {
        ok: false,
        error:
          insertError?.message ??
          "We closed this task but couldn't schedule the next one. Refresh and try again.",
      };
    }

    createdTaskId = inserted.id as string;
  }

  revalidatePath("/dashboard");
  if (current.inventory_id) {
    revalidatePath(`/inventory/${current.inventory_id}`);
  }

  return { ok: true, createdTaskId };
}
