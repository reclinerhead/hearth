// Zod schemas for the Grok 4.3 vision call. These define the contract
// between the model and the rest of the system — `generateObject`
// rejects any response that doesn't validate, so getting these right
// (or wrong) propagates everywhere downstream.
//
// Two modes:
//   - classification (Mode A) — used when no existingInventoryData is
//     passed. Discriminated on photo_kind so the model picks exactly
//     one of nameplate / appliance_photo / not_useful.
//   - delta (Mode B) — used when existingInventoryData is passed.
//     Returns only the fields the photo adds to or contradicts.

import { z } from "zod";

const equipmentType = z.enum(["appliance", "system", "exterior"]);

const nameplateBranch = z.object({
  photo_kind: z.literal("nameplate"),
  classification: z.object({
    name: z.string().min(1),
    type: equipmentType,
    confidence: z.number().min(0).max(1),
  }),
  extracted: z.object({
    manufacturer: z.string().nullable(),
    model_number: z.string().nullable(),
    serial_number: z.string().nullable(),
    installed_on: z.string().nullable(),
    notes: z.string().nullable(),
  }),
  room_suggestion: z.string().nullable(),
});

const appliancePhotoBranch = z.object({
  photo_kind: z.literal("appliance_photo"),
  classification: z.object({
    name: z.string().min(1),
    type: equipmentType,
    confidence: z.number().min(0).max(1),
  }),
  extracted: z.null(),
  room_suggestion: z.string().nullable(),
});

const notUsefulBranch = z.object({
  photo_kind: z.literal("not_useful"),
  classification: z.null(),
  extracted: z.null(),
  room_suggestion: z.null(),
});

export const classificationSchema = z.discriminatedUnion("photo_kind", [
  nameplateBranch,
  appliancePhotoBranch,
  notUsefulBranch,
]);

export type ClassificationResult = z.infer<typeof classificationSchema>;

export const deltaSchema = z.object({
  deltas: z.record(
    z.string(),
    z.object({
      currentValue: z.string().nullable(),
      proposedValue: z.string(),
    }),
  ),
  confidence: z.number().min(0).max(1),
});

export type DeltaResult = z.infer<typeof deltaSchema>;
