// VIN decode route (issue #23).
//
// Companion to /decode-serial, but for vehicle subtypes. Decoding is
// deterministic — no LLM — so the route is straightforward: load the
// row, validate VIN format, call NHTSA, write the result into
// metadata.vin_decode plus the promoted fields the detail page reads
// (manufacturer, model_number, metadata.model_year) when those are
// empty. Pre-populating only-empty fields avoids overwriting anything
// the user typed by hand.
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

type InventoryRow = {
  id: string;
  type: string;
  subtype: string | null;
  manufacturer: string | null;
  model_number: string | null;
  serial_number: string | null;
  metadata: Record<string, unknown> | null;
};

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: inventoryId } = await params;
  const supabase = await createClient();

  const { data: item, error: loadError } = await supabase
    .from("inventory")
    .select("id, type, subtype, manufacturer, model_number, serial_number, metadata")
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

  // Promote NHTSA's Make / Model / ModelYear into the structured
  // columns when those columns are empty. Anything the user already
  // typed wins — we never silently overwrite user input.
  const updates: Record<string, unknown> = {};
  if (!row.manufacturer && result.raw.Make) {
    updates.manufacturer = toTitleCase(result.raw.Make);
  }
  if (!row.model_number && result.raw.Model) {
    updates.model_number = result.raw.Model;
  }

  const nextMetadata: Record<string, unknown> = {
    ...(row.metadata ?? {}),
    vin_decode: result,
  };
  const existingModelYear =
    typeof nextMetadata.model_year === "number" ? nextMetadata.model_year : null;
  if (!existingModelYear && result.raw.ModelYear) {
    const year = parseInt(result.raw.ModelYear, 10);
    if (!Number.isNaN(year) && year >= 1900 && year <= 2100) {
      nextMetadata.model_year = year;
    }
  }
  updates.metadata = nextMetadata;

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
        manufacturer: updates.manufacturer ?? null,
        model_number: updates.model_number ?? null,
        model_year: nextMetadata.model_year ?? null,
      },
    } satisfies { result: VinDecodeResult; applied: Record<string, unknown> },
    { status: 200 },
  );
}

// NHTSA returns Make / Manufacturer fields in SCREAMING CAPS. Match
// the Hearth voice — Title Case — so the inventory row reads cleanly
// alongside user-entered manufacturers like "Whirlpool" or "Carrier".
function toTitleCase(raw: string): string {
  return raw
    .toLowerCase()
    .split(/(\s+|-)/)
    .map((token) => {
      if (token.length === 0) return token;
      if (/^\s+$/.test(token) || token === "-") return token;
      return token.charAt(0).toUpperCase() + token.slice(1);
    })
    .join("");
}
