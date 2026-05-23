// Shared TypeScript shapes for the maintenance module.
//
// These types describe two persistence surfaces that live outside this
// file's import graph but are constrained by it:
//
//   - hearth.inventory.last_synthesis_run (jsonb) — the per-item trace
//     of the most recent maintenance-synthesis workflow run. Shape is
//     `SynthesisRunLog`. The migration that added the column documents
//     this contract inline; this file is where the contract is actually
//     enforced via TypeScript.
//
//   - hearth.maintenance_tasks.reasoning (jsonb) — the per-task
//     provenance object the synthesis pipeline writes alongside every
//     row. Shape is `TaskReasoning`. Direct-event tasks populate a
//     minimal version with `source_kind = 'document_expiration'`.
//
// The Zod schema in `synthesis-schema.ts` is the runtime contract the
// model is bound to. The types here are derived from the same shapes
// (some loosened for the persisted-row form which the model never
// emits — e.g. `'document_expiration'` is reserved for the direct-event
// pipeline that ships in a follow-on issue).

export type SynthesisRunStep = {
  /** 1-indexed step number, mirrors habitat activity_log ordering. */
  step: number;
  kind:
    | "load"
    | "consider"
    | "supersede"
    | "model_call"
    | "validate"
    | "emit_task"
    | "drop_task"
    | "skip"
    | "error";
  /** Human-readable narration in Hearth's voice. User-facing in the future modal. */
  narration: string;
  /** Optional technical detail (query, URL, raw value). Developer-facing. */
  detail?: string;
  /** Milliseconds since `started_at`. Use for the timeline in the future modal. */
  at_ms: number;
};

export type SynthesisInputsSummary = {
  /**
   * When `ai_insights` was generated for the item — captured so the
   * trace makes clear which research run the synthesis built on top of.
   * Null when the item's `ai_insights` carried no `generated_at` (shouldn't
   * happen on a real row, but the field is nullable on the type).
   */
  insights_generated_at: string | null;
  habitat_findings_considered: number;
  linked_receipts_considered: number;
  install_date_used: string | null;
};

/**
 * Persisted to `hearth.inventory.last_synthesis_run` at completion (and on
 * failure, with `error` populated). Overwritten on each run — the
 * historical traces are not preserved because the load-bearing decisions
 * are captured in the per-task `reasoning` on each emitted maintenance_tasks
 * row.
 */
export type SynthesisRunLog = {
  started_at: string;
  completed_at: string;
  total_duration_ms: number;
  model: string;
  inputs_summary: SynthesisInputsSummary;
  steps: SynthesisRunStep[];
  tasks_emitted: number;
  /** Count of pre-existing open synthesis tasks marked `superseded` before this run wrote new rows. Zero on first build. */
  superseded_count: number;
  /** Trimmed to 500 chars when set. Null on a successful run. */
  error: string | null;
};

// --------------------------------------------------------------------------
// Per-task reasoning (writes to hearth.maintenance_tasks.reasoning)
// --------------------------------------------------------------------------
//
// Synthesis emits these; direct-event tasks write a minimal variant with
// `source_kind = 'document_expiration'`. Both shapes share the same outer
// object so renderers don't need to switch on source.

export type TaskReasoningModifier = {
  kind: "habitat" | "system_age" | "environment";
  /** habitat module_key when kind='habitat'; null otherwise. */
  finding_module_key: string | null;
  effect: string;
};

export type TaskReasoningAnchor = {
  /**
   * Where the first occurrence is grounded. `receipt` / `install_date` /
   * `synthesis_default` are emitted by the synthesis pipeline.
   * `document_expiration` is reserved for the direct-event pipeline (the
   * issue's follow-on work) — the synthesis model will not emit it.
   */
  kind: "receipt" | "install_date" | "synthesis_default" | "document_expiration";
  detail: string;
  /** hearth.documents.id when grounded in a specific document; null otherwise. */
  document_id: string | null;
};

export type TaskReasoning = {
  source_kind:
    | "manufacturer_guidance"
    | "class_default"
    | "habitat_modifier"
    | "installation_anchored"
    | "receipt_anchored"
    | "document_expiration";
  cadence_basis: string;
  modifiers: TaskReasoningModifier[];
  anchor: TaskReasoningAnchor;
};
