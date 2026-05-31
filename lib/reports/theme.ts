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

@page {
  size: Letter;
  margin: 16mm 16mm 22mm 16mm;
}

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

/* Running attribution footer — shared layer, every page. Pinned into the
   bottom @page margin band. The "Powered by ToddTech" anchor is a real,
   clickable PDF link to the Hearth portfolio page. */
.report-footer {
  position: fixed;
  left: 0;
  right: 0;
  bottom: 6mm;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 6.5pt;
  font-weight: 400;
  letter-spacing: 0.04em;
  color: ${c.textTertiary};
  text-align: center;
}
.report-footer a {
  color: ${c.textTertiary};
  text-decoration: none;
  border-bottom: 1px solid ${c.borderEmphasis};
}
.report-footer .sep { opacity: 0.5; padding: 0 0.5em; }
`;
}

/**
 * The running attribution footer markup. Single subtle line:
 *   Hearth — Home Awareness · Generated for {address} · Powered by ToddTech
 * "Powered by ToddTech" links to the Hearth portfolio page.
 */
function footerHtml(address: string): string {
  return `
<div class="report-footer">
  Hearth — ${escapeHtml(HEARTH_REPORT_TAGLINE)}<span class="sep">·</span>Generated for ${escapeHtml(
    address,
  )}<span class="sep">·</span>Powered by <a href="${TODDTECH_HEARTH_URL}">ToddTech</a>
</div>`;
}

/**
 * Wrap a report body (the page-composition HTML a specific report template
 * produces) in the full standalone HTML document Chromium renders: the
 * shared print theme, the template's own scoped styles, and the running
 * footer. This is the single entry point report templates use — they never
 * reimplement the footer or the document shell.
 */
export function buildReportDocument(args: {
  /** Document <title>; also used by Chromium as the PDF title metadata. */
  title: string;
  /** The full address line shown in the running footer. */
  address: string;
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
${footerHtml(args.address)}
</body>
</html>`;
}
