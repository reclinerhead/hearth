// Dedicated serial-number to manufacture-date decode route (issue #77).
//
// Runs in parallel with the existing /research stream. While research
// streams insights from a fast non-reasoning model (~10s), this route
// calls a reasoning model on a narrow input — manufacturer + model +
// serial — and waits for the full structured response before returning.
// Total runtime is longer (reasoning), but it happens alongside the
// research stream so the user only ever feels the longest of the two.
//
// Persistence policy: write to the new hearth.inventory columns ONLY
// when the reasoning model self-reports confidence === "high". The
// columns are user-visible — a confidently-wrong date is worse than no
// date. Medium/low results are returned to the client (so the toast can
// surface what was attempted) and recorded to the debug log, but the
// row stays null.
//
// Auth: same RLS pattern as every other server-side data access —
// createClient() reads the user's Supabase session from cookies, and
// the inventory SELECT is scoped through hearth.houses.owner_id.

import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { generateObject } from "ai";
import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";
import {
  buildSerialDecodeSystemPrompt,
  buildSerialDecodeUserMessage,
  type SerialDecodeInput,
} from "@/lib/serial-decode/prompt";
import {
  decodeSerialSchema,
  getSerialDecoderModel,
  type DecodeSerialResult,
} from "@/lib/serial-decode/schema";
import { createClient } from "@/lib/supabase/server";

type InventoryRow = {
  id: string;
  manufacturer: string | null;
  model_number: string | null;
  serial_number: string | null;
};

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: inventoryId } = await params;

  const model = getSerialDecoderModel();
  if (!model) {
    return NextResponse.json(
      {
        error:
          "INVENTORY_SERIAL_DECODER_MODEL is not set. Configure it in the environment.",
      },
      { status: 500 },
    );
  }

  const supabase = await createClient();

  const { data: item, error: loadError } = await supabase
    .from("inventory")
    .select("id, manufacturer, model_number, serial_number")
    .eq("id", inventoryId)
    .single();

  if (loadError || !item) {
    return NextResponse.json(
      { error: loadError?.message ?? "Item not found" },
      { status: 404 },
    );
  }

  const typed = item as InventoryRow;
  const serial = typed.serial_number?.trim() ?? "";
  if (!serial) {
    return NextResponse.json({ skipped: "no-serial" }, { status: 200 });
  }

  const input: SerialDecodeInput = {
    manufacturer: typed.manufacturer,
    model_number: typed.model_number,
    serial_number: serial,
  };

  const systemPrompt = buildSerialDecodeSystemPrompt();
  const userMessage = buildSerialDecodeUserMessage(input);

  const startedAt = new Date();
  const startNs = process.hrtime.bigint();

  let result: DecodeSerialResult | null = null;
  let callError: { name: string; message: string } | null = null;

  try {
    const generated = await generateObject({
      model,
      schema: decodeSerialSchema,
      system: systemPrompt,
      messages: [{ role: "user", content: userMessage }],
    });
    result = generated.object;
  } catch (e) {
    callError =
      e instanceof Error
        ? { name: e.name, message: e.message }
        : { name: "unknown", message: String(e) };
  }

  const durationMs = Number(process.hrtime.bigint() - startNs) / 1_000_000;

  // High confidence is the only state we persist to user-visible columns.
  // Medium/low results are returned to the client (for toast / debug) and
  // captured in the log, but never overwrite the row.
  if (result && result.confidence === "high" && result.manufacture_date) {
    const decodedAt = new Date().toISOString();
    const { error: updateError } = await supabase
      .from("inventory")
      .update({
        manufacture_date: result.manufacture_date,
        manufacture_date_precision: result.precision,
        manufacture_date_confidence: result.confidence,
        manufacture_date_decoded_at: decodedAt,
        manufacture_date_model: model,
        manufacture_date_reasoning: result.reasoning,
      })
      .eq("id", inventoryId);

    if (updateError) {
      console.error(
        "[serial-decode] failed to persist manufacture date:",
        updateError.message,
      );
    } else {
      revalidatePath(`/inventory/${inventoryId}`);
    }
  }

  await writeSerialDecodeDebugLog({
    startedAt,
    durationMs,
    model,
    input,
    systemPrompt,
    userMessage,
    response: result,
    error: callError,
  });

  if (callError && !result) {
    return NextResponse.json(
      { error: callError.message },
      { status: 502 },
    );
  }

  return NextResponse.json({ result }, { status: 200 });
}

// ---------------------------------------------------------------------------
// Local-only debug log
// ---------------------------------------------------------------------------
//
// Mirrors the format the insights route writes to ai-insights-prompts.log
// so Todd can compare prompts and models during iteration. All errors are
// swallowed so a logging failure can never break the user request. logs/
// is gitignored.

type SerialDecodeDebugLogEntry = {
  startedAt: Date;
  durationMs: number;
  model: string;
  input: SerialDecodeInput;
  systemPrompt: string;
  userMessage: string;
  response: DecodeSerialResult | null;
  error: { name: string; message: string } | null;
};

async function writeSerialDecodeDebugLog(entry: SerialDecodeDebugLogEntry) {
  try {
    const dir = path.join(process.cwd(), "logs");
    await mkdir(dir, { recursive: true });
    const file = path.join(dir, "serial-decode-prompts.log");

    const block = [
      "================================================================================",
      `Timestamp:    ${entry.startedAt.toISOString()}`,
      `Model:        ${entry.model}`,
      `Duration:     ${entry.durationMs.toFixed(0)} ms`,
      `Status:       ${entry.error ? `error (${entry.error.name}: ${entry.error.message})` : "ok"}`,
      "",
      "--- input ---",
      JSON.stringify(entry.input, null, 2),
      "",
      "--- system prompt ---",
      entry.systemPrompt,
      "",
      "--- user message ---",
      entry.userMessage,
      "",
      "--- response (json) ---",
      entry.response ? JSON.stringify(entry.response, null, 2) : "(no response)",
      "",
      "",
    ].join("\n");

    await appendFile(file, block, "utf8");
  } catch (e) {
    console.warn("[serial-decode] failed to write debug log:", e);
  }
}
