// Zod schema the maintenance-synthesis Grok call is bound to. Mirrors
// hearth.maintenance_tasks columns exactly so the workflow can translate
// model output to a row insert without an intermediate layer.
//
// The .refine() on cadenceShape mirrors the maintenance_tasks_cadence_shape
// CHECK constraint in the migration. Catching the violation at the Zod
// boundary lets the workflow drop the offending task with a clear log line
// before attempting an insert the DB would reject anyway — one malformed
// task shouldn't lose the others.

import { z } from "zod";

const cadenceShape = z
  .object({
    kind: z.enum(["interval", "seasonal", "one_time", "per_use"]),
    interval_months: z.number().int().min(1).max(120).nullable(),
    seasonal_anchor: z
      .enum([
        "before_heating_season",
        "before_cooling_season",
        "spring",
        "fall",
      ])
      .nullable(),
  })
  .refine(
    (c) =>
      (c.kind === "one_time" &&
        c.interval_months === null &&
        c.seasonal_anchor === null) ||
      (c.kind === "per_use" &&
        c.interval_months === null &&
        c.seasonal_anchor === null) ||
      (c.kind === "interval" &&
        c.interval_months !== null &&
        c.seasonal_anchor === null) ||
      (c.kind === "seasonal" &&
        c.interval_months !== null &&
        c.seasonal_anchor !== null),
    { message: "cadence shape violates kind-specific requirements" },
  );

const reasoningModifierShape = z.object({
  kind: z.enum(["habitat", "system_age", "environment"]),
  finding_module_key: z.string().nullable(),
  effect: z.string().min(1).max(400),
});

const reasoningAnchorShape = z.object({
  kind: z.enum(["receipt", "install_date", "synthesis_default"]),
  detail: z.string().min(1).max(200),
  document_id: z.string().nullable(),
});

const taskReasoningShape = z.object({
  source_kind: z.enum([
    "manufacturer_guidance",
    "class_default",
    "habitat_modifier",
    "installation_anchored",
    "receipt_anchored",
  ]),
  cadence_basis: z.string().min(1).max(600),
  modifiers: z.array(reasoningModifierShape),
  anchor: reasoningAnchorShape,
});

const synthesisTaskShape = z.object({
  // Maps to hearth.maintenance_tasks.kind. Synthesis emits service /
  // inspection / consumable / seasonal. 'renewal' is reserved for the
  // direct-event pipeline that creates renewal tasks from document
  // expirations — the model should never produce it.
  kind: z.enum(["service", "inspection", "consumable", "seasonal"]),
  title: z.string().min(1).max(120),
  subtitle: z.string().min(1).max(200).nullable(),
  // Days from synthesis run time until the first occurrence. The
  // workflow stamps `now() + days_out` at insertion time. Bounded
  // [0, 3650] — anything beyond 10 years is suspect.
  first_occurrence_days_out: z.number().int().min(0).max(3650),
  cadence: cadenceShape,
  reasoning: taskReasoningShape,
});

export const synthesisOutputShape = z.object({
  // Optional one-paragraph summary of the model's overall decision.
  // Captured in the developer log; not surfaced in the UI today.
  overall_notes: z.string().max(1000).nullable(),
  // Hard cap at 20 as a safety net. Prompt asks for ~4-8.
  tasks: z.array(synthesisTaskShape).max(20),
});

export type SynthesisTask = z.infer<typeof synthesisTaskShape>;
export type SynthesisOutput = z.infer<typeof synthesisOutputShape>;
