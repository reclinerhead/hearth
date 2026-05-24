// Local-only debug log for the Superfund portfolio-summary AI call
// (issue #158). Appends one block per call to
// `logs/superfund-summary-prompts.log` so Todd can iterate on the
// prompt and model choice without round-tripping through the
// findings.portfolio_summary jsonb column.
//
// Bundler discipline: this file imports `node:fs/promises` and
// `node:path`. It must NEVER be statically imported by anything in
// the workflow bundler's transitive graph from `workflows/habitat.ts`
// — the bundler blocks Node.js built-ins outside `"use step"`
// boundaries. The habitat workflow imports this module dynamically
// (via `await import(...)`) inside a `"use step"` function, which
// puts the import on the step bundle (which has Node available)
// rather than the workflow bundle (which doesn't).
//
// Gated on `NODE_ENV === "development"` per Todd's request — in
// preview / production we early-return and never touch the
// filesystem. The /logs directory is gitignored, and in those
// environments writes would either fail silently (Vercel's
// read-only-ish function filesystem) or clutter logs with retry
// noise.
//
// All errors are swallowed; a logging failure can never break a
// finding write.

import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";
import type { PortfolioSummaryDebugCapture } from "./portfolio-summary/generate";

export async function writeSuperfundSummaryDebugLog(
  entry: PortfolioSummaryDebugCapture,
): Promise<void> {
  if (process.env.NODE_ENV !== "development") return;
  try {
    const dir = path.join(process.cwd(), "logs");
    await mkdir(dir, { recursive: true });
    const file = path.join(dir, "superfund-summary-prompts.log");

    const block = [
      "================================================================================",
      `Timestamp:    ${entry.startedAt}`,
      `Model:        ${entry.model ?? "(unset)"}`,
      `Duration:     ${entry.durationMs.toFixed(0)} ms`,
      `Status:       ${entry.error ? `error (${entry.error})` : "ok"}`,
      "",
      "--- input ---",
      renderInputBlock(entry.input),
      "",
      "--- system prompt ---",
      entry.systemPrompt ?? "(not assembled — model unset)",
      "",
      "--- user message ---",
      entry.userMessage ?? "(not assembled — model unset)",
      "",
      "--- response (summary text) ---",
      entry.responseText ?? "(no response)",
      "",
      "--- error ---",
      entry.error ?? "(none)",
      "",
      "",
    ].join("\n");

    await appendFile(file, block, "utf8");
  } catch (e) {
    console.warn("[superfund-summary] failed to write debug log:", e);
  }
}

// Render the input shape distinct from the assembled user message so
// Todd can tell at a glance whether iteration changes a model output
// because the input changed or because the prompt did. Mirrors the
// pattern in lib/maintenance/synthesis-debug-log.ts.
function renderInputBlock(
  input: PortfolioSummaryDebugCapture["input"],
): string {
  const lines: string[] = [];
  lines.push(`  state: ${input.state}`);
  lines.push(`  total_qualifying_sites: ${input.total_qualifying_sites}`);
  lines.push(`  portfolio_label: ${input.portfolio_label ?? "(suppressed)"}`);
  lines.push(`  water_source: ${input.water_source ?? "(null)"}`);
  lines.push(
    `  basement_present: ${
      input.basement_present === null || input.basement_present === undefined
        ? "(null)"
        : input.basement_present
          ? "yes"
          : "no"
    }`,
  );
  if (input.sites.length === 0) {
    lines.push("  sites: (none)");
  } else {
    lines.push("  sites:");
    for (const [idx, s] of input.sites.entries()) {
      lines.push(`    ${idx + 1}. ${s.name}`);
      lines.push(
        `       distance: ${s.distance_miles.toFixed(1)} mi ${s.bearing}`,
      );
      lines.push(`       npl_status: ${s.npl_status}${s.archived ? " (archived)" : ""}`);
      lines.push(`       site_label: ${s.site_label ?? "(suppressed)"}`);
      lines.push(
        `       contaminants: ${
          s.contaminants.length === 0
            ? "(none published)"
            : s.contaminants.join(", ")
        }`,
      );
    }
  }
  return lines.join("\n");
}
