// Zod schema + model selector for the dedicated serial-decode pipeline
// (issue #77). The AI call lives in the route handler at
// app/api/inventory/[id]/decode-serial/route.ts so the model selection
// + persistence wiring stays close to the request lifecycle. This file
// stays narrow on purpose — schema + env-driven model selection are the
// bits worth importing from multiple places (the route and its tests).
//
// Unlike the insights schema, every field except manufacture_date is
// required so we capture the model's reasoning even on low-confidence
// runs. manufacture_date is nullable: the prompt instructs the model to
// return null when it cannot confidently apply a known encoding rule.
//
// The route only PERSISTS to the new inventory columns when
// confidence === "high" — medium/low results are returned to the client
// (and written to the debug log) but never land in the row, since the
// columns are user-visible and a confidently-wrong date is worse than
// no date at all.

import { z } from "zod";

export const PRECISION_VALUES = ["year", "month", "week"] as const;
export type ManufactureDatePrecision = (typeof PRECISION_VALUES)[number];

export const CONFIDENCE_VALUES = ["high", "medium", "low"] as const;
export type ManufactureDateConfidence = (typeof CONFIDENCE_VALUES)[number];

export const decodeSerialSchema = z.object({
  // Format mirrors the column's precision-driven convention:
  //   - "year"  → YYYY        (e.g. "2014")
  //   - "month" → YYYY-MM     (e.g. "2014-10")
  //   - "week"  → YYYY-Www    (e.g. "2014-W44")
  // Null when the model cannot confidently decode. The runtime regex is
  // generous on whitespace because some models occasionally pad output.
  manufacture_date: z
    .string()
    .min(1)
    .max(40)
    .nullable(),
  precision: z.enum(PRECISION_VALUES).nullable(),
  encoding_rule_cited: z.string().min(1).max(400).nullable(),
  confidence: z.enum(CONFIDENCE_VALUES),
  reasoning: z.string().min(1).max(2000),
});

export type DecodeSerialResult = z.infer<typeof decodeSerialSchema>;

export function getSerialDecoderModel(): string {
  return process.env.INVENTORY_SERIAL_DECODER_MODEL ?? "";
}
