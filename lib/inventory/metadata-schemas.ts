// Zod schemas for the hearth.inventory.metadata jsonb bucket.
//
// Per-subtype schema lives here as the single source of truth — the
// edit modal validates user input through these, the VIN-decode route
// writes through these, and any future renderer that reads metadata
// goes through `parseInventoryMetadata` so unexpected shapes fall
// through to an empty bag rather than crashing the page.
//
// New subtypes (electronics, instrument, art) extend this module by
// adding a branch + a parser entry. The DB column stays jsonb — only
// the application layer validates.

import { z } from "zod";

// Vehicle metadata (v1).
//
// VIN itself lives in inventory.serial_number, not in metadata —
// keeping it in the existing column is what lets the Smart Uploader's
// nameplate flow land a photographed VIN with no special-case code.
export const vehicleMetadataSchema = z
  .object({
    license_plate: z.string().min(1).max(16).optional(),
    license_plate_state: z.string().length(2).optional(),
    // model_year stays here (not promoted to a column) because the
    // canonical ground truth for "year" is the manufacturer's
    // model_year as stamped on the VIN — duplicating it as a column
    // would invite drift. Cross-row "vehicles older than 10 years"
    // queries can use a jsonb expression index when they arrive.
    model_year: z.number().int().min(1900).max(2100).optional(),
    purchase_price_cents: z.number().int().min(0).optional(),
    purchased_from: z.string().min(1).max(120).optional(),
    vin_decode: z
      .object({
        source: z.literal("nhtsa_vdecoder"),
        decoded_at: z.string(),
        raw: z.record(z.string(), z.union([z.string(), z.null()])),
      })
      .optional(),
  })
  .partial();

export type VehicleMetadata = z.infer<typeof vehicleMetadataSchema>;

// Pet metadata (v1).
//
// Pets are a property subtype because the conveyance test holds: a pet
// leaves with the owner, not the house. The field set is deliberately
// minimal — the dedicated pet experience (vet records, vaccinations,
// medication renewals) is a follow-up issue. What's here covers the
// table-stakes "what is this animal" without committing to richer
// surfaces.
export const petMetadataSchema = z
  .object({
    species: z.string().min(1).max(40).optional(),
    breed: z.string().min(1).max(80).optional(),
    // ISO date the animal was born. Many adopted pets only have an
    // estimated month — that goes in adopted_on / notes rather than
    // a half-known date here.
    birth_date: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
    adopted_on: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
    color: z.string().min(1).max(80).optional(),
    sex: z.enum(["male", "female", "unknown"]).optional(),
    // Microchip numbers are typically 15 digits (ISO 11784/11785) but
    // older US chips can be 9 or 10 alphanumeric. Don't over-validate.
    microchip_number: z.string().min(1).max(40).optional(),
    vet_name: z.string().min(1).max(120).optional(),
    vet_phone: z.string().min(1).max(40).optional(),
  })
  .partial();

export type PetMetadata = z.infer<typeof petMetadataSchema>;

// VIN validation (17 chars, alphanumeric, excludes I/O/Q to avoid
// ambiguity with 1/0). Used by the VIN-decode action's client-side
// gate before round-tripping to NHTSA — same regex applied
// server-side as defense in depth.
const VIN_REGEX = /^[A-HJ-NPR-Z0-9]{17}$/;

export function isValidVin(raw: string | null | undefined): boolean {
  if (!raw) return false;
  return VIN_REGEX.test(raw.toUpperCase());
}

/**
 * Parse a raw metadata jsonb value into a typed bag for a known
 * subtype. Returns `{}` for any input the schema rejects — the row's
 * metadata may have been written by an older app version, by a
 * future subtype branch, or by a partial draft, and the renderer
 * shouldn't crash on any of those.
 */
export function parseVehicleMetadata(value: unknown): VehicleMetadata {
  const result = vehicleMetadataSchema.safeParse(value ?? {});
  return result.success ? result.data : {};
}

export function parsePetMetadata(value: unknown): PetMetadata {
  const result = petMetadataSchema.safeParse(value ?? {});
  return result.success ? result.data : {};
}
