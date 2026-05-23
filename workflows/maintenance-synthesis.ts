// Maintenance-synthesis workflow. Runs Grok 4.3 reasoning against the
// inventory item's AI insights, the house's habitat findings, the item's
// linked service receipts, and its install/purchase date. Emits a
// structured list of recurring maintenance tasks and writes them to
// hearth.maintenance_tasks (source='synthesis'). The per-run trace lands
// in hearth.inventory.last_synthesis_run plus the developer-time debug
// log at logs/maintenance-synthesis-prompts.log.
//
// Triggered by the "Build maintenance plan" / "Rebuild maintenance plan"
// button on the inventory detail page via buildMaintenancePlanAction.
//
// One step per logical operation — load, supersede, model call, write,
// trace persist — so WDK's per-step retry granularity catches a
// transient Supabase or AI Gateway failure without re-running the
// expensive model call.

import { generateObject } from "ai";
import { createServiceClient } from "@/lib/supabase/service";
import {
  buildSynthesisSystemPrompt,
  buildSynthesisUserMessage,
  type SynthesisInput,
} from "@/lib/maintenance/synthesis-prompt";
import {
  synthesisOutputShape,
  type SynthesisOutput,
} from "@/lib/maintenance/synthesis-schema";
import type {
  SynthesisRunLog,
  SynthesisRunStep,
} from "@/lib/maintenance/types";

const SOURCE_SYNTHESIS = "synthesis" as const;
const STATUS_OPEN = "open" as const;
const STATUS_SUPERSEDED = "superseded" as const;

/**
 * Background synthesis workflow. Triggered by buildMaintenancePlanAction.
 *
 * @param inventoryId - hearth.inventory.id of the item being planned.
 */
export async function runMaintenanceSynthesis(
  inventoryId: string,
): Promise<void> {
  "use workflow";

  // Timing uses Date.now() rather than process.hrtime — the workflow
  // function body runs in WDK's bundled context, which doesn't have
  // Node's `process` available (steps do, since they execute in the
  // Node runtime). Millisecond resolution is plenty for a workflow
  // that measures end-to-end in tens of seconds.
  const startedAt = new Date();
  const startMs = Date.now();
  const steps: SynthesisRunStep[] = [];

  const elapsed = () => Date.now() - startMs;
  const pushStep = (step: Omit<SynthesisRunStep, "step" | "at_ms">) => {
    steps.push({
      step: steps.length + 1,
      at_ms: elapsed(),
      ...step,
    });
  };

  // Pre-resolve model name so trace + log always have it, even on
  // errors that happen before the model call step runs. process.env
  // reads are inlined at build time so this works inside the workflow
  // body; process.hrtime calls (a runtime Node API) do not, which is
  // why the timing above uses Date.now() instead.
  const model = process.env.MAINTENANCE_SYNTHESIS_MODEL ?? "";

  let input: SynthesisInput | null = null;
  let systemPrompt: string | null = null;
  let userMessage: string | null = null;
  let output: SynthesisOutput | null = null;
  let supersededCount = 0;
  let tasksEmitted = 0;

  try {
    const loaded = await loadSynthesisInput(inventoryId);
    input = loaded.input;
    pushStep({
      kind: "load",
      narration: `Loaded item details, ${loaded.input.habitat_findings.length} habitat finding(s), and ${loaded.input.linked_receipts.length} linked receipt(s).`,
      detail: `inventory_id=${inventoryId} house_id=${loaded.houseId}`,
    });

    supersededCount = await supersedeOpenSynthesisTasks(inventoryId);
    if (supersededCount > 0) {
      pushStep({
        kind: "supersede",
        narration: `Marked ${supersededCount} existing open synthesis task(s) as superseded before writing the fresh plan.`,
      });
    }

    const modelResult = await callModel(loaded.input);
    output = modelResult.output;
    systemPrompt = modelResult.systemPrompt;
    userMessage = modelResult.userMessage;
    pushStep({
      kind: "model_call",
      narration: `Called ${modelResult.model} and got back ${output.tasks.length} candidate task(s).`,
      detail: `duration_ms=${modelResult.durationMs.toFixed(0)}`,
    });

    tasksEmitted = await writeTasks(loaded, output);
    pushStep({
      kind: "emit_task",
      narration: `Wrote ${tasksEmitted} maintenance task row(s) for this item.`,
    });

    const trace = buildTrace({
      startedAt,
      totalDurationMs: elapsed(),
      model: modelResult.model,
      input: loaded.input,
      steps,
      tasksEmitted,
      supersededCount,
      error: null,
    });
    await persistTrace(inventoryId, trace);

    await logSynthesisDebug({
      startedAt: startedAt.toISOString(),
      durationMs: elapsed(),
      model: modelResult.model,
      input: loaded.input,
      systemPrompt,
      userMessage,
      response: output,
      error: null,
    });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Unknown synthesis error";
    pushStep({
      kind: "error",
      narration: "Synthesis failed.",
      detail: message.slice(0, 200),
    });

    const trace = buildTrace({
      startedAt,
      totalDurationMs: elapsed(),
      model,
      input,
      steps,
      tasksEmitted,
      supersededCount,
      error: message.slice(0, 500),
    });
    await persistTrace(inventoryId, trace);

    await logSynthesisDebug({
      startedAt: startedAt.toISOString(),
      durationMs: elapsed(),
      model,
      input,
      systemPrompt,
      userMessage,
      response: output,
      error: message,
    });

    // Re-throw so the WDK marks the run failed. A future enhancement
    // would lift this into a terminal-error wrapper per the WDK pattern
    // noted in project knowledge.
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Steps
// ---------------------------------------------------------------------------

type LoadedSynthesisInput = {
  input: SynthesisInput;
  houseId: string;
};

/**
 * Step 1 — assemble the SynthesisInput from Supabase. Composes the
 * inventory row, the house's completed habitat findings, and the item's
 * linked service receipts.
 *
 * Throws when the inventory row doesn't exist or when ai_insights.maintenance
 * is null. The button is gated on maintenance being populated, but the
 * server action's check is a guard against a stale or malicious client;
 * this is the workflow's belt-and-suspenders defense.
 */
async function loadSynthesisInput(
  inventoryId: string,
): Promise<LoadedSynthesisInput> {
  "use step";

  const supabase = createServiceClient();

  const { data: row, error } = await supabase
    .from("inventory")
    .select(
      "id, house_id, name, type, subtype, manufacturer, model_number, installed_on, purchased_on, ai_insights",
    )
    .eq("id", inventoryId)
    .single();

  if (error || !row) {
    throw new Error(
      `Could not load inventory item ${inventoryId}: ${error?.message ?? "not found"}`,
    );
  }

  const insights = row.ai_insights as {
    headline?: string;
    overview?: string | null;
    service_life?: string | null;
    maintenance?: string | null;
    generated_at?: string | null;
  } | null;

  if (!insights || !insights.maintenance) {
    throw new Error(
      "Item has no maintenance insights yet — run Research first before building a plan.",
    );
  }

  const [habitatResult, receiptsResult] = await Promise.all([
    // Same filter the dashboard's HabitatPreviewPanel applies — completed
    // findings with a non-null severity. A "running" re-check still
    // exposes the previously-completed severity; this filter keeps the
    // synthesis grounded in real findings rather than transient state.
    supabase
      .from("habitat_findings")
      .select("module_key, category, severity, headline, summary")
      .eq("house_id", row.house_id)
      .eq("status", "completed")
      .not("severity", "is", null),
    supabase
      .from("documents")
      .select("id, metadata, kind, status, created_at")
      .eq("inventory_id", row.id)
      .eq("status", "attached")
      .eq("kind", "receipt")
      .order("created_at", { ascending: false }),
  ]);

  const habitatFindings = (habitatResult.data ?? []).map(
    (f: {
      module_key: string;
      category: string;
      severity: string;
      headline: string;
      summary: string;
    }) => ({
      module_key: f.module_key,
      category: f.category,
      severity: f.severity,
      headline: f.headline,
      summary: f.summary,
    }),
  );

  const linkedReceipts = (receiptsResult.data ?? []).map(
    (r: { id: string; metadata: Record<string, unknown> | null }) => {
      const md = (r.metadata ?? {}) as Record<string, unknown>;
      return {
        document_id: r.id,
        transaction_date:
          typeof md.transaction_date === "string" &&
          md.transaction_date.length > 0
            ? md.transaction_date
            : null,
        transaction_type:
          typeof md.transaction_type === "string" &&
          md.transaction_type.length > 0
            ? md.transaction_type
            : null,
        vendor_name:
          typeof md.vendor_name === "string" && md.vendor_name.length > 0
            ? md.vendor_name
            : null,
        notes: typeof md.notes === "string" && md.notes.length > 0 ? md.notes : null,
      };
    },
  );

  const input: SynthesisInput = {
    inventory: {
      id: row.id,
      name: row.name,
      type: row.type as SynthesisInput["inventory"]["type"],
      subtype: row.subtype as SynthesisInput["inventory"]["subtype"],
      manufacturer: row.manufacturer,
      model_number: row.model_number,
      installed_on: row.installed_on,
      purchased_on: row.purchased_on,
    },
    ai_insights: {
      headline: insights.headline ?? "",
      overview: insights.overview ?? null,
      service_life: insights.service_life ?? null,
      maintenance: insights.maintenance,
      generated_at: insights.generated_at ?? null,
    },
    habitat_findings: habitatFindings,
    linked_receipts: linkedReceipts,
  };

  return { input, houseId: row.house_id };
}

/**
 * Step 2 — mark every open synthesis task for this inventory item as
 * superseded. Direct-event tasks (source='direct_event') and completed
 * history are never touched. Returns the number of superseded rows so
 * the trace can record it.
 *
 * No-op on first build (no existing synthesis tasks); the function
 * exists so build and rebuild share one code path.
 */
async function supersedeOpenSynthesisTasks(
  inventoryId: string,
): Promise<number> {
  "use step";

  const supabase = createServiceClient();

  const { data, error } = await supabase
    .from("maintenance_tasks")
    .update({ status: STATUS_SUPERSEDED })
    .eq("inventory_id", inventoryId)
    .eq("source", SOURCE_SYNTHESIS)
    .eq("status", STATUS_OPEN)
    .select("id");

  if (error) {
    throw new Error(
      `Could not supersede existing synthesis tasks for ${inventoryId}: ${error.message}`,
    );
  }

  return data?.length ?? 0;
}

/**
 * Step 3 — call Grok 4.3 with the assembled input and return the
 * validated structured output. Throws on missing env var or model error.
 */
async function callModel(input: SynthesisInput): Promise<{
  output: SynthesisOutput;
  model: string;
  durationMs: number;
  systemPrompt: string;
  userMessage: string;
}> {
  "use step";

  const model = process.env.MAINTENANCE_SYNTHESIS_MODEL;
  if (!model) {
    throw new Error(
      "MAINTENANCE_SYNTHESIS_MODEL is not configured. Set it in .env.local.",
    );
  }

  const systemPrompt = buildSynthesisSystemPrompt();
  const userMessage = buildSynthesisUserMessage(input);

  const callStartMs = Date.now();
  const result = await generateObject({
    model,
    schema: synthesisOutputShape,
    system: systemPrompt,
    messages: [{ role: "user", content: userMessage }],
  });
  const durationMs = Date.now() - callStartMs;

  return {
    output: result.object,
    model,
    durationMs,
    systemPrompt,
    userMessage,
  };
}

/**
 * Step 4 — write the model's task array as hearth.maintenance_tasks
 * rows. Returns the count of rows actually inserted (which can be less
 * than output.tasks.length only if the DB rejected one; the Zod refine
 * mirrors the DB check, so in practice the two match).
 */
async function writeTasks(
  loaded: LoadedSynthesisInput,
  output: SynthesisOutput,
): Promise<number> {
  "use step";

  if (output.tasks.length === 0) return 0;

  const supabase = createServiceClient();
  const today = startOfUtcDay(new Date());

  const rows = output.tasks.map((task) => {
    const cadenceKind = task.cadence.kind;

    // Per-use rows have no meaningful calendar due-date — they surface
    // in the inventory page's "Every time you use it" section, which
    // doesn't read this column. The dashboard panel filters them out
    // via cadence_kind != 'per_use'. We still need a value because
    // next_due_at is NOT NULL; today's UTC date is the placeholder
    // (see migration note in 20260524000000_add_per_use_cadence.sql).
    const dueDate =
      cadenceKind === "per_use"
        ? new Date(today)
        : (() => {
            const d = new Date(today);
            d.setUTCDate(d.getUTCDate() + task.first_occurrence_days_out);
            return d;
          })();

    // 'one_time' and 'per_use' both forbid interval_months / seasonal_anchor
    // (the cross-field CHECK constraint encodes this). 'seasonal' is the
    // only cadence that carries a seasonal anchor.
    const cadenceIntervalMonths =
      cadenceKind === "one_time" || cadenceKind === "per_use"
        ? null
        : task.cadence.interval_months;
    const cadenceSeasonalAnchor =
      cadenceKind === "seasonal" ? task.cadence.seasonal_anchor : null;

    return {
      house_id: loaded.houseId,
      inventory_id: loaded.input.inventory.id,
      source: SOURCE_SYNTHESIS,
      kind: task.kind,
      title: task.title,
      subtitle: task.subtitle,
      next_due_at: toIsoDate(dueDate),
      status: STATUS_OPEN,
      cadence_kind: cadenceKind,
      cadence_interval_months: cadenceIntervalMonths,
      cadence_seasonal_anchor: cadenceSeasonalAnchor,
      // Synthesis never emits renewal options; the direct-event pipeline
      // owns that field.
      renewal_options: null,
      reasoning: task.reasoning,
    };
  });

  const { data, error } = await supabase
    .from("maintenance_tasks")
    .insert(rows)
    .select("id");

  if (error) {
    throw new Error(
      `Could not insert synthesis tasks for ${loaded.input.inventory.id}: ${error.message}`,
    );
  }

  return data?.length ?? 0;
}

/**
 * Step 5 — persist the run trace to hearth.inventory.last_synthesis_run.
 *
 * Non-fatal on failure: the tasks were already written and the dev debug
 * log carries the full record. Logging the trace-write failure rather
 * than throwing keeps a successful synthesis from being marked failed
 * just because the trace column couldn't be updated.
 */
async function persistTrace(
  inventoryId: string,
  trace: SynthesisRunLog,
): Promise<void> {
  "use step";

  const supabase = createServiceClient();
  const { error } = await supabase
    .from("inventory")
    .update({ last_synthesis_run: trace })
    .eq("id", inventoryId);

  if (error) {
    console.error(
      "[maintenance-synthesis] failed to persist run trace:",
      error.message,
    );
  }
}

/**
 * Step wrapper for the developer-time debug log. The log helper uses
 * `node:fs/promises` and `node:path`, which can't run inside the
 * workflow function itself — workflow code is bundled separately and
 * Node modules are unavailable there. A `"use step"` boundary keeps
 * the import out of the workflow bundle and gives the file write its
 * own retry granularity (a logging failure inside the step's catch
 * doesn't propagate, so this never breaks a run).
 */
async function logSynthesisDebug(args: {
  startedAt: string;
  durationMs: number;
  model: string;
  input: SynthesisInput | null;
  systemPrompt: string | null;
  userMessage: string | null;
  response: SynthesisOutput | null;
  error: string | null;
}): Promise<void> {
  "use step";

  const { writeSynthesisDebugLog } = await import(
    "@/lib/maintenance/synthesis-debug-log"
  );
  await writeSynthesisDebugLog({
    startedAt: new Date(args.startedAt),
    durationMs: args.durationMs,
    model: args.model,
    input: args.input,
    systemPrompt: args.systemPrompt,
    userMessage: args.userMessage,
    response: args.response,
    error: args.error,
  });
}

// ---------------------------------------------------------------------------
// Trace assembly
// ---------------------------------------------------------------------------

function buildTrace(args: {
  startedAt: Date;
  totalDurationMs: number;
  model: string;
  input: SynthesisInput | null;
  steps: SynthesisRunStep[];
  tasksEmitted: number;
  supersededCount: number;
  error: string | null;
}): SynthesisRunLog {
  return {
    started_at: args.startedAt.toISOString(),
    completed_at: new Date().toISOString(),
    total_duration_ms: Math.round(args.totalDurationMs * 10) / 10,
    model: args.model,
    inputs_summary: {
      insights_generated_at: args.input?.ai_insights.generated_at ?? null,
      habitat_findings_considered: args.input?.habitat_findings.length ?? 0,
      linked_receipts_considered: args.input?.linked_receipts.length ?? 0,
      install_date_used: args.input?.inventory.installed_on ?? null,
    },
    steps: args.steps,
    tasks_emitted: args.tasksEmitted,
    superseded_count: args.supersededCount,
    error: args.error,
  };
}

// ---------------------------------------------------------------------------
// Date helpers
// ---------------------------------------------------------------------------

function startOfUtcDay(d: Date): Date {
  return new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()),
  );
}

function toIsoDate(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
