#!/usr/bin/env node
/**
 * Copies the pdfjs-dist web worker bundle into `public/pdfjs/` so the
 * browser can load it via the static path `/pdfjs/pdf.worker.min.mjs`
 * — see [`lib/documents/process-pdf.ts`](../lib/documents/process-pdf.ts).
 *
 * Why this script exists. The pdfjs canonical worker-loading pattern
 * (`new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url)`)
 * triggers an `empty-import-meta` warning when the Vercel Workflow
 * bundler transitively reaches our client-only PDF helper through the
 * habitat-module registry (workflows/habitat.ts → registry → WQA
 * index.ts → renderOverviewBody → WqaOverviewBody → CcrUploadModal →
 * use-ccr-upload → process-pdf.ts). The workflow bundle outputs CJS,
 * which doesn't support `import.meta`. The code is never executed by
 * the workflow (it's a browser-only path), but the warning is noisy
 * and the bundle is bigger than it needs to be.
 *
 * The static-path pattern avoids both problems — the worker URL is a
 * plain string, no bundler resolution needed.
 *
 * Runs from `postinstall` so the worker is present after a fresh
 * `pnpm install`, and so Vercel preview builds find it without us
 * committing a ~1MB minified bundle to git.
 */

import { copyFile, mkdir, stat } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");

const source = resolve(
  repoRoot,
  "node_modules/pdfjs-dist/build/pdf.worker.min.mjs",
);
const targetDir = resolve(repoRoot, "public/pdfjs");
const target = resolve(targetDir, "pdf.worker.min.mjs");

async function main() {
  try {
    await stat(source);
  } catch {
    // pdfjs-dist isn't installed yet (this can happen during the first
    // postinstall run on a fresh clone before all packages are linked).
    // Silently exit — the next install pass will succeed, and CI runs
    // postinstall after dependency installation is complete.
    process.stderr.write(
      `[copy-pdfjs-worker] skipped — pdfjs-dist not installed at ${source}\n`,
    );
    return;
  }
  await mkdir(targetDir, { recursive: true });
  await copyFile(source, target);
  process.stdout.write(
    `[copy-pdfjs-worker] copied ${source} → ${target}\n`,
  );
}

main().catch((err) => {
  process.stderr.write(`[copy-pdfjs-worker] failed: ${err}\n`);
  process.exit(1);
});
