/**
 * Branch-decision logic for the Water Quality Awareness module.
 *
 * Pure functions over the inputs the module has after PWSID resolution
 * and Envirofacts lookup. Kept separate from check() so the branch
 * mapping is testable without HTTP mocks and the orchestrator-facing
 * entry point stays small.
 *
 * The user's onboarding-captured `water_source` is the primary signal,
 * not EPA's map. EPA's national CWS service-area layer covers roughly
 * 6 of every 7 U.S. addresses — the gap is mostly rural fringes,
 * recent annexations, and edge cases like Kalamazoo Township parcels
 * served by Kalamazoo PWS but mapped just outside the city polygon.
 * When the user has explicitly told us they're on city water, treating
 * "no polygon match" as "private well" is the wrong answer.
 *
 * Decision table (full):
 *
 *   waterSource='well' or 'shared'              → private_well (user-declared)
 *   waterSource='municipal' AND no PWSID match  → cws_unmapped
 *   waterSource='municipal' AND PWSID match     → existing EPA-record-driven logic
 *   waterSource='unknown' / null                → existing EPA-polygon-driven logic
 *
 * The 'shared' (neighborhood / co-op well) case collapses into
 * private_well for now: no PWSID exists, so SDWIS and CCR features
 * don't apply. We surface the user's specific declaration in the
 * diagnostic note so the activity log can narrate it correctly.
 */

import type { HouseContext } from "@/lib/habitat/types";
import type { EnvirofactsWaterSystemRecord } from "./sources/envirofacts";
import type { WqaBranch } from "./types";

/**
 * Inputs to the branch decision.
 *
 *   waterSource    — Captured during onboarding (issue #142). The
 *                    primary signal. "well" / "shared" short-circuit
 *                    to private_well without consulting EPA at all.
 *   pwsidResolved  — Whether the CWS Service Areas polygon matched
 *                    the house's coordinates. Only meaningful when
 *                    waterSource is "municipal" or unknown/null.
 *   record         — Envirofacts WATER_SYSTEM record for the resolved
 *                    PWSID. Null when no PWSID resolved, or when EPA
 *                    had no row for it, or when the fetch errored
 *                    upstream.
 *   ccrCached      — Whether the shared CCR cache holds an extracted
 *                    report for this PWSID. When true on an active
 *                    CWS, the branch decision returns `cws_with_ccr`
 *                    instead of `cws_no_ccr`. Defaults to `false` for
 *                    callers (older tests, future module variants)
 *                    that don't yet thread the CCR cache through. WQA-3.
 */
export type BranchInputs = {
  waterSource: HouseContext["waterSource"];
  pwsidResolved: boolean;
  record: EnvirofactsWaterSystemRecord | null;
  ccrCached?: boolean;
};

/**
 * Map (waterSource, pwsidResolved, record) onto one of the WQA
 * branches. Pure.
 *
 * The diagnostic carries the WHY behind the decision so the activity
 * log can narrate honestly: "you told us you're on a well" reads
 * differently from "EPA's map didn't cover your address." Diagnostic
 * is optional on the happy paths where the branch is self-explanatory.
 */
export function decideBranch(inputs: BranchInputs): {
  branch: WqaBranch;
  diagnostic?: string;
} {
  // User-declared well or shared system. EPA has no useful data for
  // either case (no PWSID, no SDWIS, no CCR), so we short-circuit the
  // EPA lookups and report private_well with a user-declared note.
  if (inputs.waterSource === "well") {
    return {
      branch: "private_well",
      diagnostic:
        "You told us during onboarding that your home is on a private well.",
    };
  }
  if (inputs.waterSource === "shared") {
    return {
      branch: "private_well",
      diagnostic:
        "You told us during onboarding that your home is on a shared private water system. Hearth treats shared systems like private wells for now — they don't carry a federal PWSID, so EPA's compliance data doesn't apply.",
    };
  }

  // User declared municipal — trust them. EPA's polygon decides which
  // utility, but a missing polygon means "we can't pinpoint your
  // utility on EPA's national map," not "you're on a well."
  if (inputs.waterSource === "municipal") {
    if (!inputs.pwsidResolved) {
      return {
        branch: "cws_unmapped",
        diagnostic:
          "You told us during onboarding that you're on city water, but EPA's national map of public water system service areas doesn't cover your exact address. That's common — EPA's coverage has gaps in rural fringes and recent annexations.",
      };
    }
    const { record } = inputs;
    if (!record) {
      return {
        branch: "stale",
        diagnostic:
          "We matched your address to a public water system, but EPA Envirofacts returned no WATER_SYSTEM record for that PWSID.",
      };
    }
    if (record.pws_activity_code !== "A") {
      return {
        branch: "stale",
        diagnostic: `EPA reports pws_activity_code='${record.pws_activity_code}' (not active).`,
      };
    }
    if (record.pws_type_code === "TNCWS" || record.pws_type_code === "NTNCWS") {
      return { branch: "non_community" };
    }
    if (record.pws_type_code === "CWS") {
      return { branch: inputs.ccrCached ? "cws_with_ccr" : "cws_no_ccr" };
    }
    return {
      branch: "stale",
      diagnostic: `EPA reports an unrecognized pws_type_code='${record.pws_type_code}'.`,
    };
  }

  // waterSource is "unknown" or null — fall back to the original
  // EPA-driven branch logic. Polygon decides everything.
  if (!inputs.pwsidResolved) {
    return {
      branch: "private_well",
      diagnostic:
        "We couldn't tell from your onboarding answers whether you're on a public system, and no EPA Community Water System polygon covers your address — that usually means a private well.",
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
  if (record.pws_type_code === "TNCWS" || record.pws_type_code === "NTNCWS") {
    return { branch: "non_community" };
  }
  if (record.pws_type_code === "CWS") {
    return { branch: inputs.ccrCached ? "cws_with_ccr" : "cws_no_ccr" };
  }
  return {
    branch: "stale",
    diagnostic: `EPA reports an unrecognized pws_type_code='${record.pws_type_code}'.`,
  };
}

/**
 * Whether the branch decision relies on EPA lookups (CWS Service
 * Areas + Envirofacts) or short-circuits on the user's onboarding
 * answer alone. The orchestrator uses this to skip those fetches
 * when there's nothing to gain from them.
 *
 * Returns true for waterSource = 'well' or 'shared'.
 */
export function shouldSkipEpaLookups(
  waterSource: HouseContext["waterSource"],
): boolean {
  return waterSource === "well" || waterSource === "shared";
}
