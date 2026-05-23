"use client";

// Mark-completed completion sheet (issue #137). Used for service /
// inspection / consumable / seasonal task kinds. Simpler than
// MarkRenewedSheet — the cadence is fixed by the task itself, so the
// user only picks a completion date and optionally enters notes. The
// successor task's next_due_at is computed server-side from
// (completedOn + cadence_interval_months) by completeTaskAction.
//
// For one_time tasks no successor is inserted; the task simply flips
// to 'completed' and stays there. The server action handles this — the
// sheet doesn't need to know.

import { useState } from "react";
import { completeTaskAction } from "@/app/actions/maintenance/complete-task";
import { DatePicker } from "@/components/date-picker";
import { MaintenanceModalShell } from "./maintenance-modal-shell";

const COMPLETION_LABEL: Record<string, string> = {
  service: "Mark serviced",
  inspection: "Mark inspected",
  consumable: "Mark refilled",
  seasonal: "Mark done",
};

export type MarkCompletedSheetTask = {
  id: string;
  kind: "renewal" | "service" | "inspection" | "consumable" | "seasonal";
  title: string;
};

export function MarkCompletedSheet({
  task,
  onSaved,
  onCancel,
}: {
  task: MarkCompletedSheetTask;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const today = todayIso();
  const [completedOn, setCompletedOn] = useState(today);
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const sheetTitle = COMPLETION_LABEL[task.kind] ?? "Mark done";

  async function handleSave() {
    if (!completedOn) {
      setError("Pick a completion date.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const result = await completeTaskAction({
        taskId: task.id,
        completedOn,
        notes: notes.trim() || null,
      });
      if (result.ok) {
        onSaved();
      } else {
        setError(result.error);
      }
    } catch (err) {
      console.error("[mark-completed] save failed", err);
      setError("Something went wrong saving. Try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <MaintenanceModalShell
      title={sheetTitle}
      eyebrow={task.title}
      onClose={() => {
        if (!saving) onCancel();
      }}
      closable={!saving}
    >
      <div className="flex flex-col gap-4">
        <DatePicker
          label="When did you do it?"
          value={completedOn}
          onChange={(v) => setCompletedOn(v || today)}
        />

        <div>
          <label htmlFor="mark-completed-notes" className="label">
            Notes (optional)
          </label>
          <textarea
            id="mark-completed-notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            className="input"
            rows={2}
            placeholder="Anything worth remembering about this one"
          />
        </div>

        {error ? (
          <div
            className="text-small"
            role="alert"
            style={{ color: "var(--color-danger)" }}
          >
            {error}
          </div>
        ) : null}

        <div className="flex gap-2 justify-end">
          <button
            type="button"
            className="btn btn-ghost"
            onClick={onCancel}
            disabled={saving}
          >
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={handleSave}
            disabled={saving || !completedOn}
          >
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </MaintenanceModalShell>
  );
}

function todayIso(): string {
  const d = new Date();
  const y = d.getFullYear().toString().padStart(4, "0");
  const m = (d.getMonth() + 1).toString().padStart(2, "0");
  const day = d.getDate().toString().padStart(2, "0");
  return `${y}-${m}-${day}`;
}
