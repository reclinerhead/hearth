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

export function pwsidFetchNarration(input: {
  lat: number;
  lng: number;
  resolved: boolean;
  totalFeatures: number;
}): { narration: string; detail: string; result_summary: string } {
  const { lat, lng, resolved, totalFeatures } = input;
  if (!resolved) {
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
}): { narration: string; detail?: string; result_summary: string } {
  switch (input.branch) {
    case "private_well":
      return {
        narration:
          "Since no public water system covers your address, I'm treating this house as a private-well home for now. We'll add private-well guidance in a future Hearth update.",
        detail: input.diagnostic,
        result_summary: "branch: private_well",
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
