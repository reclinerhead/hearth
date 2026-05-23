"use client";

// Prior-occurrences list for the task detail modal (issue #137).
//
// Walks the predecessor_task_id chain backwards from the current task,
// rendering each completed predecessor as a small history row. Stops
// at null (the first occurrence) or after 10 prior occurrences as a
// defensive bound — no real-world chain reaches 10 in practice.
//
// One row at a time, two queries per step. This is fine: chains are
// short (most users will see 1-3 prior occurrences) and the modal opens
// infrequently. If chain length grows we swap to a recursive CTE in a
// Postgres function. Not now.

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

type PriorTask = {
  id: string;
  completed_at: string | null;
  title: string;
  completion_notes: string | null;
  completed_by_document_id: string | null;
};

const HISTORY_CHAIN_MAX = 10;

export function TaskHistoryList({
  currentTaskId,
}: {
  currentTaskId: string;
}) {
  const [prior, setPrior] = useState<PriorTask[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const supabase = createClient();
      const chain: PriorTask[] = [];
      let cursor = currentTaskId;
      for (let i = 0; i < HISTORY_CHAIN_MAX; i++) {
        // Look up the cursor's predecessor pointer first — a single
        // narrow row read.
        const { data: cursorRow } = await supabase
          .from("maintenance_tasks")
          .select("predecessor_task_id")
          .eq("id", cursor)
          .maybeSingle();
        if (cancelled) return;
        const predecessorId = cursorRow?.predecessor_task_id;
        if (!predecessorId) break;

        // Then the predecessor's full payload — the row we render.
        const { data: prev } = await supabase
          .from("maintenance_tasks")
          .select(
            "id, completed_at, title, completion_notes, completed_by_document_id",
          )
          .eq("id", predecessorId)
          .maybeSingle();
        if (cancelled) return;
        if (!prev) break;

        chain.push(prev as PriorTask);
        cursor = prev.id;
      }
      if (!cancelled) setPrior(chain);
    })();
    return () => {
      cancelled = true;
    };
  }, [currentTaskId]);

  if (!prior || prior.length === 0) return null;

  return (
    <section className="flex flex-col gap-2">
      <div
        className="eyebrow"
        style={{ color: "var(--color-text-tertiary)" }}
      >
        Prior occurrences
      </div>
      <ul className="flex flex-col gap-2 list-none p-0 m-0">
        {prior.map((p) => (
          <li
            key={p.id}
            className="text-small flex flex-col p-3"
            style={{
              backgroundColor: "var(--color-bg-surface)",
              border: "1px solid var(--color-border-subtle)",
              borderRadius: "var(--radius-sm)",
            }}
          >
            <div style={{ color: "var(--color-text-primary)" }}>
              {p.completed_at ? `Completed ${formatDate(p.completed_at)}` : "Completed"}
              {p.completed_by_document_id
                ? " · via document upload"
                : " · marked manually"}
            </div>
            {p.completion_notes ? (
              <div
                style={{
                  color: "var(--color-text-secondary)",
                  marginTop: 2,
                }}
              >
                {p.completion_notes}
              </div>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}
