/**
 * One-off operational cleanup (issue #264): delete every `kind='receipt'`
 * document from a single house — rows AND storage bytes — while leaving
 * nameplate/photo documents and all inventory items untouched.
 *
 * This uses the Storage API (not raw `storage.objects` SQL), so the
 * actual file bytes are removed, not just the metadata rows. The
 * document_pages rows of multi-page receipts cascade automatically when
 * the parent documents row is deleted.
 *
 * USAGE (from the repo root):
 *   1. Preview (no changes made):
 *        pnpm tsx scripts/cleanup-receipts.ts
 *   2. Actually delete:
 *        pnpm tsx scripts/cleanup-receipts.ts --confirm
 *
 * Scoped to HOUSE_ID below. Safe to delete this file after you've run it.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";

// ---- Config -------------------------------------------------------------

const HOUSE_ID = "0f8516d2-7098-4483-8857-055fc6ab346f";
const BUCKET = "hearth-documents";
const CONFIRM = process.argv.includes("--confirm");

// ---- Minimal .env.local loader -----------------------------------------
// A standalone tsx script doesn't get Next.js's automatic env loading, so
// we read .env.local ourselves. Only sets vars that aren't already set.

function loadEnvLocal() {
  let raw: string;
  try {
    raw = readFileSync(resolve(process.cwd(), ".env.local"), "utf8");
  } catch {
    console.error(
      "Could not read .env.local in the current directory. Run this from the repo root (C:\\WEBDEV\\hearth).",
    );
    process.exit(1);
  }
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
}

// ---- Main ---------------------------------------------------------------

async function main() {
  loadEnvLocal();

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    console.error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local. Run `vercel env pull` and try again.",
    );
    process.exit(1);
  }

  // Service-role client, default schema 'hearth' — same config as
  // lib/supabase/service.ts. Bypasses RLS, so every query below is
  // explicitly scoped by house_id.
  const supabase = createClient(url, serviceKey, {
    db: { schema: "hearth" },
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // 1. Find the receipt documents for this house only.
  const { data: docs, error: docsError } = await supabase
    .from("documents")
    .select("id, original_filename, status, inventory_id, created_at")
    .eq("house_id", HOUSE_ID)
    .eq("kind", "receipt")
    .order("created_at");

  if (docsError) {
    console.error("Failed to load receipt documents:", docsError.message);
    process.exit(1);
  }
  if (!docs || docs.length === 0) {
    console.log("No receipt documents found for this house. Nothing to do.");
    return;
  }

  console.log(
    `\nFound ${docs.length} receipt document(s) in house ${HOUSE_ID}:\n`,
  );
  for (const d of docs) {
    console.log(
      `  • ${d.id}  ${d.original_filename ?? "(no filename)"}  [status=${d.status}, inventory_id=${d.inventory_id ?? "none"}]`,
    );
  }

  // 2. Enumerate the storage objects under each receipt's directory.
  const removals: { documentId: string; paths: string[] }[] = [];
  for (const d of docs) {
    const directory = `${HOUSE_ID}/${d.id}`;
    const { data: files, error: listError } = await supabase.storage
      .from(BUCKET)
      .list(directory);
    if (listError) {
      console.warn(
        `  ! Could not list storage for ${d.id}: ${listError.message}`,
      );
      continue;
    }
    const paths = (files ?? []).map((f) => `${directory}/${f.name}`);
    removals.push({ documentId: d.id, paths });
  }

  const totalFiles = removals.reduce((n, r) => n + r.paths.length, 0);
  console.log(`\nStorage objects to remove (${totalFiles} total):`);
  for (const r of removals) {
    for (const p of r.paths) console.log(`  • ${p}`);
  }

  if (!CONFIRM) {
    console.log(
      "\n[DRY RUN] No changes made. Re-run with --confirm to delete the files and rows:\n  pnpm tsx scripts/cleanup-receipts.ts --confirm\n",
    );
    return;
  }

  // 3. Delete storage bytes (Storage API → removes the real files).
  console.log("\nDeleting storage objects…");
  for (const r of removals) {
    if (r.paths.length === 0) continue;
    const { error: removeError } = await supabase.storage
      .from(BUCKET)
      .remove(r.paths);
    if (removeError) {
      console.warn(
        `  ! Storage delete failed for ${r.documentId}: ${removeError.message}`,
      );
    } else {
      console.log(`  ✓ Removed ${r.paths.length} file(s) for ${r.documentId}`);
    }
  }

  // 4. Delete the document rows (cascades document_pages).
  const ids = docs.map((d) => d.id);
  console.log("\nDeleting document rows…");
  const { error: deleteError } = await supabase
    .from("documents")
    .delete()
    .in("id", ids);

  if (deleteError) {
    console.error("Row delete failed:", deleteError.message);
    process.exit(1);
  }

  console.log(`  ✓ Deleted ${ids.length} receipt document row(s).`);
  console.log("\nDone. Re-uploading the previously-colliding receipt should now succeed.\n");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
