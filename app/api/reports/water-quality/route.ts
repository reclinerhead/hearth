/**
 * Water Quality Report — generate / serve route (issue #207, WQA-R1).
 *
 * GET renders (or serves a cached) themed PDF of the active house's water
 * quality finding. Flow:
 *   1. Resolve the active house (RLS-bound session client).
 *   2. Load the WQA finding; require CCR-derived data (the report is built
 *      from it). Without it, 422 — the card only enables when data exists.
 *   3. Compute the cache signature (finding content version + reference +
 *      template versions).
 *   4. Cache hit → serve the stored PDF. Miss → render with headless
 *      Chromium, persist best-effort, serve the fresh bytes.
 *
 * The render is the only multi-second path and is paid once per data
 * change; every subsequent download serves the cached file. Synchronous by
 * design (the client shows a spinner) — see issue #207 open-question 3.
 *
 * Memory note: headless Chromium wants ~1–2 GB. If this route OOMs on
 * Vercel, raise its function memory in project settings (there is no
 * per-route memory export in Next).
 */

import { resolveActiveHouseId } from "@/lib/houses/active-house";
import { createClient } from "@/lib/supabase/server";
import type { House } from "@/types/house";
import type { WqaFindings } from "@/lib/habitat/modules/water-quality-awareness/types";
import { buildDisplayedCcrContaminants } from "@/lib/habitat/modules/water-quality-awareness/ccr";
import { deriveDetectedContaminants } from "@/lib/habitat/modules/water-quality-awareness/detected";
import { getCachedReportPdf, persistReport } from "@/lib/reports/cache";
import { renderReportPdf } from "@/lib/reports/render";
import { buildReportFooterTemplate } from "@/lib/reports/theme";
import {
  buildWaterQualityReport,
  waterQualityReportSignature,
  WATER_QUALITY_REPORT_TYPE,
  type WaterQualityReportInput,
} from "@/lib/reports/water-quality/report";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const WQA_MODULE_KEY = "water_quality_awareness";

/**
 * TEMPORARY (issue #207 iteration): bypass the report cache so layout/copy
 * changes show on every Generate without bumping the template version each
 * time. While true, the route always renders fresh and does not read or
 * write the cache. Flip back to `false` (or remove this guard) once the
 * report format is locked in, to re-enable serve-from-cache.
 */
const BYPASS_REPORT_CACHE = true;

function sourceWaterLabel(
  sourceType: NonNullable<WqaFindings["system_card"]>["source_type"] | undefined,
): string | null {
  switch (sourceType) {
    case "groundwater":
      return "ground water";
    case "surface":
      return "surface water";
    case "groundwater_under_surface":
      return "ground water under the influence of surface water";
    default:
      return null;
  }
}

function formatAddress(house: House): string {
  const parts = [house.address_line1, house.city].filter(Boolean);
  const stateZip = [house.state, house.postal_code].filter(Boolean).join(" ");
  return [parts.join(", "), stateZip].filter(Boolean).join(", ");
}

function jsonError(message: string, status: number): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { "content-type": "application/json" },
  });
}

export async function GET(): Promise<Response> {
  const supabase = await createClient();

  const houseId = await resolveActiveHouseId(supabase);
  if (!houseId) return jsonError("No active house.", 401);

  const { data: houseRow, error: houseError } = await supabase
    .from("houses")
    .select("*")
    .eq("id", houseId)
    .single();
  if (houseError || !houseRow?.id) return jsonError("Could not load your home.", 404);
  const house = houseRow as House;

  const { data: findingRow, error: findingError } = await supabase
    .from("habitat_findings")
    .select("findings, checked_at")
    .eq("house_id", houseId)
    .eq("module_key", WQA_MODULE_KEY)
    .maybeSingle();
  if (findingError) return jsonError("Could not load your water quality data.", 500);
  if (!findingRow?.findings) {
    return jsonError("Your water quality check hasn't run yet.", 422);
  }

  const findings = findingRow.findings as WqaFindings;
  const ccr = findings.ccr_findings ?? null;
  if (!ccr) {
    return jsonError(
      "This report needs your utility's water quality report (CCR). Upload one from the Water Quality finding to enable it.",
      422,
    );
  }

  const leadCopper = findings.lead_copper_summary ?? null;

  // The displayed "Detected in your water" list is the regulated-contaminant
  // table PLUS the separate lead/copper distribution PLUS detected UCMR
  // (PFAS) rows — the same merge the findings modal uses (issue #224).
  // Reading the raw `ccr.contaminants` array alone drops lead and copper,
  // which live in their own CCR section.
  const displayedContaminants = buildDisplayedCcrContaminants(ccr, leadCopper);

  const detected = deriveDetectedContaminants({
    branch: findings.branch,
    ccrFindings: ccr,
    leadCopper,
  });

  const longDate = new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
  const reportDateLabel = longDate.format(new Date());

  // CCR provenance for the "Where this data comes from" list. Best-effort:
  // reads the shared water_system_reports row for this utility + year. The
  // uploader's name is surfaced only when the uploader is the person
  // generating the report — we don't put another household's name on a
  // forwardable PDF (and the name lives in auth metadata, readable only for
  // the current user).
  const pwsid = findings.system_card?.pwsid ?? null;
  const reportYear = ccr.report_year ?? null;
  let ccrProvenance: WaterQualityReportInput["ccrProvenance"] =
    reportYear !== null ? { year: reportYear, uploadedByName: null, uploadedOnLabel: null } : null;

  if (pwsid && reportYear !== null) {
    const { data: reportRow } = await supabase
      .from("water_system_reports")
      .select("uploaded_by, extracted_at")
      .eq("pwsid", pwsid)
      .eq("report_year", reportYear)
      .order("extracted_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (reportRow) {
      const { data: authData } = await supabase.auth.getUser();
      const currentUser = authData?.user ?? null;
      const meta = currentUser?.user_metadata ?? {};
      const selfName =
        typeof meta.full_name === "string"
          ? meta.full_name
          : typeof meta.name === "string"
            ? meta.name
            : null;
      const uploadedByName =
        currentUser && reportRow.uploaded_by === currentUser.id ? selfName : null;
      const uploadedOnLabel = reportRow.extracted_at
        ? longDate.format(new Date(reportRow.extracted_at))
        : null;
      ccrProvenance = { year: reportYear, uploadedByName, uploadedOnLabel };
    }
  }

  // SDWIS is a source whenever we identified a public water system (its
  // identity, compliance, and lead/copper records come from SDWIS).
  const usedSdwis = Boolean(findings.system_card);

  const input: WaterQualityReportInput = {
    address: formatAddress(house),
    reportDateLabel,
    utilityName: findings.system_card?.pws_name ?? null,
    pwsid: findings.system_card?.pwsid ?? null,
    sourceWaterLabel: sourceWaterLabel(findings.system_card?.source_type),
    reportYear: ccr.report_year ?? null,
    contaminants: displayedContaminants,
    detected,
    freeTestingOffer: ccr.free_testing_offer ?? null,
    usedSdwis,
    ccrProvenance,
    adminContact: findings.branch_metadata?.admin_contact ?? null,
    ccrArchiveUrl: null,
  };

  const signature = waterQualityReportSignature(findingRow.checked_at ?? null);

  // Cache hit → serve the stored PDF without re-rendering. Skipped while
  // BYPASS_REPORT_CACHE is on (format iteration).
  if (!BYPASS_REPORT_CACHE) {
    const cached = await getCachedReportPdf({
      supabase,
      houseId,
      reportType: WATER_QUALITY_REPORT_TYPE,
      signature,
    });
    if (cached) return pdfResponse(cached);
  }

  // Miss → render fresh, persist best-effort, serve.
  let pdf: Buffer;
  try {
    pdf = await renderReportPdf(
      buildWaterQualityReport(input),
      buildReportFooterTemplate(input.address),
    );
  } catch (e) {
    console.error("[reports/water-quality] render failed:", e);
    return jsonError("We couldn't generate your report just now. Please try again.", 500);
  }

  if (!BYPASS_REPORT_CACHE) {
    await persistReport({
      supabase,
      houseId,
      reportType: WATER_QUALITY_REPORT_TYPE,
      signature,
      pdf,
      generatedAtIso: new Date().toISOString(),
    });
  }

  return pdfResponse(pdf);
}

function pdfResponse(pdf: Buffer): Response {
  return new Response(pdf as unknown as BodyInit, {
    status: 200,
    headers: {
      "content-type": "application/pdf",
      "content-disposition": 'attachment; filename="Hearth Water Quality Report.pdf"',
      "cache-control": "private, no-store",
    },
  });
}
