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

const equipmentType = z.enum([
  "appliance",
  "system",
  "exterior",
  "property",
]);

// Property subtype discriminator. Only meaningful when type='property';
// for other types the model returns null. v1 recognizes 'vehicle' (VIN
// plate / car badge) and 'pet' (vet record, microchip card, registration
// document). Other property — TVs, computers, stereos, art — stays
// subtype=null.
const inventorySubtype = z.enum(["vehicle", "pet"]).nullable();

// Bounded label/value lengths exist to prevent the model from returning
// long blobs that would break the detail page's chip layout. 40 chars on
// labels and 120 on values comfortably fit observed nameplate facts like
// "BTU Input" / "40,000" or "Max Working Pressure" / "150 PSI".
const pillSchema = z.object({
  label: z.string().min(1).max(40),
  value: z.string().min(1).max(120),
});

const nameplateBranch = z.object({
  photo_kind: z.literal("nameplate"),
  classification: z.object({
    name: z.string().min(1),
    type: equipmentType,
    subtype: inventorySubtype,
    confidence: z.number().min(0).max(1),
  }),
  extracted: z.object({
    manufacturer: z.string().nullable(),
    model_number: z.string().nullable(),
    serial_number: z.string().nullable(),
    installed_on: z.string().nullable(),
    notes: z.string().nullable(),
    pills: z.array(pillSchema),
  }),
  room_suggestion: z.string().nullable(),
});

const appliancePhotoBranch = z.object({
  photo_kind: z.literal("appliance_photo"),
  classification: z.object({
    name: z.string().min(1),
    type: equipmentType,
    subtype: inventorySubtype,
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
