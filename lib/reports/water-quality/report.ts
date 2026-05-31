/**
 * Water Quality Report — page composition (issue #207, WQA-R1).
 *
 * Pure: it takes the data the route already loaded off the persisted WQA
 * finding and returns a full standalone HTML document (via the shared
 * `buildReportDocument`). No I/O, no LLM — every number, tier, and
 * explanation is deterministic; the one orienting sentence is templated.
 * That purity is what makes the report cacheable (the route hashes the
 * finding's content version + the two versions below into a signature).
 *
 * Structure is awareness → agency → involvement, never the reverse — the
 * homeowner ends on *what to do*, not *what to fear*:
 *   1. Awareness  — header + "Detected in your water" (summarizer order).
 *   2. Agency     — recommended combination + the full remediation matrix.
 *   3. Involvement— learn → act → involve, utility contact, disclosure.
 *
 * The running attribution footer and the document shell are the shared
 * layer's job (`buildReportDocument`); nothing here reimplements them.
 */

import {
  type CcrSummarizedContaminant,
  type CcrContaminantTier,
} from "@/lib/habitat/modules/water-quality-awareness/ccr";
import type { CcrFreeTestingOffer } from "@/lib/documents/ai/ccr-schema";
import { findWqaContaminantByAlias } from "@/lib/habitat/water-quality/contaminants/lookup";
import {
  betterEffectiveness,
  type RemediationEffectiveness,
} from "@/lib/habitat/water-quality/remediation/matrix";
import {
  personalizeRemediationMatrix,
  recommendRemediationCombination,
  type DetectedContaminantInput,
} from "@/lib/habitat/water-quality/remediation/recommend";
import {
  groupPfasFamily,
  PFAS_FAMILY_HEADING,
  type AwarenessItem,
} from "@/lib/habitat/water-quality/contaminants/pfas-grouping";
import { buildReportDocument, escapeHtml, REPORT_COLORS } from "../theme";
import { computeReportSignature } from "../signature";

/** report_type discriminator for the cache pointer + storage path. */
export const WATER_QUALITY_REPORT_TYPE = "water_quality";

/**
 * Template version — bump on any layout / copy / composition change so a
 * cached PDF rendered by an older template regenerates on the next request.
 */
export const WATER_QUALITY_TEMPLATE_VERSION = "v3";

/**
 * Static reference-data version — bump when the contaminant reference
 * (descriptions / learn_more_url) or the remediation matrix changes in a
 * way that should invalidate already-cached PDFs.
 */
export const WATER_QUALITY_REFERENCE_VERSION = "ref-2026-06";

export type WaterQualityReportInput = {
  /** Full single-line address, shown in the header and the running footer. */
  address: string;
  /** Human report date, e.g. "May 31, 2026". Computed by the route (no Date in pure code). */
  reportDateLabel: string;
  utilityName: string | null;
  /**
   * Public Water Supply ID. Surfaced (spelled out) in the utility-contact
   * block as a useful lookup key for the homeowner — a deliberate, scoped
   * exception to the general "never surface machine identifiers" rule,
   * approved for this report surface (issue #207). Null when unresolved.
   */
  pwsid: string | null;
  /** Readable source-water phrase, e.g. "ground water" / "surface water". */
  sourceWaterLabel: string | null;
  /** Coverage year of the CCR this was derived from. */
  reportYear: number | null;
  /** Detected contaminants in the summarizer's existing order (concern → caution → context). */
  contaminants: CcrSummarizedContaminant[];
  /** Normalized detections feeding the remediation matrix personalization. */
  detected: DetectedContaminantInput[];
  freeTestingOffer: CcrFreeTestingOffer | null;
  /**
   * Whether EPA's SDWIS was a data source (true for an identified public
   * water system — its identity, compliance, and lead/copper records come
   * from SDWIS). Drives a "Where this data comes from" bullet.
   */
  usedSdwis: boolean;
  /**
   * Provenance of the uploaded CCR for the "Where this data comes from"
   * list. `uploadedByName` is only set when the uploader is the person
   * generating the report (we don't surface another household's name on a
   * forwardable document). Null when no CCR provenance is available.
   */
  ccrProvenance: {
    year: number | null;
    uploadedByName: string | null;
    uploadedOnLabel: string | null;
  } | null;
  adminContact: { name: string | null; email: string | null; phone: string | null } | null;
  /** Utility's CCR archive URL when known; omitted from the contact block otherwise. */
  ccrArchiveUrl: string | null;
};

/**
 * Cache signature parts for this report. The finding's content version
 * (`checkedAt`, which moves when the WQA module re-runs against a new CCR
 * or an SDWIS/LCR refresh) plus the two static versions above. A change to
 * any of these produces a fresh PDF on the next request; nothing else does.
 */
export function waterQualityReportSignature(checkedAt: string | null): string {
  return computeReportSignature([
    checkedAt,
    WATER_QUALITY_REFERENCE_VERSION,
    WATER_QUALITY_TEMPLATE_VERSION,
  ]);
}

// --- verbal tier cues ------------------------------------------------------

/** Map the summarizer's tier to its verbal cue + color. */
function tierCue(tier: CcrContaminantTier): { label: string; color: string } {
  switch (tier) {
    case "concern":
      return { label: "Worth acting on", color: REPORT_COLORS.amber };
    case "caution":
      return { label: "Worth knowing", color: REPORT_COLORS.amber };
    case "context":
    default:
      return { label: "Context", color: REPORT_COLORS.textTertiary };
  }
}

function formatLevel(level: number | null, unit: string | null): string | null {
  if (level === null || level === undefined) return null;
  return unit ? `${level} ${unit}` : `${level}`;
}

// --- remediation matrix cell states ---------------------------------------

/**
 * The four cell states, rendered distinctly. The unreliable-vs-none
 * distinction is the one a non-expert gets wrong (carbon-and-PFAS is
 * "unreliable," not "none"), so the two never share a glyph or color.
 */
function effCell(eff: RemediationEffectiveness): { glyph: string; color: string; cls: string } {
  switch (eff) {
    case "full":
      return { glyph: "●", color: REPORT_COLORS.success, cls: "eff-full" };
    case "partial":
      return { glyph: "◐", color: REPORT_COLORS.accent, cls: "eff-partial" };
    case "unreliable":
      return { glyph: "△", color: REPORT_COLORS.danger, cls: "eff-unreliable" };
    case "none":
    default:
      return { glyph: "—", color: REPORT_COLORS.textTertiary, cls: "eff-none" };
  }
}

const DISPLAY_COLUMNS: Array<{ key: string; label: string }> = [
  { key: "carbon_block", label: "Carbon block" },
  { key: "pitcher", label: "Pitcher" },
  { key: "reverse_osmosis", label: "RO" },
  { key: "ion_exchange", label: "Softener" },
  { key: "distill_uv", label: "Distill / UV" },
];

function effForColumn(
  effectiveness: Record<string, RemediationEffectiveness>,
  columnKey: string,
): RemediationEffectiveness {
  if (columnKey === "distill_uv") {
    return betterEffectiveness(effectiveness.distillation, effectiveness.uv);
  }
  return effectiveness[columnKey];
}

// --- PFAS family grouping (issue #234; shared logic in contaminants/pfas-grouping) ---

function renderAwarenessItem(item: AwarenessItem): string {
  return item.kind === "pfasFamily"
    ? pfasFamilyCard(item.analytes)
    : contaminantRow(item.contaminant);
}

/**
 * The PFAS family card: one family explanation + one EPA link (both from the
 * "PFAS" family reference entry), with each detected analyte listed beneath
 * (as printed on the CCR — its name is already the human-readable spelled-out
 * form). Mirrors the single-row level/limit treatment.
 */
function pfasFamilyCard(analytes: CcrSummarizedContaminant[]): string {
  const cue = tierCue("caution"); // PFAS is floored at the caution tier
  const ref = findWqaContaminantByAlias("PFAS"); // family reference entry
  const body = ref?.description
    ? `<p class="why muted">${escapeHtml(ref.description)}</p>`
    : "";
  const link = ref?.learn_more_url
    ? `<a class="epa-link mono" href="${ref.learn_more_url}">EPA reference →</a>`
    : "";
  const analyteRows = analytes
    .map((c) => {
      const level = formatLevel(c.detected_level, c.unit);
      const mcl = formatLevel(c.mcl, c.unit);
      const measure = level
        ? `<span class="an-measure mono">${escapeHtml(level)}${
            mcl ? ` <span class="faint">/ ${escapeHtml(mcl)} limit</span>` : ""
          }</span>`
        : "";
      return `<div class="pfas-analyte"><span class="an-name">${escapeHtml(
        c.contaminant_name,
      )}</span>${measure}</div>`;
    })
    .join("");

  return `
<div class="contaminant keep-together">
  <div class="contaminant-head">
    <span class="cn">${escapeHtml(PFAS_FAMILY_HEADING)}</span>
    <span class="cue" style="color:${cue.color};border-color:${cue.color}">${cue.label}</span>
  </div>
  ${body}
  <div class="pfas-analytes">${analyteRows}</div>
  ${link}
</div>`;
}

// --- section builders ------------------------------------------------------

function awarenessSection(input: WaterQualityReportInput): string {
  const orienting = buildOrientingSentence(input);
  const items = groupPfasFamily(input.contaminants);
  const rows = items.map(renderAwarenessItem).join("");
  const detectedCount = input.contaminants.length;

  const list =
    detectedCount > 0
      ? `<div class="contaminant-list">${rows}</div>`
      : `<p class="muted" style="margin-top:10px">Your utility's ${
          input.reportYear ?? "latest"
        } report shows no measurable detections above EPA reporting thresholds for the federally regulated contaminants — a positive signal.</p>`;

  return `
<header class="report-header">
  <div class="eyebrow">Water Quality · Home Awareness Report</div>
  <h1>Your water, explained</h1>
  <div class="header-meta mono">
    <span>${escapeHtml(input.address)}</span>
    <span class="dot">·</span>
    <span>${escapeHtml(input.reportDateLabel)}</span>
  </div>
</header>

<section>
  <p class="orienting">${orienting}</p>
</section>

<section style="margin-top:18px">
  <h2>Detected in your water</h2>
  <p class="section-sub faint">Ordered by what matters most for your home${
    input.reportYear ? `, from your utility's ${input.reportYear} report` : ""
  }.</p>
  ${list}
</section>`;
}

function buildOrientingSentence(input: WaterQualityReportInput): string {
  const utility = input.utilityName ? escapeHtml(input.utilityName) : "Your water utility";
  const source = input.sourceWaterLabel
    ? ` drawing on ${escapeHtml(input.sourceWaterLabel)}`
    : "";
  return `${utility}${source} provides your home's drinking water. This report turns its most recent testing into plain language — what was found, what it means, and what you can do about it.`;
}

function contaminantRow(c: CcrSummarizedContaminant): string {
  const cue = tierCue(c.tier);
  const ref = findWqaContaminantByAlias(c.contaminant_name);
  const level = formatLevel(c.detected_level, c.unit);
  const mcl = formatLevel(c.mcl, c.unit);

  const why = ref?.description
    ? `<p class="why muted">${escapeHtml(ref.description)}</p>`
    : "";
  const link = ref?.learn_more_url
    ? `<a class="epa-link mono" href="${ref.learn_more_url}">EPA reference →</a>`
    : "";

  const measure = level
    ? `<span class="measure mono">${escapeHtml(level)}${
        mcl ? ` <span class="faint">/ ${escapeHtml(mcl)} limit</span>` : ""
      }</span>`
    : "";

  return `
<div class="contaminant keep-together">
  <div class="contaminant-head">
    <span class="cn">${escapeHtml(c.contaminant_name)}</span>
    <span class="cue" style="color:${cue.color};border-color:${cue.color}">${cue.label}</span>
  </div>
  ${measure ? `<div class="measure-row">${measure}</div>` : ""}
  ${why}
  ${link}
</div>`;
}

function agencySection(input: WaterQualityReportInput): string {
  const combo = recommendRemediationCombination(input.detected);
  const personalized = personalizeRemediationMatrix(input.detected);

  const coverLine =
    combo.primary.detected_count > 0
      ? `Covers ${combo.primary.covered_count} of ${combo.primary.detected_count} detected ${
          combo.primary.detected_count === 1 ? "contaminant" : "contaminants"
        } a tap filter can address`
      : "A sensible baseline for most municipal water";

  const ro = combo.ro_addon
    ? `<div class="combo-add surface-raised">
        <div class="combo-title">${escapeHtml(combo.ro_addon.label)}</div>
        <p class="muted small">${
          combo.ro_addon.values_based
            ? "Fluoride is usually added intentionally for dental health, so this is a personal choice rather than a health necessity."
            : `Adds removal of ${escapeHtml(combo.ro_addon.reason_contaminants.join(", "))}, which carbon alone can't fully handle.`
        }</p>
        <div class="combo-cost faint mono">${escapeHtml(combo.ro_addon.cost_install)} · ${escapeHtml(
          combo.ro_addon.cost_ongoing,
        )}</div>
      </div>`
    : "";

  const separately =
    combo.handled_separately.length > 0
      ? `<p class="muted small" style="margin-top:8px">Handled separately (whole-house, not a tap filter): ${escapeHtml(
          combo.handled_separately.join(", "),
        )}.</p>`
      : "";

  const matrixRows = personalized
    .map((p) => {
      const cells = DISPLAY_COLUMNS.map((col) => {
        const cell = effCell(effForColumn(p.row.effectiveness, col.key));
        return `<td class="cell ${cell.cls}" style="color:${cell.color}">${cell.glyph}</td>`;
      }).join("");
      return `
<tr class="${p.detected ? "row-detected" : ""}">
  <th scope="row" class="row-label">
    <span class="rl-name">${escapeHtml(p.row.label)}</span>
    <span class="rl-context faint">${escapeHtml(p.context_label)}</span>
  </th>
  ${cells}
</tr>`;
    })
    .join("");

  const header = DISPLAY_COLUMNS.map(
    (col) => `<th scope="col" class="col-head">${escapeHtml(col.label)}</th>`,
  ).join("");

  return `
<section class="page-break">
  <div class="eyebrow">What you can do</div>
  <h2>Your options</h2>

  <div class="combo">
    <div class="combo-primary surface keep-together">
      <div class="combo-title">${escapeHtml(combo.primary.label)}</div>
      <p class="muted small">${coverLine}.</p>
      <div class="combo-meta">
        <span class="badge">${combo.primary.nsf_standards.map(escapeHtml).join(" · ")}</span>
      </div>
      <div class="combo-cost faint mono">${escapeHtml(combo.primary.cost_install)} · ${escapeHtml(
        combo.primary.cost_ongoing,
      )}</div>
    </div>
    ${ro}
  </div>
  ${separately}

  <h3 style="margin-top:12px">The full picture</h3>
  <p class="section-sub faint">Rows in your water are highlighted. How well each treatment handles each contaminant:</p>
  <table class="matrix">
    <thead><tr><th scope="col" class="row-label-head">Contaminant</th>${header}</tr></thead>
    <tbody>${matrixRows}</tbody>
  </table>

  <div class="legend faint small">
    <span><b style="color:${REPORT_COLORS.success}">●</b> Removes it</span>
    <span><b style="color:${REPORT_COLORS.accent}">◐</b> Partial</span>
    <span><b style="color:${REPORT_COLORS.danger}">△</b> Unreliable — marketed for it, but inconsistent</span>
    <span><b style="color:${REPORT_COLORS.textTertiary}">—</b> Doesn't address it</span>
  </div>
</section>`;
}

function involvementSection(input: WaterQualityReportInput): string {
  const offer = input.freeTestingOffer;
  const freeTesting =
    offer && offer.offered
      ? `<li><b>Test your own tap.</b> Your utility offers free residential water testing${
          offer.contact_value ? ` — reach them at ${escapeHtml(offer.contact_value)}` : ""
        }. A test of the water at your own faucet is the only way to know what's actually coming out of your pipes, since lead and copper enter downstream of the utility.</li>`
      : `<li><b>Test your own tap.</b> The water leaving the treatment plant isn't always the water at your faucet — lead and copper enter from your home's own plumbing. A certified tap test, or a kit from your county health department, closes that gap.</li>`;

  const contact = buildContactBlock(input);

  return `
<section class="page-break">
  <div class="eyebrow">Where to go from here</div>
  <h2>Next steps</h2>

  <ol class="ladder">
    <li><b>Learn.</b> Read the EPA reference linked beside each contaminant above — they explain the health context in plain terms, written for homeowners, not regulators.</li>
    ${freeTesting}
    <li><b>Get involved.</b> Your water utility holds public meetings and publishes its annual report. The contact below is your direct line to ask questions about anything in this document.</li>
  </ol>

  ${contact}

  <div class="disclosure faint small">
    <p><b>How this was made.</b> Every number, tier, and treatment rating in this report is drawn directly from your utility's published Consumer Confidence Report and EPA's public drinking-water data — nothing here is generated or estimated. Treatment effectiveness follows EPA and NSF public guidance and assumes a properly certified unit.</p>
    ${buildDataSources(input)}
    <p style="margin-top:10px">This report is for awareness, not a substitute for testing the water at your own tap. Treatment recommendations are at the technology level; Hearth doesn't sell or endorse specific products.</p>
  </div>
</section>`;
}

/**
 * "Where this data comes from" bullet list, shown between the two
 * disclosure paragraphs. Spells out the acronyms for a general audience.
 * Emits nothing if neither source applies.
 */
function buildDataSources(input: WaterQualityReportInput): string {
  const items: string[] = [];

  const prov = input.ccrProvenance;
  if (prov) {
    const yearPart = prov.year ? `${prov.year} ` : "";
    const name = prov.uploadedByName ? escapeHtml(prov.uploadedByName) : null;
    const date = prov.uploadedOnLabel ? escapeHtml(prov.uploadedOnLabel) : null;
    let creditText = "";
    if (name && date) creditText = ` (uploaded by ${name} on ${date})`;
    else if (date) creditText = ` (uploaded ${date})`;
    else if (name) creditText = ` (uploaded by ${name})`;
    items.push(
      `<li><b>Your utility's ${yearPart}Consumer Confidence Report (CCR)</b> — the annual water-quality report every community water system is required to publish for its customers${creditText}. It's the source of the detected-contaminant levels in this report.</li>`,
    );
  }

  if (input.usedSdwis) {
    items.push(
      `<li><b>EPA's Safe Drinking Water Information System (SDWIS)</b> — the U.S. Environmental Protection Agency's national database of public water systems. Your utility's identity, its compliance history, and its lead &amp; copper monitoring records are drawn from it.</li>`,
    );
  }

  if (items.length === 0) return "";
  return `<div class="sources"><div class="sources-head">Where this data comes from</div><ul class="sources-list">${items.join(
    "",
  )}</ul></div>`;
}

function buildContactBlock(input: WaterQualityReportInput): string {
  const c = input.adminContact;
  const lines: string[] = [];
  if (input.utilityName) lines.push(`<div class="contact-name">${escapeHtml(input.utilityName)}</div>`);
  if (input.pwsid)
    lines.push(
      `<div class="contact-pwsid"><span class="pwsid-label faint">Public Water Supply ID (PWSID)</span><span class="pwsid-value mono">${escapeHtml(
        input.pwsid,
      )}</span></div>`,
    );
  const detail: string[] = [];
  if (c?.name) detail.push(escapeHtml(c.name));
  if (c?.phone) detail.push(escapeHtml(c.phone));
  if (c?.email) detail.push(escapeHtml(c.email));
  if (detail.length > 0) lines.push(`<div class="contact-detail mono faint">${detail.join("  ·  ")}</div>`);
  if (input.ccrArchiveUrl)
    lines.push(`<a class="contact-link mono" href="${input.ccrArchiveUrl}">Your utility's water-quality reports →</a>`);

  if (lines.length === 0) return "";
  return `<div class="contact surface keep-together">
    <div class="eyebrow">Your water utility</div>
    ${lines.join("")}
  </div>`;
}

// --- template-scoped CSS ---------------------------------------------------

function templateCss(): string {
  const c = REPORT_COLORS;
  return `
.report-header { border-bottom: 1px solid ${c.borderSubtle}; padding-bottom: 14px; margin-bottom: 18px; }
.report-header h1 { margin: 6px 0 8px; }
.header-meta { font-size: 8pt; color: ${c.textSecondary}; letter-spacing: 0.03em; }
.header-meta .dot { opacity: 0.5; padding: 0 0.5em; }

.orienting { font-size: 12pt; color: ${c.textSecondary}; line-height: 1.6; }
.section-sub { margin: 2px 0 12px; font-size: 8.5pt; }

.contaminant-list { display: flex; flex-direction: column; gap: 10px; }
.contaminant { border: 1px solid ${c.borderSubtle}; border-radius: 8px; padding: 11px 13px; background: ${c.bgSurface}; }
.contaminant-head { display: flex; align-items: baseline; justify-content: space-between; gap: 10px; }
.contaminant-head .cn { font-family: 'Fraunces', serif; font-size: 12.5pt; }
.cue { font-family: 'JetBrains Mono', monospace; font-size: 6.5pt; font-weight: 500; letter-spacing: 0.1em; text-transform: uppercase; border: 1px solid; border-radius: 999px; padding: 2px 7px; white-space: nowrap; }
.measure-row { margin-top: 3px; }
.measure { font-size: 9pt; color: ${c.textPrimary}; }
.why { margin-top: 6px; font-size: 9.5pt; line-height: 1.5; }
.epa-link { display: inline-block; margin-top: 7px; font-size: 7.5pt; letter-spacing: 0.04em; color: ${c.accent}; border-bottom: 1px solid color-mix(in oklab, ${c.accent} 40%, transparent); }

.pfas-analytes { margin-top: 9px; padding-top: 8px; border-top: 1px solid ${c.borderSubtle}; display: flex; flex-direction: column; gap: 5px; }
.pfas-analyte { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; }
.pfas-analyte .an-name { font-size: 9.5pt; color: ${c.textPrimary}; }
.pfas-analyte .an-measure { font-size: 8.5pt; color: ${c.textPrimary}; white-space: nowrap; }

.combo { display: flex; gap: 12px; margin-top: 12px; }
.combo-primary, .combo-add { flex: 1; padding: 13px; }
.combo-title { font-family: 'Fraunces', serif; font-size: 12pt; }
.combo .small, .small { font-size: 9pt; }
.combo-meta { margin-top: 8px; }
.badge { display: inline-block; font-family: 'JetBrains Mono', monospace; font-size: 7pt; letter-spacing: 0.06em; color: ${c.accent}; border: 1px solid color-mix(in oklab, ${c.accent} 30%, transparent); border-radius: 6px; padding: 3px 7px; }
.combo-cost { margin-top: 8px; font-size: 7.5pt; }

/* table-layout: fixed makes column widths come from these rules rather
   than from content, so the five treatment columns are exactly equal
   regardless of header length ("Carbon block" no longer widens its
   column). Row-label takes 30%; the five tech columns split the rest. */
.matrix { width: 100%; border-collapse: collapse; table-layout: fixed; margin-top: 6px; font-size: 9pt; }
.matrix .row-label-head, .matrix tbody th.row-label { width: 30%; }
.matrix thead th.col-head, .matrix td.cell { width: 14%; }
.matrix thead th { text-align: center; font-family: 'JetBrains Mono', monospace; font-weight: 500; font-size: 6.8pt; letter-spacing: 0.06em; text-transform: uppercase; color: ${c.textTertiary}; padding: 0 4px 5px; }
.matrix .row-label-head { text-align: left; }
.matrix tbody th.row-label { text-align: left; font-weight: 400; padding: 4px 8px 4px 0; border-top: 1px solid ${c.borderSubtle}; }
.rl-name { display: block; color: ${c.textPrimary}; font-size: 10pt; }
.rl-context { display: block; font-size: 7pt; margin-top: 1px; }
.matrix td.cell { text-align: center; font-size: 11pt; border-top: 1px solid ${c.borderSubtle}; padding: 4px 4px; }
.matrix tr.row-detected th.row-label { border-left: 2px solid ${c.amber}; padding-left: 8px; }
.matrix tr.row-detected th.row-label .rl-name { color: ${c.amber}; font-weight: 500; }
.matrix tr.row-detected td.cell { background: color-mix(in oklab, ${c.amber} 8%, transparent); }

.legend { display: flex; flex-wrap: wrap; gap: 14px; margin-top: 8px; font-size: 8pt; break-inside: avoid; }
.legend b { font-size: 11pt; vertical-align: -1px; }

.ladder { margin: 8px 0 0; padding-left: 18px; display: flex; flex-direction: column; gap: 9px; }
.ladder li { font-size: 10pt; color: ${c.textSecondary}; line-height: 1.5; }
.ladder li b { color: ${c.textPrimary}; }

.contact { margin-top: 18px; padding: 13px; }
.contact-name { font-family: 'Fraunces', serif; font-size: 12pt; margin-top: 4px; }
.contact-pwsid { margin-top: 8px; }
.contact-pwsid .pwsid-label { display: block; font-size: 7.5pt; letter-spacing: 0.02em; }
.contact-pwsid .pwsid-value { display: block; font-size: 11pt; color: ${c.textPrimary}; margin-top: 1px; letter-spacing: 0.04em; }
.contact-detail { font-size: 8.5pt; margin-top: 8px; }
.contact-link { display: inline-block; margin-top: 8px; font-size: 8pt; color: ${c.accent}; border-bottom: 1px solid color-mix(in oklab, ${c.accent} 40%, transparent); }

.disclosure { margin-top: 20px; padding-top: 12px; border-top: 1px solid ${c.borderSubtle}; font-size: 7.8pt; line-height: 1.5; }
.sources { margin-top: 10px; }
.sources-head { font-weight: 500; color: ${c.textSecondary}; margin-bottom: 4px; }
.sources-list { margin: 0; padding-left: 15px; display: flex; flex-direction: column; gap: 5px; }
.sources-list li { line-height: 1.5; }
.sources-list li b { color: ${c.textSecondary}; }
`;
}

/**
 * Build the complete water-quality report HTML document, ready to hand to
 * the shared Chromium renderer.
 */
export function buildWaterQualityReport(input: WaterQualityReportInput): string {
  const bodyHtml = `${awarenessSection(input)}${agencySection(input)}${involvementSection(input)}`;
  return buildReportDocument({
    title: `Water Quality Report — ${input.address}`,
    bodyHtml,
    templateCss: templateCss(),
  });
}
