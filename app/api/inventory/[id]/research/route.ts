// Streaming route handler for the "Research this model" feature.
// Replaces the previous researchInventoryModelAction server action so
// the AI SDK's structured-object stream can be piped straight to the
// client and consumed by useObject — the user starts seeing the
// headline + first section within seconds instead of waiting on a
// spinner for the full call to complete.
//
// The DB write lives in the streamObject onFinish callback so it
// happens server-side regardless of whether the client is still
// connected... well, almost. Vercel Fluid Compute propagates client
// cancellation to the function, so if the user navigates away
// mid-stream the call is killed and the result is discarded. That's
// the known Phase-1 trade-off; a fully decoupled Phase-2 implementation
// would lift the call into Vercel Workflow (see workflows/briefing.ts
// for the pattern).
//
// Auth is the same RLS pattern as every other server-side data access:
// createClient() reads the user's Supabase session from cookies, and
// the inventory SELECT is scoped through hearth.houses.owner_id.

import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { streamObject } from "ai";
import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";
import {
  buildResearchSystemPrompt,
  buildResearchUserMessage,
  type ResearchInventoryInput,
} from "@/lib/inventory-insights/prompt";
import {
  getInventoryInsightsModel,
  insightsSchema,
  type InsightsResult,
} from "@/lib/inventory-insights/research";
import { createClient } from "@/lib/supabase/server";

type InventoryItemRow = {
  id: string;
  name: string;
  type: "appliance" | "system" | "exterior";
  manufacturer: string | null;
  model_number: string | null;
  serial_number: string | null;
  notes: string | null;
  ai_pills: { label: string; value: string }[] | null;
};

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: inventoryId } = await params;

  const model = getInventoryInsightsModel();
  if (!model) {
    return NextResponse.json(
      {
        error:
          "Neither INVENTORY_INSIGHTS_MODEL nor BRIEFING_PRIMARY_MODEL is set.",
      },
      { status: 500 },
    );
  }

  const supabase = await createClient();

  const { data: item, error: loadError } = await supabase
    .from("inventory")
    .select(
      "id, name, type, manufacturer, model_number, serial_number, notes, ai_pills",
    )
    .eq("id", inventoryId)
    .single();

  if (loadError || !item) {
    return NextResponse.json(
      { error: loadError?.message ?? "Item not found" },
      { status: 404 },
    );
  }

  const typed = item as InventoryItemRow;

  const input: ResearchInventoryInput = {
    manufacturer: typed.manufacturer,
    model_number: typed.model_number,
    serial_number: typed.serial_number,
    inventory_name: typed.name,
    inventory_type: typed.type,
    ai_pills: typed.ai_pills,
    notes: typed.notes,
  };

  const systemPrompt = buildResearchSystemPrompt();
  const userMessage = buildResearchUserMessage(input);

  const startedAt = new Date();
  const startNs = process.hrtime.bigint();

  const result = streamObject({
    model,
    schema: insightsSchema,
    system: systemPrompt,
    messages: [{ role: "user", content: userMessage }],
    onFinish: async ({ object, error }) => {
      const durationMs = Number(process.hrtime.bigint() - startNs) / 1_000_000;

      const validated: InsightsResult | null = object ?? null;
      const generated_at = new Date().toISOString();

      if (validated) {
        const writeSupabase = await createClient();
        const { error: updateError } = await writeSupabase
          .from("inventory")
          .update({
            ai_insights: {
              headline: validated.headline,
              overview: validated.overview,
              service_life: validated.service_life,
              maintenance: validated.maintenance,
              source_urls: validated.source_urls,
              found_specific_model: validated.found_specific_model,
              generated_at,
              model_used: model,
            },
          })
          .eq("id", inventoryId);

        if (updateError) {
          console.error(
            "[inventory-insights] failed to persist insights:",
            updateError.message,
          );
        } else {
          revalidatePath(`/inventory/${inventoryId}`);
        }
      }

      await writeInsightsDebugLog({
        startedAt,
        durationMs,
        model,
        input,
        systemPrompt,
        userMessage,
        response: validated,
        error: error
          ? error instanceof Error
            ? { name: error.name, message: error.message }
            : { name: "unknown", message: String(error) }
          : null,
      });
    },
  });

  return result.toTextStreamResponse();
}

// ---------------------------------------------------------------------------
// Local-only debug log
// ---------------------------------------------------------------------------
//
// Mirrors the format the previous research.ts wrote — one block per call
// to logs/ai-insights-prompts.log so Todd can compare prompts and models
// during iteration. Gated on `NODE_ENV === "development"` (issue #158)
// so preview / production builds skip the filesystem touch entirely.
// All errors are swallowed so a logging failure can never break the
// user request. logs/ is gitignored.

type InsightsDebugLogEntry = {
  startedAt: Date;
  durationMs: number;
  model: string;
  input: ResearchInventoryInput;
  systemPrompt: string;
  userMessage: string;
  response: InsightsResult | null;
  error: { name: string; message: string } | null;
};

async function writeInsightsDebugLog(entry: InsightsDebugLogEntry) {
  if (process.env.NODE_ENV !== "development") return;
  try {
    const dir = path.join(process.cwd(), "logs");
    await mkdir(dir, { recursive: true });
    const file = path.join(dir, "ai-insights-prompts.log");

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
    console.warn("[inventory-insights] failed to write debug log:", e);
  }
}
