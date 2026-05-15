/**
 * Build-time script that downloads the EPA Map of Radon Zones dataset
 * and emits a typed TypeScript constant the radon module imports at
 * runtime.
 *
 * Run with:
 *   pnpm tsx scripts/build-radon-data.ts
 *
 * Output:
 *   lib/habitat/modules/epa-radon-zone/data.ts
 *
 * The output file is committed to the repo. Re-run this script if EPA
 * updates the upstream JSON (which they did once between 1993 and 2024,
 * so plan on running it approximately never). The diff is the audit
 * trail.
 *
 * Source:
 *   https://www.epa.gov/radon/epa-map-radon-zones-0
 *
 * Upstream file format (June 2024 publication):
 *   {
 *     "data": [
 *       { "County,State": "Kalamazoo, MI",
 *         "COUNTY LABEL": "Kalamazoo County",
 *         "STATE": "Michigan",
 *         "Region": "5",
 *         "Zone": "1" },
 *       ...
 *     ]
 *   }
 *
 * The dataset includes "no data" rows for state headers (e.g. one row
 * per state where COUNTY LABEL is literally "no data") — these are
 * filtered out. A handful of pseudo-states ("UNITED STATES") are also
 * dropped. Everything else is a real county / borough / parish / census
 * area / municipio with a 1/2/3 zone classification.
 */

import { writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

const SOURCE_URL =
  "https://www.epa.gov/system/files/other-files/2024-06/radon-zones-202406.json";

const OUTPUT_PATH = "lib/habitat/modules/epa-radon-zone/data.ts";

// Shape of one record in the upstream JSON. Kept loose because the
// upstream uses quoted keys with commas and spaces that don't make for
// pleasant TypeScript identifiers — we deal with them inline.
type UpstreamRecord = {
  "County,State": string;
  "COUNTY LABEL": string;
  STATE: string;
  Region: string;
  Zone: string;
};

type UpstreamPayload = {
  data: UpstreamRecord[];
};

/**
 * Strip the geography-type suffix from a county label so it can be
 * compared against Mapbox-derived county names. EPA's COUNTY LABEL
 * field includes the suffix ("Kalamazoo County", "Aleutians East
 * Borough", "Orleans Parish", "Yukon-Koyukuk Census Area"). Mapbox
 * strips "County" at extraction time but the others land verbatim.
 *
 * The output is also lowercased so the runtime lookup is
 * case-insensitive — Mapbox's casing is mostly consistent but not
 * guaranteed.
 */
function normalizeCountyName(label: string): string {
  return label
    .replace(/\s+(County|Borough|Parish|Census Area|Municipality)$/i, "")
    .trim()
    .toLowerCase();
}

/**
 * The radon module returns one of these three zone values. Anything
 * else in the upstream data is a malformed row and we throw.
 */
type RadonZone = 1 | 2 | 3;

function parseZone(raw: string): RadonZone | null {
  if (raw === "1") return 1;
  if (raw === "2") return 2;
  if (raw === "3") return 3;
  return null;
}

async function main(): Promise<void> {
  console.log(`Fetching ${SOURCE_URL}...`);
  const response = await fetch(SOURCE_URL);

  if (!response.ok) {
    throw new Error(
      `EPA fetch failed: ${response.status} ${response.statusText}`,
    );
  }

  const text = await response.text();

  // EPA's JSON starts with a BOM (U+FEFF). JSON.parse handles it on
  // some platforms and chokes on others; strip it explicitly to be
  // safe across Node versions.
  const cleaned = text.replace(/^\uFEFF/, "");

  let payload: UpstreamPayload;
  try {
    payload = JSON.parse(cleaned) as UpstreamPayload;
  } catch (err) {
    throw new Error(
      `Could not parse EPA JSON: ${err instanceof Error ? err.message : "unknown"}`,
    );
  }

  if (!Array.isArray(payload.data)) {
    throw new Error("EPA payload missing 'data' array");
  }

  // Group by state, then by normalized county name within state.
  // The final shape we emit is:
  //   Record<stateName, Record<normalizedCountyName, 1 | 2 | 3>>
  //
  // State name matches hearth.houses.state (Mapbox's address_level1,
  // e.g. "Michigan"). County key is normalized to match
  // normalizeForLookup() in the module.
  const byState: Record<string, Record<string, RadonZone>> = {};

  let countiesSeen = 0;
  let skipped = 0;

  for (const row of payload.data) {
    // Skip state-header rows. EPA emits one row per state where
    // STATE is "no data" and County,State is the bare state name.
    if (row.STATE === "no data" || row["COUNTY LABEL"] === "no data") {
      skipped++;
      continue;
    }

    // Skip the synthetic "UNITED STATES" header.
    if (row["County,State"] === "UNITED STATES") {
      skipped++;
      continue;
    }

    const zone = parseZone(row.Zone);
    if (zone === null) {
      console.warn(
        `Skipping row with unparseable zone "${row.Zone}": ${row["County,State"]}`,
      );
      skipped++;
      continue;
    }

    const state = row.STATE.trim();
    const county = normalizeCountyName(row["COUNTY LABEL"]);

    if (!byState[state]) {
      byState[state] = {};
    }

    // Defensive: warn if EPA ever emits two rows for the same
    // (state, normalized county). Shouldn't happen with the current
    // dataset but cheap to catch if it ever does.
    if (byState[state][county] !== undefined) {
      console.warn(
        `Duplicate county after normalization: ${state} / ${county}`,
      );
    }

    byState[state][county] = zone;
    countiesSeen++;
  }

  console.log(
    `Parsed ${countiesSeen} counties across ${Object.keys(byState).length} states/territories (${skipped} header rows skipped).`,
  );

  // Sort keys for deterministic output — re-running the script with
  // an identical upstream produces a byte-identical file.
  const sortedStates = Object.keys(byState).sort();
  const sortedByState: Record<string, Record<string, RadonZone>> = {};
  for (const state of sortedStates) {
    const sortedCounties = Object.keys(byState[state]).sort();
    sortedByState[state] = {};
    for (const county of sortedCounties) {
      sortedByState[state][county] = byState[state][county];
    }
  }

  const generatedAt = new Date().toISOString();
  const body = renderDataFile(sortedByState, generatedAt);

  mkdirSync(dirname(OUTPUT_PATH), { recursive: true });
  writeFileSync(OUTPUT_PATH, body, "utf8");

  console.log(`Wrote ${OUTPUT_PATH}`);
  // Spot-check Kalamazoo, MI = Zone 1 since that's the live test case.
  const kalamazoo = sortedByState["Michigan"]?.["kalamazoo"];
  if (kalamazoo !== 1) {
    throw new Error(
      `Sanity check failed: expected Kalamazoo, MI = Zone 1, got ${kalamazoo}`,
    );
  }
  console.log("Sanity check passed: Kalamazoo, MI = Zone 1.");
}

function renderDataFile(
  byState: Record<string, Record<string, RadonZone>>,
  generatedAt: string,
): string {
  const lines: string[] = [
    "// DO NOT EDIT — generated by scripts/build-radon-data.ts",
    "//",
    "// Source: https://www.epa.gov/radon/epa-map-radon-zones-0",
    "// Upstream JSON: https://www.epa.gov/system/files/other-files/2024-06/radon-zones-202406.json",
    `// Generated at: ${generatedAt}`,
    "//",
    "// Re-run with: pnpm tsx scripts/build-radon-data.ts",
    "//",
    "// The EPA Map of Radon Zones was developed in 1993 and last",
    "// republished by EPA in June 2024. The map should not be used to",
    "// determine whether an individual home needs to be tested for radon;",
    "// EPA recommends testing every home regardless of zone.",
    "",
    "/**",
    " * EPA radon zone for a county.",
    " *   1 — highest potential (predicted indoor avg > 4 pCi/L)",
    " *   2 — moderate potential (2 to 4 pCi/L)",
    " *   3 — low potential (< 2 pCi/L)",
    " */",
    "export type RadonZone = 1 | 2 | 3;",
    "",
    "/**",
    " * Lookup table keyed by full state name (matches hearth.houses.state)",
    " * and normalized county name (lowercased, geography-type suffix",
    " * stripped — e.g. 'kalamazoo' for 'Kalamazoo County',",
    " * 'aleutians east' for 'Aleutians East Borough').",
    " *",
    " * Use normalizeForLookup() from the module's index.ts to produce the",
    " * county key — do not access this object directly with raw input.",
    " */",
    "export const RADON_ZONES_BY_STATE: Readonly<",
    "  Record<string, Readonly<Record<string, RadonZone>>>",
    "> = {",
  ];

  for (const state of Object.keys(byState)) {
    lines.push(`  ${JSON.stringify(state)}: {`);
    for (const county of Object.keys(byState[state])) {
      lines.push(`    ${JSON.stringify(county)}: ${byState[state][county]},`);
    }
    lines.push("  },");
  }

  lines.push("};", "");

  return lines.join("\n");
}

main().catch((err) => {
  console.error("Build failed:", err);
  process.exit(1);
});
