/**
 * Headless-Chromium → PDF renderer for the Hearth Reporting pipeline
 * (issue #207). Shared layer: any report type hands it a full HTML
 * document (from `buildReportDocument`) and gets back PDF bytes.
 *
 * Two launch paths, resolved at call time:
 *
 *   - Serverless (Vercel / Lambda): the brotli-compressed Chromium that
 *     ships in @sparticuz/chromium. The binary is force-included into the
 *     function bundle via `outputFileTracingIncludes` in next.config.ts —
 *     without that it deploys missing and fails here at runtime.
 *   - Local dev: a system-installed Chrome / Edge / Chromium. The
 *     @sparticuz binary is Amazon-Linux-only and won't run on Windows or
 *     macOS, so local development (where Todd tests) points puppeteer-core
 *     at the OS browser instead. Override the auto-detected path with the
 *     REPORT_CHROME_EXECUTABLE env var.
 *
 * This module is server-only — it must never be imported into a client
 * bundle (puppeteer-core + @sparticuz/chromium are Node-only).
 */

import "server-only";
import { existsSync } from "node:fs";
import chromium from "@sparticuz/chromium";
import puppeteer, { type Browser } from "puppeteer-core";

/** True when running on Vercel / AWS Lambda (use the bundled Chromium). */
function isServerlessRuntime(): boolean {
  return Boolean(process.env.VERCEL) || Boolean(process.env.AWS_LAMBDA_FUNCTION_NAME);
}

/** Candidate system-browser paths per platform, probed in order for local dev. */
function localBrowserCandidates(): string[] {
  switch (process.platform) {
    case "win32":
      return [
        "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
        "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
        "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
        "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
      ];
    case "darwin":
      return [
        "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
        "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
        "/Applications/Chromium.app/Contents/MacOS/Chromium",
      ];
    default:
      return [
        "/usr/bin/google-chrome",
        "/usr/bin/google-chrome-stable",
        "/usr/bin/chromium",
        "/usr/bin/chromium-browser",
        "/usr/bin/microsoft-edge",
      ];
  }
}

/** Resolve the local-dev browser executable, or throw a clear error. */
function resolveLocalExecutable(): string {
  const override = process.env.REPORT_CHROME_EXECUTABLE;
  if (override && existsSync(override)) return override;
  for (const candidate of localBrowserCandidates()) {
    if (existsSync(candidate)) return candidate;
  }
  throw new Error(
    "Report rendering needs a local Chrome/Edge/Chromium for development. " +
      "None was found at the usual install locations — set REPORT_CHROME_EXECUTABLE " +
      "to your browser's executable path (e.g. the chrome.exe / msedge.exe full path).",
  );
}

async function launchBrowser(): Promise<Browser> {
  if (isServerlessRuntime()) {
    return puppeteer.launch({
      args: chromium.args,
      executablePath: await chromium.executablePath(),
      headless: true,
    });
  }
  return puppeteer.launch({
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
    executablePath: resolveLocalExecutable(),
    headless: true,
  });
}

/**
 * Render a full HTML document to PDF bytes. Page geometry (Letter, margins)
 * is driven entirely by the `@page` rule in the shared stylesheet, so
 * `preferCSSPageSize` is on and no margins are passed here. `printBackground`
 * is required for the dark Hearth theme to render its surfaces.
 *
 * Fonts: setContent waits for `load`, then we await `document.fonts.ready`
 * so the Google-Fonts @import has resolved before the snapshot — otherwise
 * the first render can capture a fallback face.
 */
export async function renderReportPdf(
  html: string,
  footerTemplate?: string,
): Promise<Buffer> {
  const browser = await launchBrowser();
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "load" });
    await page.evaluateHandle("document.fonts.ready");
    // The running footer uses Puppeteer's NATIVE footer (displayHeaderFooter
    // + footerTemplate), which renders inside the reserved bottom page margin
    // on every page — so it never collides with flowing content. A CSS
    // position:fixed footer can't do this (it's content-box-relative and
    // content paints behind it). The bottom margin (18mm) reserves the band;
    // the empty header template suppresses Chromium's default date header.
    const useFooter = typeof footerTemplate === "string" && footerTemplate.length > 0;
    const pdf = await page.pdf({
      printBackground: true,
      format: "letter",
      displayHeaderFooter: useFooter,
      headerTemplate: useFooter ? "<span></span>" : undefined,
      footerTemplate: useFooter ? footerTemplate : undefined,
      margin: { top: "16mm", right: "16mm", bottom: "18mm", left: "16mm" },
    });
    return Buffer.from(pdf);
  } finally {
    await browser.close();
  }
}
