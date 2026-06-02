// VIN decode route (issue #23).
//
// Companion to /decode-serial, but for vehicle subtypes. Decoding is
// deterministic — no LLM — so the route is straightforward: load the
// row, validate VIN format, call NHTSA, write the result.
//
// Persistence policy:
//   - `metadata.vin_decode` always overwrites with the fresh payload
//     (the user clicked "Re-decode", so they explicitly want the
//     latest read).
//   - Structured columns (`manufacturer`, `model_number`, the row's
//     `name`, `metadata.model_year`, and the six manufacture-date
//     columns) are only filled when currently empty. User input
//     always wins; the decode is an enrichment, not an override.
//   - The `name` rewrite is the exception by user request (Todd, in
//     the issue #23 follow-up): when the user has cleared or never
//     personalized the name (e.g. it's still a generic "Truck" or
//     matches the manufacturer / model pattern), we rewrite it to
//     `YYYY Make Model` so the dashboard tile reads cleanly. A name
//     the user clearly personalized (anything else) is preserved.
//
// Auth: standard RLS pattern — createClient() reads the user's Supabase
// session, and the inventory SELECT/UPDATE both scope through
// hearth.houses.owner_id.

import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  decodeVinFromNhtsa,
  isValidVinFormat,
  type VinDecodeResult,
} from "@/lib/vin-decode/decode";
import {
  composeVehicleName,
  isGenericVehicleName,
  parseModelYear,
  toTitleCase,
} from "@/lib/vin-decode/prefill";

type InventoryRow = {
  id: string;
  type: string;
  subtype: string | null;
  name: string;
  manufacturer: string | null;
  model_number: string | null;
  serial_number: string | null;
  metadata: Record<string, unknown> | null;
  manufacture_date: string | null;
};

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: inventoryId } = await params;
  const supabase = await createClient();

  const { data: item, error: loadError } = await supabase
    .from("inventory")
    .select(
      "id, type, subtype, name, manufacturer, model_number, serial_number, metadata, manufacture_date",
    )
    .eq("id", inventoryId)
    .single();

  if (loadError || !item) {
    return NextResponse.json(
      { error: loadError?.message ?? "Item not found" },
      { status: 404 },
    );
  }

  const row = item as InventoryRow;
  if (row.type !== "property" || row.subtype !== "vehicle") {
    return NextResponse.json(
      { error: "VIN decode is only available for property/vehicle items." },
      { status: 400 },
    );
  }
  const vin = row.serial_number?.trim() ?? "";
  if (!vin) {
    return NextResponse.json(
      { error: "Add a VIN to this vehicle before decoding." },
      { status: 400 },
    );
  }
  if (!isValidVinFormat(vin)) {
    return NextResponse.json(
      { error: "That doesn't look like a valid 17-character VIN." },
      { status: 400 },
    );
  }

  const decoded = await decodeVinFromNhtsa(vin);
  if (!decoded.ok) {
    const status = decoded.error.kind === "invalid-format" ? 400 : 502;
    const message =
      decoded.error.kind === "invalid-format"
        ? "That doesn't look like a valid 17-character VIN."
        : decoded.error.message;
    return NextResponse.json({ error: message }, { status });
  }

  const result = decoded.result;
  const decodedMake = result.raw.Make ?? null;
  const decodedModel = result.raw.Model ?? null;
  const decodedYearStr = result.raw.ModelYear ?? null;
  const decodedYear = parseModelYear(decodedYearStr);

  const updates: Record<string, unknown> = {};
  const titleCasedMake = decodedMake ? toTitleCase(decodedMake) : null;

  // Promote NHTSA's Make / Model into the structured columns when
  // those columns are empty. Anything the user already typed wins —
  // we never silently overwrite user input on these.
  if (!row.manufacturer && titleCasedMake) {
    updates.manufacturer = titleCasedMake;
  }
  if (!row.model_number && decodedModel) {
    updates.model_number = decodedModel;
  }

  // Update metadata: always overwrite vin_decode (the user clicked
  // "decode" — they want the latest); only set model_year when empty.
  const nextMetadata: Record<string, unknown> = {
    ...(row.metadata ?? {}),
    vin_decode: result,
  };
  const existingModelYear =
    typeof nextMetadata.model_year === "number" ? nextMetadata.model_year : null;
  if (!existingModelYear && decodedYear !== null) {
    nextMetadata.model_year = decodedYear;
  }
  updates.metadata = nextMetadata;

  // Rewrite the row's `name` when it looks generic or empty, so the
  // dashboard tile reads "2018 Toyota Land Cruiser" instead of
  // "Truck". A clearly-personalized name (e.g. "Beth's Car") is
  // preserved — see isGenericVehicleName for the heuristic.
  const effectiveMake = titleCasedMake ?? row.manufacturer;
  const effectiveModel = decodedModel ?? row.model_number;
  const candidateName = composeVehicleName({
    year: decodedYear,
    make: effectiveMake,
    model: effectiveModel,
  });
  if (
    candidateName &&
    isGenericVehicleName(row.name) &&
    candidateName !== row.name
  ) {
    updates.name = candidateName;
  }

  // Write the model year into the manufacture-date columns when
  // they're currently empty. Year precision, high confidence, model
  // tag `vin-decode-nhtsa` so the source is traceable — same shape
  // as the serial-decode pipeline so the detail page's "Manufactured"
  // tile fallback in pickFirstDateTile lights up for vehicles too.
  // Anything already in the manufacture-date columns (user-entered
  // or decoded from a prior serial-decode run) is preserved.
  if (!row.manufacture_date && decodedYear !== null) {
    updates.manufacture_date = String(decodedYear);
    updates.manufacture_date_precision = "year";
    updates.manufacture_date_confidence = "high";
    updates.manufacture_date_decoded_at = new Date().toISOString();
    updates.manufacture_date_model = "vin-decode-nhtsa";
    updates.manufacture_date_reasoning =
      "Derived from VIN position 10 via NHTSA DecodeVinValues.";
  }

  const { error: updateError } = await supabase
    .from("inventory")
    .update(updates)
    .eq("id", inventoryId);

  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 500 });
  }

  revalidatePath(`/inventory/${inventoryId}`);

  return NextResponse.json(
    {
      result,
      applied: {
        manufacturer: (updates.manufacturer as string | undefined) ?? null,
        model_number: (updates.model_number as string | undefined) ?? null,
        model_year: nextMetadata.model_year ?? null,
        name: (updates.name as string | undefined) ?? null,
        manufacture_date: (updates.manufacture_date as string | undefined) ?? null,
      },
    } satisfies { result: VinDecodeResult; applied: Record<string, unknown> },
    { status: 200 },
  );
}
