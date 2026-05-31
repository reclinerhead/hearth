/**
 * Shared print theme + document shell for the Hearth Reporting pipeline
 * (issue #207). Every report type rendered through `lib/reports/` inherits
 * this — the design tokens, the three fonts, the page geometry, and the
 * running attribution footer all live here, in the shared layer. Nothing
 * water-specific belongs in this file.
 *
 * The PDF is rendered by headless Chromium from a standalone HTML string,
 * outside Next's font pipeline — so the fonts are pulled from Google Fonts
 * via @import and the design tokens are inlined here rather than read from
 * globals.css. The values are kept in sync with the dark Hearth theme in
 * app/globals.css (`:root` block).
 */

import {
  HEARTH_REPORT_TAGLINE,
  TODDTECH_HEARTH_URL,
} from "./constants";

/**
 * The report's PRINT palette — a white page with Hearth's warm light-theme
 * tokens (mirrored from app/globals.css `:root[data-theme="light"]`). The
 * report is meant to be printed and forwarded, so it uses a white
 * background rather than the app's dark mode: minimal ink, maximum
 * legibility on paper, while staying recognizably Hearth (warm accent,
 * paper-toned surfaces, the three fonts).
 */
export const REPORT_COLORS = {
  bgBase: "#ffffff",
  bgSurface: "#faf6ef",
  bgSurfaceRaised: "#f3ede2",
  borderSubtle: "#e8e0d2",
  borderEmphasis: "#d4c9b6",
  textPrimary: "#1f1a16",
  textSecondary: "#5f574c",
  textTertiary: "#8f857a",
  accent: "#c97a2e",
  warning: "#b5742e",
  info: "#5b7f9a",
  success: "#6e8f60",
  danger: "#a8543f",
  /** The amber the WQA surfaces use for detected/attention rows. */
  amber: "#d97706",
} as const;

/** HTML-escape a string for safe interpolation into the report markup. */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * The shared print stylesheet. Page geometry, base typography, the running
 * footer, and a small set of layout primitives every report can use
 * (`.page-break`, `.eyebrow`, `.surface`, tier pills). Report-specific
 * styling is layered on top by each template's own <style> block.
 *
 * Page geometry note: the bottom margin (22mm) is deliberately larger than
 * the others to reserve a band for the fixed footer. A `position: fixed`
 * element repeats on every printed page in Chromium's paged-media mode AND
 * keeps its anchor clickable as a real PDF link annotation — which is why
 * the footer is a fixed element rather than Puppeteer's footerTemplate
 * (that path renders in a separate context and does NOT produce clickable
 * links). Content flows in the page box above the bottom margin, so the
 * footer never collides with it no matter how far the matrix overflows.
 */
function baseStylesheet(): string {
  const c = REPORT_COLORS;
  return `
@import url('https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,500&family=Inter:wght@400;500&family=JetBrains+Mono:wght@400;500&display=swap');

/* Page size + margins are set via page.pdf() in render.ts (Puppeteer's
   margin option overrides CSS @page margins), so we don't declare them
   here — doing so would just fight the renderer. The bottom margin there
   reserves the band this footer sits in. */

* { box-sizing: border-box; }

html, body {
  margin: 0;
  padding: 0;
  background: ${c.bgBase};
  color: ${c.textPrimary};
  font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  font-size: 11pt;
  line-height: 1.55;
  font-weight: 400;
  -webkit-print-color-adjust: exact;
  print-color-adjust: exact;
}

h1, h2, h3 {
  font-family: 'Fraunces', Georgia, serif;
  font-weight: 400;
  color: ${c.textPrimary};
  margin: 0;
  line-height: 1.18;
}
h1 { font-size: 26pt; letter-spacing: -0.01em; }
h2 { font-size: 16pt; }
h3 { font-size: 12.5pt; font-weight: 500; }

p { margin: 0; }
a { color: ${c.accent}; text-decoration: none; }

.eyebrow {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 7.5pt;
  font-weight: 500;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: ${c.textTertiary};
}

.mono { font-family: 'JetBrains Mono', ui-monospace, monospace; }
.muted { color: ${c.textSecondary}; }
.faint { color: ${c.textTertiary}; }

.surface {
  background: ${c.bgSurface};
  border: 1px solid ${c.borderSubtle};
  border-radius: 8px;
}
.surface-raised {
  background: ${c.bgSurfaceRaised};
  border: 1px solid ${c.borderSubtle};
  border-radius: 8px;
}

/* A page break before the element — used to force the matrix and the
   next-steps ladder onto fresh pages where the content warrants it. */
.page-break { break-before: page; }

/* Keep a block from being split across a page boundary where splitting
   would orphan a heading from its content. Applied selectively. */
.keep-together { break-inside: avoid; }
`;
}

/**
 * Running attribution footer, rendered via Puppeteer's native footer
 * (`displayHeaderFooter` + `footerTemplate`) — NOT a CSS element. This is
 * deliberate: a CSS `position: fixed` footer is positioned relative to the
 * content box in Chromium's paged mode and flowing content paints behind it
 * on every page (there is no per-page space reservation in CSS). The native
 * footer renders inside the reserved bottom page margin on every page, so it
 * never collides with content no matter how far the matrix overflows.
 *
 * Tradeoff: the native footer renders in a separate context, so it does NOT
 * inherit the document fonts/CSS (hence the inline styles + generic
 * `monospace`) and its `<a>` is not guaranteed to be a clickable PDF
 * annotation across Chromium versions. The brand + URL are shown as text so
 * the soft-referral survives regardless; an in-flow clickable ToddTech link
 * also rides at the end of the document body (see `buildReportDocument`).
 *
 * Single subtle line:
 *   Hearth — Home Awareness · Generated for {address} · Powered by ToddTech
 */
export function buildReportFooterTemplate(address: string): string {
  const c = REPORT_COLORS;
  // font-size is set explicitly (Puppeteer footers default to a near-0
  // size) and sized to fill one line across the page; the lead brand
  // segment gets the warm gold + weight so it stands out as the credit.
  return `<div style="width:100%;padding:0 10mm;box-sizing:border-box;font-family:'JetBrains Mono',ui-monospace,monospace;font-size:9.5px;letter-spacing:0.02em;color:${c.textTertiary};text-align:center;white-space:nowrap;"><span style="color:${c.accent};font-weight:700;">Hearth — ${escapeHtml(
    HEARTH_REPORT_TAGLINE,
  )}</span> &nbsp;·&nbsp; Generated for ${escapeHtml(
    address,
  )} &nbsp;·&nbsp; Powered by <a href="${TODDTECH_HEARTH_URL}" style="color:${c.textTertiary};text-decoration:underline;">ToddTech</a></div>`;
}

/**
 * The shared in-flow attribution credit. Rides once at the very end of the
 * document body (last page) as a normal flow element, so its "Powered by
 * ToddTech" anchor is a guaranteed-clickable PDF link — the running per-page
 * footer (a native Puppeteer footer) carries the same brand text but can't
 * promise clickable links. Shared layer; report templates never render it.
 */
function inFlowCredit(): string {
  const c = REPORT_COLORS;
  return `<div style="margin-top:18px;padding-top:10px;border-top:1px solid ${c.borderSubtle};font-family:'JetBrains Mono',ui-monospace,monospace;font-size:7pt;letter-spacing:0.04em;color:${c.textTertiary};text-align:center;">Powered by <a href="${TODDTECH_HEARTH_URL}" style="color:${c.textTertiary};border-bottom:1px solid ${c.borderEmphasis};text-decoration:none;">ToddTech</a></div>`;
}

/**
 * Wrap a report body (the page-composition HTML a specific report template
 * produces) in the full standalone HTML document Chromium renders: the
 * shared print theme, the template's own scoped styles, and the in-flow
 * attribution credit. The running per-page footer is added separately by the
 * renderer via `buildReportFooterTemplate`. This is the single entry point
 * report templates use — they never reimplement the footer or the shell.
 */
export function buildReportDocument(args: {
  /** Document <title>; also used by Chromium as the PDF title metadata. */
  title: string;
  /** The report's page-composition HTML (the <body> inner content). */
  bodyHtml: string;
  /** Optional report-specific CSS appended after the shared stylesheet. */
  templateCss?: string;
}): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>${escapeHtml(args.title)}</title>
<style>${baseStylesheet()}${args.templateCss ?? ""}</style>
</head>
<body>
${args.bodyHtml}
${inFlowCredit()}
</body>
</html>`;
}
