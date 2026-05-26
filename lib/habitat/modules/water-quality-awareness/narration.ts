/**
 * Activity-log narration helpers for the Water Quality Awareness module.
 *
 * Same voice and discipline as the other habitat modules: first-person,
 * jargon-free narration in `narration`; URLs and raw values in `detail`;
 * one outcome word in `result_summary`. The Superfund module's
 * narration.ts is the reference pattern.
 */

import type { ActivitySource } from "@/lib/habitat/activity-log";
import type { WqaBranch } from "./types";

export const EPA_CWS_SERVICE_AREAS_SOURCE: ActivitySource = {
  label: "EPA Community Water System Service Areas",
  url: "https://www.epa.gov/ground-water-and-drinking-water/public-water-system-service-areas",
};

export const EPA_ENVIROFACTS_SOURCE: ActivitySource = {
  label: "EPA Envirofacts WATER_SYSTEM",
  url: "https://www.epa.gov/enviro/envirofacts-data-service-api",
};

export const HEARTH_BRANCH_SOURCE: ActivitySource = {
  label: "How Hearth interprets your water system",
  url: "/how-it-works#water-quality-awareness",
};

export const EPA_SDWIS_VIOLATIONS_SOURCE: ActivitySource = {
  label: "EPA SDWIS Violations (Envirofacts)",
  url: "https://www.epa.gov/enviro/envirofacts-data-service-api",
};

export const EPA_SDWIS_LCR_SOURCE: ActivitySource = {
  label: "EPA Lead and Copper Rule Sample Results",
  url: "https://www.epa.gov/enviro/envirofacts-data-service-api",
};

export const HEARTH_COMPLIANCE_RULE_SOURCE: ActivitySource = {
  label: "How Hearth reads your utility's compliance record",
  url: "/how-it-works#water-quality-awareness",
};

export function pwsidFetchNarration(input: {
  lat: number;
  lng: number;
  resolved: boolean;
  totalFeatures: number;
  /**
   * When the direct lookup misses and the module is about to run the
   * nearest-polygon fallback (which is always, post-WQA-2-followup),
   * the no-match narration changes to set up the next step rather
   * than declaring the verdict. Defaults to true so callers that
   * don't pass it get the modern flow.
   */
  willRunFallback?: boolean;
}): { narration: string; detail: string; result_summary: string } {
  const { lat, lng, resolved, totalFeatures, willRunFallback = true } = input;
  if (!resolved) {
    if (willRunFallback) {
      return {
        narration:
          "I checked your exact coordinates against EPA's national map of public water system service areas and didn't find a match — let me try a wider search.",
        detail: `lat=${lat}, lng=${lng}; CWS Service Areas returned 0 features`,
        result_summary: "no direct match",
      };
    }
    return {
      narration:
        "I looked up your address against EPA's national map of public water system service areas and didn't find a match — that's the usual signal for a private well.",
      detail: `lat=${lat}, lng=${lng}; CWS Service Areas returned 0 features`,
      result_summary: "no PWSID match",
    };
  }
  const overlap =
    totalFeatures > 1
      ? ` (EPA returned ${totalFeatures} overlapping polygons; I went with the first match)`
      : "";
  return {
    narration: `I looked up your address against EPA's national map of public water system service areas and found the utility that serves you${overlap}.`,
    detail: `lat=${lat}, lng=${lng}; CWS Service Areas returned ${totalFeatures} feature${totalFeatures === 1 ? "" : "s"}`,
    result_summary: "PWSID resolved",
  };
}

/**
 * Activity-log narration for the nearest-polygon fallback step. Only
 * runs after the direct point-in-polygon query came up empty.
 */
export function nearestPwsidFetchNarration(input: {
  radiusMeters: number;
  outcome:
    | { kind: "single-nearby"; pwsid: string; pwsName: string | null; candidateCount: number }
    | { kind: "multiple-competing"; candidates: Array<{ pwsid: string; pwsName: string | null; count: number }> }
    | { kind: "no-match" };
}): { narration: string; detail: string; result_summary: string } {
  const { radiusMeters, outcome } = input;
  if (outcome.kind === "single-nearby") {
    const displayName = outcome.pwsName
      ? `${outcome.pwsName} (${outcome.pwsid})`
      : outcome.pwsid;
    return {
      narration: `Every public water utility within ${radiusMeters} meters of your address is the same one — ${displayName}. I'm going with that, with medium confidence.`,
      detail: `radius=${radiusMeters}m; candidate polygons=${outcome.candidateCount}; resolved=${outcome.pwsid}`,
      result_summary: "inferred match",
    };
  }
  if (outcome.kind === "multiple-competing") {
    const list = outcome.candidates
      .map((c) => `${c.pwsid}${c.pwsName ? ` (${c.pwsName})` : ""} ×${c.count}`)
      .join(", ");
    return {
      narration: `I found multiple public water utilities near your address but couldn't pick one with confidence. You'll be able to upload your utility's annual Water Quality Report manually once that phase ships.`,
      detail: `radius=${radiusMeters}m; competing candidates: ${list}`,
      result_summary: "competing candidates",
    };
  }
  return {
    narration: `No public water utilities within ${radiusMeters} meters of your address either — this is most likely a private well.`,
    detail: `radius=${radiusMeters}m; 0 candidate polygons`,
    result_summary: "no nearby utilities",
  };
}

export function envirofactsFetchNarration(input: {
  pwsid: string;
  cacheKind: "hit" | "miss";
  cacheDetail: string;
  ageDays?: number;
}): { narration: string; detail: string; result_summary: string } {
  if (input.cacheKind === "hit") {
    const age =
      typeof input.ageDays === "number" ? ` (${input.ageDays}d old)` : "";
    return {
      narration: `I had this utility's record on file from an earlier check, so I reused it instead of re-asking EPA${age}.`,
      detail: input.cacheDetail,
      result_summary: "cache: hit",
    };
  }
  return {
    narration:
      "I pulled the utility's inventory record from EPA's Envirofacts service.",
    detail: input.cacheDetail,
    result_summary: "cache: miss",
  };
}

export function branchDecideNarration(input: {
  branch: WqaBranch;
  diagnostic?: string;
  /**
   * When the private_well branch came from the user's onboarding
   * answer rather than from EPA's polygon coverage being silent, the
   * narration reads differently — confident and grounded in what the
   * user already told us, rather than probabilistic. Defaults to
   * "epa-inferred" so callers that don't pass it keep the original
   * voice.
   */
  source?: "user-declared" | "epa-inferred";
}): { narration: string; detail?: string; result_summary: string } {
  switch (input.branch) {
    case "private_well":
      if (input.source === "user-declared") {
        return {
          narration:
            "You told us during onboarding that your home isn't on a public water utility, so I'm trusting that and treating this as a private system. The EPA doesn't monitor private wells — testing is on you, and we'll add tailored guidance in a later Hearth update.",
          detail: input.diagnostic,
          result_summary: "branch: private_well (user-declared)",
        };
      }
      return {
        narration:
          "Since no public water system covers your address, I'm treating this house as a private-well home for now. We'll add private-well guidance in a future Hearth update.",
        detail: input.diagnostic,
        result_summary: "branch: private_well",
      };
    case "cws_unmapped":
      return {
        narration:
          "You told us during onboarding that you're on city water, but EPA's national map of utility service areas doesn't cover your exact address. About one in every seven U.S. addresses falls outside EPA's mapping, so this is common — and it means we can't pull compliance data without a PWSID. You'll be able to upload your utility's annual Water Quality Report manually once that phase ships.",
        detail: input.diagnostic,
        result_summary: "branch: cws_unmapped",
      };
    case "stale":
      return {
        narration:
          "Something about EPA's record didn't add up, so I'm flagging your water system as unconfirmed for this run and we'll try again next time.",
        detail: input.diagnostic,
        result_summary: "branch: stale",
      };
    case "non_community":
      return {
        narration:
          "Your address falls inside a non-community water system service area — places like schools, campgrounds, or small businesses. These systems don't publish an annual Water Quality Report.",
        detail: input.diagnostic,
        result_summary: "branch: non_community",
      };
    case "cws_no_ccr":
      return {
        narration:
          "Your address is served by a Community Water System, which means an annual Water Quality Report is required by federal law. We'll layer in compliance history and CCR-driven findings as those phases ship.",
        detail: input.diagnostic,
        result_summary: "branch: cws_no_ccr",
      };
    case "cws_with_ccr":
      return {
        narration:
          "Your address is served by a Community Water System and we already have its latest Water Quality Report on file. Findings will reflect that report once the full pipeline ships.",
        detail: input.diagnostic,
        result_summary: "branch: cws_with_ccr",
      };
  }
}

/**
 * Activity-log narration for the very-first step on a user-declared
 * private-well / shared-system run, where we skip the EPA polygon
 * lookup entirely. Stands in for the usual "fetch CWS Service Areas"
 * step so the log still narrates the input the decision rested on.
 */
export function trustedWaterSourceNarration(input: {
  waterSource: "well" | "shared";
}): { narration: string; detail: string; result_summary: string } {
  const label = input.waterSource === "shared" ? "shared private water system" : "private well";
  return {
    narration: `You told us during onboarding that your home is on a ${label}, so I skipped EPA's public water system lookup — those records wouldn't apply.`,
    detail: `house.water_source='${input.waterSource}'`,
    result_summary: "skipped EPA lookup",
  };
}

/**
 * Activity-log narration for the SDWIS violations fetch step. Same
 * cache-hit / cache-miss / fetch-failed three-state shape as the
 * Envirofacts fetch helper.
 */
export function violationsFetchNarration(input: {
  pwsid: string;
  outcome:
    | { kind: "hit"; ageDays: number; rowCount: number }
    | { kind: "miss"; reason: "no-row" | "expired" | "lookup-error"; rowCount: number; sourceUrl: string }
    | { kind: "failed"; message: string };
}): { narration: string; detail: string; result_summary: string } {
  const o = input.outcome;
  if (o.kind === "hit") {
    const violationsClause =
      o.rowCount === 0
        ? "no violations on file"
        : `${o.rowCount} violation${o.rowCount === 1 ? "" : "s"} on file`;
    return {
      narration: `I had your utility's compliance history on file from an earlier check (${o.ageDays}d old), so I reused it instead of re-asking EPA.`,
      detail: `Cache hit on hearth.water_system_violations for ${input.pwsid}; ${violationsClause}; ttl=30d`,
      result_summary: "cache: hit",
    };
  }
  if (o.kind === "miss") {
    const violationsClause =
      o.rowCount === 0
        ? "no violations on file"
        : `${o.rowCount} violation${o.rowCount === 1 ? "" : "s"} fetched`;
    return {
      narration:
        "I pulled your utility's violation history from EPA's compliance database.",
      detail: `Cache miss (${o.reason}); GET ${o.sourceUrl}; ${violationsClause}`,
      result_summary: "cache: miss",
    };
  }
  return {
    narration:
      "I tried to pull your utility's violation history from EPA but the request didn't go through. Compliance status will show as 'unknown' for this run.",
    detail: o.message,
    result_summary: "fetch: failed",
  };
}

/**
 * Activity-log narration for the LCR samples fetch step.
 */
export function lcrFetchNarration(input: {
  pwsid: string;
  outcome:
    | { kind: "hit"; ageDays: number; rowCount: number }
    | { kind: "miss"; reason: "no-row" | "expired" | "lookup-error"; rowCount: number; sourceUrl: string }
    | { kind: "failed"; message: string };
}): { narration: string; detail: string; result_summary: string } {
  const o = input.outcome;
  if (o.kind === "hit") {
    const samplesClause =
      o.rowCount === 0
        ? "no samples on file"
        : `${o.rowCount} sample row${o.rowCount === 1 ? "" : "s"} on file`;
    return {
      narration: `I had your utility's lead and copper samples on file from an earlier check (${o.ageDays}d old), so I reused them instead of re-asking EPA.`,
      detail: `Cache hit on hearth.water_system_lcr_samples for ${input.pwsid}; ${samplesClause}; ttl=30d`,
      result_summary: "cache: hit",
    };
  }
  if (o.kind === "miss") {
    if (o.rowCount === 0) {
      return {
        narration:
          "I checked EPA for your utility's most recent lead and copper sample results. Your utility doesn't have any on file yet — that's not unusual on a rotating sampling schedule.",
        detail: `Cache miss (${o.reason}); GET ${o.sourceUrl}; 0 samples returned`,
        result_summary: "cache: miss",
      };
    }
    return {
      narration:
        "I checked the most recent lead and copper samples your utility submitted to EPA.",
      detail: `Cache miss (${o.reason}); GET ${o.sourceUrl}; ${o.rowCount} sample row${o.rowCount === 1 ? "" : "s"} fetched`,
      result_summary: "cache: miss",
    };
  }
  return {
    narration:
      "I tried to pull your utility's lead and copper sample results from EPA but the request didn't go through. Lead and copper data will be unavailable for this run.",
    detail: o.message,
    result_summary: "fetch: failed",
  };
}

/**
 * Activity-log narration for the compliance summarization compute step.
 */
export function complianceComputeNarration(input: {
  status: "unknown" | "no_active_violations" | "active_violations";
  recentTotal: number;
  recentHealth: number;
  recentYears: number;
  unmappedContaminantCount: number;
}): { narration: string; detail: string; result_summary: string } {
  if (input.status === "unknown") {
    return {
      narration:
        "I couldn't read your utility's compliance status this run, so I'm leaving it as 'unknown' and we'll try again next time.",
      detail: "compliance summary skipped (violations fetch failed)",
      result_summary: "status: unknown",
    };
  }
  if (input.status === "active_violations") {
    return {
      narration: `I looked across your utility's violation history. There's at least one active health-based violation right now${input.recentTotal > 0 ? ` and ${input.recentTotal} total violation${input.recentTotal === 1 ? "" : "s"} in the last ${input.recentYears} years` : ""}.`,
      detail: `health_based_active>0; recent_window=${input.recentYears}y; total_recent=${input.recentTotal}; health_recent=${input.recentHealth}; unmapped_contaminants=${input.unmappedContaminantCount}`,
      result_summary: "status: active_violations",
    };
  }
  return {
    narration: `I looked across your utility's violation history. No active health-based violations right now${input.recentTotal === 0 ? `, and nothing in the last ${input.recentYears} years.` : `, though there were ${input.recentTotal} reported in the last ${input.recentYears} years that have since been resolved.`}`,
    detail: `health_based_active=0; recent_window=${input.recentYears}y; total_recent=${input.recentTotal}; health_recent=${input.recentHealth}; unmapped_contaminants=${input.unmappedContaminantCount}`,
    result_summary: "status: no_active_violations",
  };
}

export function findingStepNarration(headline: string): {
  narration: string;
  result_summary: string;
} {
  return {
    narration:
      "I put a short finding together for your dashboard with what we know about your water system today.",
    result_summary: headline,
  };
}
