// Local-only debug log for the maintenance-synthesis workflow.
// Mirrors lib/inventory-insights's writeInsightsDebugLog — one block per
// call to logs/maintenance-synthesis-prompts.log so Todd can iterate on
// the prompt and model choice without round-tripping through the
// Supabase column. The /logs directory is gitignored, so this file is
// safe to call from the workflow without leaking anything to git.
//
// Gated on `NODE_ENV === "development"` (issue #158) — preview and
// production builds short-circuit before any filesystem touch. The
// developer log is a dev-iteration tool; Vercel's function filesystem
// is read-only-ish and any write attempt would just waste a few ms
// per call and clutter logs with swallowed errors.
//
// All errors are swallowed; a logging failure can never break a
// synthesis run.

import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";
import type { SynthesisInput } from "@/lib/maintenance/synthesis-prompt";
import type { SynthesisOutput } from "@/lib/maintenance/synthesis-schema";

type SynthesisDebugLogEntry = {
  startedAt: Date;
  durationMs: number;
  model: string;
  /** Null on errors that prevented input assembly. */
  input: SynthesisInput | null;
  /** Null on errors that prevented prompt assembly. */
  systemPrompt: string | null;
  /** Null on errors that prevented prompt assembly. */
  userMessage: string | null;
  /** Null when the model call itself failed. */
  response: SynthesisOutput | null;
  /** Error message string, or null on success. */
  error: string | null;
};

export async function writeSynthesisDebugLog(
  entry: SynthesisDebugLogEntry,
): Promise<void> {
  if (process.env.NODE_ENV !== "development") return;
  try {
    const dir = path.join(process.cwd(), "logs");
    await mkdir(dir, { recursive: true });
    const file = path.join(dir, "maintenance-synthesis-prompts.log");

    const inputBlock = entry.input
      ? renderInputBlock(entry.input)
      : "(input not available — see error)";

    const block = [
      "================================================================================",
      `Timestamp:    ${entry.startedAt.toISOString()}`,
      `Model:        ${entry.model || "(unset)"}`,
      `Duration:     ${entry.durationMs.toFixed(0)} ms`,
      `Status:       ${entry.error ? `error (${entry.error})` : "ok"}`,
      "",
      "--- inputs (pre-prompt) ---",
      inputBlock,
      "",
      "--- system prompt ---",
      entry.systemPrompt ?? "(not assembled)",
      "",
      "--- user message ---",
      entry.userMessage ?? "(not assembled)",
      "",
      "--- response (validated) ---",
      entry.response ? JSON.stringify(entry.response, null, 2) : "(no response)",
      "",
      "--- error ---",
      entry.error ?? "(none)",
      "",
      "",
    ].join("\n");

    await appendFile(file, block, "utf8");
  } catch (e) {
    console.warn(
      "[maintenance-synthesis] failed to write debug log:",
      e,
    );
  }
}

// Render the pre-prompt input shape (separate from the assembled user
// message). The two together let Todd see *what data went in* alongside
// *how the prompt assembled it* — fastest path to "is this an input
// problem or a prompt problem?"
function renderInputBlock(input: SynthesisInput): string {
  const lines: string[] = [];
  lines.push("  inventory:");
  lines.push(`    id: ${input.inventory.id}`);
  lines.push(`    name: ${input.inventory.name}`);
  lines.push(`    type: ${input.inventory.type}`);
  lines.push(`    subtype: ${input.inventory.subtype ?? "(null)"}`);
  lines.push(`    manufacturer: ${input.inventory.manufacturer ?? "(null)"}`);
  lines.push(`    model_number: ${input.inventory.model_number ?? "(null)"}`);
  lines.push(`    installed_on: ${input.inventory.installed_on ?? "(null)"}`);
  lines.push(`    purchased_on: ${input.inventory.purchased_on ?? "(null)"}`);
  lines.push("  ai_insights:");
  lines.push(`    headline: ${input.ai_insights.headline}`);
  lines.push(
    `    overview: ${input.ai_insights.overview ? truncate(input.ai_insights.overview) : "(null)"}`,
  );
  lines.push(
    `    service_life: ${input.ai_insights.service_life ? truncate(input.ai_insights.service_life) : "(null)"}`,
  );
  lines.push(
    `    maintenance: ${input.ai_insights.maintenance ? truncate(input.ai_insights.maintenance) : "(null)"}`,
  );
  lines.push(
    `    generated_at: ${input.ai_insights.generated_at ?? "(null)"}`,
  );
  if (input.habitat_findings.length === 0) {
    lines.push("  habitat_findings: (none)");
  } else {
    lines.push("  habitat_findings:");
    for (const f of input.habitat_findings) {
      lines.push(`    - module_key: ${f.module_key}`);
      lines.push(`      severity: ${f.severity}`);
      lines.push(`      headline: ${f.headline}`);
      lines.push(`      summary: ${truncate(f.summary)}`);
    }
  }
  if (input.linked_receipts.length === 0) {
    lines.push("  linked_receipts: (none)");
  } else {
    lines.push("  linked_receipts:");
    for (const r of input.linked_receipts) {
      lines.push(`    - document_id: ${r.document_id}`);
      lines.push(`      transaction_date: ${r.transaction_date ?? "(null)"}`);
      lines.push(`      vendor_name: ${r.vendor_name ?? "(null)"}`);
      lines.push(
        `      transaction_type: ${r.transaction_type ?? "(null)"}`,
      );
      lines.push(
        `      notes: ${r.notes ? truncate(r.notes) : "(null)"}`,
      );
    }
  }
  return lines.join("\n");
}

function truncate(s: string, limit = 240): string {
  if (s.length <= limit) return s;
  return `${s.slice(0, limit)}… (${s.length} chars total)`;
}
