/**
 * Branch-decision logic for the Water Quality Awareness module.
 *
 * Pure functions over the inputs the module has after PWSID resolution
 * and Envirofacts lookup. Kept separate from check() so the branch
 * mapping is testable without HTTP mocks and the orchestrator-facing
 * entry point stays small.
 */

import type { EnvirofactsWaterSystemRecord } from "./sources/envirofacts";
import type { WqaBranch } from "./types";

/**
 * Inputs to the branch decision. Each field corresponds to one of the
 * three signals the module collects:
 *
 *   pwsidResolved  — CWS Service Areas returned a polygon containing
 *                    the house's coordinates.
 *   record         — Envirofacts returned a WATER_SYSTEM row for the
 *                    resolved PWSID. Null when the PWSID didn't
 *                    resolve, or when Envirofacts had no row, or when
 *                    the fetch failed before we got useful data.
 */
export type BranchInputs = {
  pwsidResolved: boolean;
  record: EnvirofactsWaterSystemRecord | null;
};

/**
 * Map (pwsidResolved, record) to one of the five WQA branches. Pure.
 *
 * Decision table:
 *
 *   pwsidResolved=false                          → 'private_well'
 *   record=null (PWSID present but EPA empty)    → 'stale'
 *   record.pws_activity_code != 'A'              → 'stale'
 *   record.pws_type_code in ('TNCWS','NTNCWS')   → 'non_community'
 *   record.pws_type_code == 'CWS'                → 'cws_no_ccr'
 *
 * The 'cws_with_ccr' branch is decided one layer up (by check())
 * against the shared CCR cache that WQA-3 introduces. Phase 1 never
 * returns 'cws_with_ccr' from this function.
 *
 * Any pws_type_code outside the recognized set falls through to
 * 'stale' with the actual code surfaced in the diagnostic note. Reads
 * as the safest default — unknown system types are by definition
 * unsupported and we shouldn't show a homeowner a confident system
 * card for something we can't characterize.
 */
export function decideBranch(inputs: BranchInputs): {
  branch: WqaBranch;
  diagnostic?: string;
} {
  if (!inputs.pwsidResolved) {
    return {
      branch: "private_well",
      diagnostic:
        "No EPA Community Water System polygon covers this address; treating as private well.",
    };
  }
  const { record } = inputs;
  if (!record) {
    return {
      branch: "stale",
      diagnostic:
        "EPA Envirofacts returned no WATER_SYSTEM record for the resolved PWSID.",
    };
  }
  if (record.pws_activity_code !== "A") {
    return {
      branch: "stale",
      diagnostic: `EPA reports pws_activity_code='${record.pws_activity_code}' (not active).`,
    };
  }
  if (
    record.pws_type_code === "TNCWS" ||
    record.pws_type_code === "NTNCWS"
  ) {
    return { branch: "non_community" };
  }
  if (record.pws_type_code === "CWS") {
    return { branch: "cws_no_ccr" };
  }
  return {
    branch: "stale",
    diagnostic: `EPA reports an unrecognized pws_type_code='${record.pws_type_code}'.`,
  };
}
