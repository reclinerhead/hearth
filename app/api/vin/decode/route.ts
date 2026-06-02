// Stateless VIN decode route (issue #274).
//
// Companion to /api/inventory/[id]/decode-vin, but with no row to load
// or write: the Smart Uploader review stage calls this *before* the
// inventory row exists, to prefill Manufacturer / Model / Name the
// moment it recognizes a vehicle VIN. Decoding is deterministic and
// free (NHTSA vPIC), so running it eagerly at review time is cheap.
//
// The route is intentionally thin — validate the VIN format, call the
// shared decode core, and hand back the raw result plus the composed
// prefill. Persistence happens later through
// createInventoryFromDocumentAction when the user clicks Save.
//
// Auth: the route is gated by the standard proxy session chain like
// every other /api route; it reads no user data and writes nothing, so
// there is no RLS surface of its own.

import { NextResponse } from "next/server";
import {
  decodeVinFromNhtsa,
  isValidVinFormat,
  type VinDecodeResult,
} from "@/lib/vin-decode/decode";
import { buildVinPrefill, type VinPrefill } from "@/lib/vin-decode/prefill";

export type VinDecodeResponse = {
  result: VinDecodeResult;
  prefill: VinPrefill;
};

export async function POST(req: Request) {
  let body: { vin?: unknown };
  try {
    body = (await req.json()) as { vin?: unknown };
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const vin = typeof body.vin === "string" ? body.vin.trim() : "";
  if (!vin) {
    return NextResponse.json({ error: "A VIN is required." }, { status: 400 });
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

  return NextResponse.json(
    {
      result: decoded.result,
      prefill: buildVinPrefill(decoded.result),
    } satisfies VinDecodeResponse,
    { status: 200 },
  );
}
