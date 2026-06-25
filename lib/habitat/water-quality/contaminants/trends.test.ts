import { describe, it, expect } from "vitest";
import type {
  CcrExtractionResult,
  CcrDetectedContaminant,
} from "@/lib/documents/ai/ccr-schema";
import {
  applyTrendEscalation,
  buildCcrReportIndex,
  buildContaminantHistory,
  buildTrendClipboardTsv,
  computeTrend,
  findSeriesByName,
  sparklineGeometry,
  trendChartGeometry,
  trendDataSpanLabel,
  trendPreviousLabel,
  trendTone,
  trendWord,
  TREND_STABLE_TOLERANCE,
  type ContaminantSeries,
} from "./trends";
import type { CcrSummarizedContaminant } from "@/lib/habitat/modules/water-quality-awareness/ccr";

/* ---------- fixtures ---------------------------------------------------- */

function detected(
  partial: Partial<CcrDetectedContaminant> &
    Pick<CcrDetectedContaminant, "contaminant_name">,
): CcrDetectedContaminant {
  return {
    contaminant_name: partial.contaminant_name,
    contaminant_code: partial.contaminant_code ?? null,
    detected_level: partial.detected_level ?? null,
    unit: partial.unit ?? null,
    mcl: partial.mcl ?? null,
    mclg: partial.mclg ?? null,
    mcl_action_level: partial.mcl_action_level ?? null,
    sources: partial.sources ?? null,
    monitoring_period: partial.monitoring_period ?? null,
    violation_in_period_ind: partial.violation_in_period_ind ?? null,
    notes: partial.notes ?? null,
    source_table_label: partial.source_table_label ?? null,
  };
}

function extraction(
  detected_contaminants: CcrDetectedContaminant[] | null,
  extra?: Partial<CcrExtractionResult>,
): CcrExtractionResult {
  return {
    header_metadata: null,
    detected_contaminants,
    lead_copper_distribution: extra?.lead_copper_distribution ?? null,
    ucmr_results: extra?.ucmr_results ?? null,
    free_testing_offer: null,
    ai_confidence: 0.9,
  };
}

function year(
  report_year: number,
  detected_contaminants: CcrDetectedContaminant[] | null,
  extra?: Partial<CcrExtractionResult>,
) {
  return {
    report_year,
    published_date: null,
    extracted_data: extraction(detected_contaminants, extra),
  };
}

function series(
  key: string,
  points: Array<{
    year: number;
    level: number;
    unit?: string | null;
    limit?: number | null;
  }>,
): ContaminantSeries {
  return {
    key,
    display_name: key,
    unit: points.length ? (points[points.length - 1].unit ?? null) : null,
    points: points.map((p) => ({
      year: p.year,
      level: p.level,
      unit: p.unit ?? null,
      limit: p.limit ?? null,
    })),
  };
}

function summarized(
  name: string,
  tier: CcrSummarizedContaminant["tier"],
  level: number | null,
  mcl: number | null,
): CcrSummarizedContaminant {
  return {
    contaminant_name: name,
    contaminant_code: null,
    detected_level: level,
    unit: "ppb",
    mcl,
    mclg: null,
    mcl_action_level: null,
    sources: null,
    monitoring_period: null,
    violation_in_period_ind: null,
    notes: null,
    source_table_label: null,
    tier,
    has_multiple_observations: false,
    other_observations: [],
  };
}

/* ---------- computeTrend ----------------------------------------------- */

describe("computeTrend", () => {
  it("returns not_comparable with no readings", () => {
    const t = computeTrend(series("x", []));
    expect(t.direction).toBe("not_comparable");
    expect(t.yearsOfData).toBe(0);
    expect(t.pctChange).toBeNull();
  });

  it("returns first_year for a single reading", () => {
    const t = computeTrend(series("nitrate", [{ year: 2025, level: 1.2 }]));
    expect(t.direction).toBe("first_year");
    expect(t.yearsOfData).toBe(1);
    expect(t.latestYear).toBe(2025);
    expect(t.previous).toBeNull();
  });

  it("flags a clear rise", () => {
    const t = computeTrend(
      series("pfoa", [
        { year: 2024, level: 2.0 },
        { year: 2025, level: 4.0 },
      ]),
    );
    expect(t.direction).toBe("rising");
    expect(t.pctChange).toBeCloseTo(1.0);
  });

  it("flags a clear fall", () => {
    const t = computeTrend(
      series("pfos", [
        { year: 2024, level: 5.0 },
        { year: 2025, level: 2.5 },
      ]),
    );
    expect(t.direction).toBe("falling");
    expect(t.pctChange).toBeCloseTo(-0.5);
  });

  it("treats an identical repeated sample as stable", () => {
    const t = computeTrend(
      series("fluoride", [
        { year: 2023, level: 0.7 },
        { year: 2024, level: 0.7 },
      ]),
    );
    expect(t.direction).toBe("stable");
    expect(t.pctChange).toBe(0);
  });

  it("keeps a change inside the tolerance band stable", () => {
    // +9% < 10% tolerance
    const t = computeTrend(
      series("barium", [
        { year: 2024, level: 100 },
        { year: 2025, level: 109 },
      ]),
    );
    expect(t.direction).toBe("stable");
  });

  it("breaks out of stable just past the tolerance band", () => {
    // +11% > 10% tolerance
    const t = computeTrend(
      series("barium", [
        { year: 2024, level: 100 },
        { year: 2025, level: 111 },
      ]),
    );
    expect(t.direction).toBe("rising");
  });

  it("uses exactly the tolerance edge as stable", () => {
    const t = computeTrend(
      series("x", [
        { year: 2024, level: 100 },
        { year: 2025, level: 100 + 100 * TREND_STABLE_TOLERANCE },
      ]),
    );
    expect(t.direction).toBe("stable");
  });

  it("compares the two most recent readings across a gap", () => {
    const t = computeTrend(
      series("pfoa", [
        { year: 2019, level: 1.0 },
        { year: 2025, level: 3.0 },
      ]),
    );
    expect(t.direction).toBe("rising");
    expect(t.previous?.year).toBe(2019);
    expect(t.latest?.year).toBe(2025);
    expect(t.firstYear).toBe(2019);
    expect(t.latestYear).toBe(2025);
  });

  it("is not_comparable when the two latest readings use different units", () => {
    const t = computeTrend(
      series("lead", [
        { year: 2024, level: 5, unit: "ppb" },
        { year: 2025, level: 0.005, unit: "mg/L" },
      ]),
    );
    expect(t.direction).toBe("not_comparable");
    expect(t.pctChange).toBeNull();
  });

  it("is not_comparable when the previous level is non-positive", () => {
    const t = computeTrend(
      series("x", [
        { year: 2024, level: 0 },
        { year: 2025, level: 3 },
      ]),
    );
    expect(t.direction).toBe("not_comparable");
  });

  it("handles null/undefined series", () => {
    expect(computeTrend(null).direction).toBe("not_comparable");
    expect(computeTrend(undefined).yearsOfData).toBe(0);
  });
});

/* ---------- buildContaminantHistory ------------------------------------ */

describe("buildContaminantHistory", () => {
  it("groups a regulated analyte across years, oldest first", () => {
    const history = buildContaminantHistory([
      year(2025, [
        detected({ contaminant_name: "Nitrate", detected_level: 3.1, unit: "ppm", mcl: 10 }),
      ]),
      year(2024, [
        detected({ contaminant_name: "Nitrate", detected_level: 2.4, unit: "ppm", mcl: 10 }),
      ]),
    ]);
    const s = findSeriesByName(history, "Nitrate");
    expect(s).not.toBeNull();
    expect(s!.points.map((p) => p.year)).toEqual([2024, 2025]);
    expect(s!.points.map((p) => p.level)).toEqual([2.4, 3.1]);
  });

  it("matches the same analyte across name casing/whitespace", () => {
    const history = buildContaminantHistory([
      year(2024, [detected({ contaminant_name: "PFOA", detected_level: 2, unit: "ppt", mcl: 4 })]),
      year(2025, [detected({ contaminant_name: " pfoa ", detected_level: 3, unit: "ppt", mcl: 4 })]),
    ]);
    const s = findSeriesByName(history, "pfoa");
    expect(s!.points).toHaveLength(2);
  });

  it("drops non-detect / zero / null readings (no fabricated points)", () => {
    const history = buildContaminantHistory([
      year(2024, [detected({ contaminant_name: "Atrazine", detected_level: null, unit: "ppb", mcl: 3 })]),
      year(2025, [detected({ contaminant_name: "Atrazine", detected_level: 0, unit: "ppb", mcl: 3 })]),
    ]);
    expect(findSeriesByName(history, "Atrazine")).toBeNull();
  });

  it("folds detected UCMR (PFAS) rows into the history", () => {
    const history = buildContaminantHistory([
      year(2024, null, {
        ucmr_results: [
          { contaminant_name: "PFOS", detected_level: 1.5, unit: "ppt", monitoring_period: "2024" },
        ],
      }),
      year(2025, null, {
        ucmr_results: [
          { contaminant_name: "PFOS", detected_level: 2.5, unit: "ppt", monitoring_period: "2025" },
        ],
      }),
    ]);
    const s = findSeriesByName(history, "PFOS");
    expect(s).not.toBeNull();
    expect(computeTrend(s).direction).toBe("rising");
  });

  it("folds the lead/copper distribution into the history", () => {
    const lcEntry = (p90: number) => ({
      lead_copper_distribution: {
        lead: {
          percentile_90: p90,
          unit: "ppb",
          action_level: 15,
          samples_collected: 50,
          samples_exceeding_action_level: 0,
          monitoring_period: "2024",
        },
        copper: null,
        lead_service_line_count: null,
      },
    });
    const history = buildContaminantHistory([
      year(2023, null, lcEntry(3)),
      year(2024, null, lcEntry(6)),
    ]);
    const s = findSeriesByName(history, "Lead");
    expect(s).not.toBeNull();
    expect(s!.points.map((p) => p.level)).toEqual([3, 6]);
  });

  it("returns deterministic alphabetical series order", () => {
    const history = buildContaminantHistory([
      year(2025, [
        detected({ contaminant_name: "Zinc", detected_level: 1, unit: "ppm" }),
        detected({ contaminant_name: "Arsenic", detected_level: 1, unit: "ppb", mcl: 10 }),
      ]),
    ]);
    expect(history.map((s) => s.key)).toEqual(["arsenic", "zinc"]);
  });

  it("returns an empty history for no uploaded years", () => {
    expect(buildContaminantHistory([])).toEqual([]);
  });
});

/* ---------- applyTrendEscalation --------------------------------------- */

describe("applyTrendEscalation", () => {
  const risingArsenic = series("arsenic", [
    { year: 2024, level: 0.64 },
    { year: 2025, level: 7.8 },
  ]);

  it("escalates a rising, approaching context row to caution", () => {
    // 7.8 / 10 = 0.78 — in the [0.5, 0.8) band, and rising.
    const [out] = applyTrendEscalation(
      [summarized("Arsenic", "context", 7.8, 10)],
      [risingArsenic],
    );
    expect(out.tier).toBe("caution");
  });

  it("leaves a rising row that is still far below the limit", () => {
    const lowRising = series("nitrate", [
      { year: 2024, level: 1 },
      { year: 2025, level: 2 },
    ]);
    const [out] = applyTrendEscalation(
      [summarized("Nitrate", "context", 2, 10)], // ratio 0.2 < floor
      [lowRising],
    );
    expect(out.tier).toBe("context");
  });

  it("leaves an approaching but falling row alone", () => {
    const falling = series("arsenic", [
      { year: 2024, level: 9 },
      { year: 2025, level: 7.8 },
    ]);
    const [out] = applyTrendEscalation(
      [summarized("Arsenic", "context", 7.8, 10)],
      [falling],
    );
    expect(out.tier).toBe("context");
  });

  it("does not escalate when there is no comparable limit", () => {
    const [out] = applyTrendEscalation(
      [summarized("Mystery", "context", 7.8, null)],
      [],
    );
    expect(out.tier).toBe("context");
  });

  it("never re-tiers a row that is already above context", () => {
    const [out] = applyTrendEscalation(
      [summarized("Arsenic", "caution", 7.8, 10)],
      [risingArsenic],
    );
    expect(out.tier).toBe("caution"); // unchanged, not bumped to concern
  });

  it("escalates exactly at the approaching floor (ratio = 0.5)", () => {
    const s = series("x", [
      { year: 2024, level: 4 },
      { year: 2025, level: 5 },
    ]);
    const [out] = applyTrendEscalation(
      [summarized("X", "context", 5, 10)], // ratio 0.5
      [s],
    );
    expect(out.tier).toBe("caution");
  });

  it("leaves context rows with no history untouched", () => {
    const [out] = applyTrendEscalation(
      [summarized("Arsenic", "context", 7.8, 10)],
      null,
    );
    expect(out.tier).toBe("context");
  });
});

/* ---------- buildCcrReportIndex ---------------------------------------- */

describe("buildCcrReportIndex", () => {
  it("returns one entry per year, newest first, with detected counts + dates", () => {
    const index = buildCcrReportIndex([
      {
        report_year: 2023,
        published_date: null,
        extracted_at: "2024-05-01T00:00:00Z",
        extracted_data: extraction([
          detected({ contaminant_name: "Nitrate", detected_level: 2, unit: "ppm", mcl: 10 }),
        ]),
      },
      {
        report_year: 2025,
        published_date: "2026-05-01",
        extracted_at: "2026-05-10T00:00:00Z",
        extracted_data: extraction([
          detected({ contaminant_name: "Nitrate", detected_level: 3, unit: "ppm", mcl: 10 }),
          detected({ contaminant_name: "Lead", detected_level: 5, unit: "ppb", mcl: 15 }),
        ]),
      },
    ]);
    expect(index.map((e) => e.report_year)).toEqual([2025, 2023]);
    expect(index[0].detected_count).toBe(2);
    expect(index[1].detected_count).toBe(1);
    expect(index[0].published_date).toBe("2026-05-01");
    expect(index[0].extracted_at).toBe("2026-05-10T00:00:00Z");
  });

  it("returns an empty index for no years", () => {
    expect(buildCcrReportIndex([])).toEqual([]);
  });
});

/* ---------- per-year limit in history ---------------------------------- */

describe("buildContaminantHistory — per-year limit (issue #293)", () => {
  it("carries each year's stated MCL onto its point", () => {
    const history = buildContaminantHistory([
      year(2024, [
        detected({ contaminant_name: "Arsenic", detected_level: 5, unit: "ppb", mcl: 10 }),
      ]),
      year(2025, [
        detected({ contaminant_name: "Arsenic", detected_level: 7.8, unit: "ppb", mcl: 10 }),
      ]),
    ]);
    const s = findSeriesByName(history, "Arsenic");
    expect(s!.points.map((p) => p.limit)).toEqual([10, 10]);
  });

  it("reflects a historical limit change per-year (not today's value backward)", () => {
    const history = buildContaminantHistory([
      year(2021, [
        detected({ contaminant_name: "X", detected_level: 3, unit: "ppb", mcl: 10 }),
      ]),
      year(2024, [
        detected({ contaminant_name: "X", detected_level: 3, unit: "ppb", mcl: 4 }),
      ]),
    ]);
    const s = findSeriesByName(history, "X");
    expect(s!.points.map((p) => p.limit)).toEqual([10, 4]);
  });

  it("falls back to the LCR action level when there's no MCL (lead)", () => {
    const history = buildContaminantHistory([
      year(2023, null, {
        lead_copper_distribution: {
          lead: {
            percentile_90: 6,
            unit: "ppb",
            action_level: 15,
            samples_collected: null,
            samples_exceeding_action_level: null,
            monitoring_period: "2023",
          },
          copper: null,
          lead_service_line_count: null,
        },
      }),
      year(2024, null, {
        lead_copper_distribution: {
          lead: {
            percentile_90: 9,
            unit: "ppb",
            action_level: 15,
            samples_collected: null,
            samples_exceeding_action_level: null,
            monitoring_period: "2024",
          },
          copper: null,
          lead_service_line_count: null,
        },
      }),
    ]);
    const s = findSeriesByName(history, "Lead");
    expect(s!.points.map((p) => p.limit)).toEqual([15, 15]);
  });
});

/* ---------- buildTrendClipboardTsv ------------------------------------- */

describe("buildTrendClipboardTsv", () => {
  const points = [
    { year: 2024, level: 6.2, unit: "ppb", limit: 10 },
    { year: 2025, level: 7.8, unit: "ppb", limit: 10 },
  ];

  it("leads with provenance, then a tab-separated table", () => {
    const tsv = buildTrendClipboardTsv({
      analyteName: "Arsenic",
      utilityName: "Kalamazoo Public Water Supply",
      pwsid: "MI0003520",
      points,
    });
    const lines = tsv.split("\n");
    expect(lines[0]).toBe("Arsenic");
    expect(lines[1]).toBe("Kalamazoo Public Water Supply · PWSID MI0003520");
    expect(lines[2]).toBe(
      "Source: your 2024–2025 Water Quality Reports (via Hearth)",
    );
    expect(lines[3]).toBe("");
    expect(lines[4]).toBe("Year\tLevel\tUnit\tEPA limit");
    expect(lines[5]).toBe("2024\t6.2\tppb\t10");
    expect(lines[6]).toBe("2025\t7.8\tppb\t10");
  });

  it("sorts oldest-first and leaves an empty cell when a year stated no limit", () => {
    const tsv = buildTrendClipboardTsv({
      analyteName: "X",
      utilityName: null,
      pwsid: null,
      points: [
        { year: 2025, level: 2, unit: "ppb", limit: null },
        { year: 2023, level: 1, unit: "ppb", limit: 4 },
      ],
    });
    const lines = tsv.split("\n");
    // No utility/pwsid line — provenance is just the name + source span.
    expect(lines[0]).toBe("X");
    expect(lines[1]).toBe(
      "Source: your 2023–2025 Water Quality Reports (via Hearth)",
    );
    const rows = lines.slice(lines.indexOf("Year\tLevel\tUnit\tEPA limit") + 1);
    expect(rows[0]).toBe("2023\t1\tppb\t4");
    expect(rows[1]).toBe("2025\t2\tppb\t"); // limit cell empty
  });
});

/* ---------- trendChartGeometry ----------------------------------------- */

describe("trendChartGeometry", () => {
  it("returns null for fewer than two readings", () => {
    expect(
      trendChartGeometry([{ year: 2025, level: 1, unit: "ppb", limit: 10 }], {
        width: 440,
        height: 240,
      }),
    ).toBeNull();
  });

  it("spreads years across the plot, inverts y, and starts at zero", () => {
    const geo = trendChartGeometry(
      [
        { year: 2023, level: 2, unit: "ppb", limit: 10 },
        { year: 2024, level: 5, unit: "ppb", limit: 10 },
        { year: 2025, level: 8, unit: "ppb", limit: 10 },
      ],
      { width: 440, height: 240 },
    )!;
    expect(geo.points).toHaveLength(3);
    expect(geo.points[0].x).toBe(geo.plot.left);
    expect(geo.points[2].x).toBe(geo.plot.right);
    // higher level → smaller y (closer to the top)
    expect(geo.points[0].y).toBeGreaterThan(geo.points[2].y);
    // a zero value lands on the baseline
    const zeroTick = geo.yTicks.find((t) => t.value === 0)!;
    expect(zeroTick.y).toBe(geo.plot.bottom);
  });

  it("keeps the y-axis above both the peak reading and the limit", () => {
    const geo = trendChartGeometry(
      [
        { year: 2024, level: 3, unit: "ppb", limit: 10 },
        { year: 2025, level: 7.8, unit: "ppb", limit: 10 },
      ],
      { width: 440, height: 240 },
    )!;
    expect(geo.yMax).toBeGreaterThan(10);
  });

  it("builds a per-year limit line, stepping when the limit changes", () => {
    const geo = trendChartGeometry(
      [
        { year: 2021, level: 3, unit: "ppb", limit: 10 },
        { year: 2024, level: 3, unit: "ppb", limit: 4 },
      ],
      { width: 440, height: 240 },
    )!;
    expect(geo.limitPolyline).not.toBeNull();
    // the two limit points sit at different heights (10 vs 4) → a step
    expect(geo.points[0].limitY).not.toBe(geo.points[1].limitY);
    expect(geo.points[0].limit).toBe(10);
    expect(geo.points[1].limit).toBe(4);
  });

  it("omits the limit line when no year stated a limit", () => {
    const geo = trendChartGeometry(
      [
        { year: 2024, level: 3, unit: "ppb", limit: null },
        { year: 2025, level: 4, unit: "ppb", limit: null },
      ],
      { width: 440, height: 240 },
    )!;
    expect(geo.limitPolyline).toBeNull();
    expect(geo.points.every((p) => p.limitY === null)).toBe(true);
  });
});

/* ---------- labels / tone ---------------------------------------------- */

describe("trend labels", () => {
  it("words each direction honestly", () => {
    expect(trendWord("rising")).toBe("Rising");
    expect(trendWord("falling")).toBe("Falling");
    expect(trendWord("stable")).toBe("Stable");
    expect(trendWord("first_year")).toBe("First year of data");
    expect(trendWord("not_comparable")).toBe("Trend unclear");
  });

  it("maps tone: rising→attention, falling→positive, else neutral", () => {
    expect(trendTone("rising")).toBe("attention");
    expect(trendTone("falling")).toBe("positive");
    expect(trendTone("stable")).toBe("neutral");
    expect(trendTone("first_year")).toBe("neutral");
    expect(trendTone("not_comparable")).toBe("neutral");
  });

  it("states the data span exactly, never overstating", () => {
    expect(trendDataSpanLabel(computeTrend(series("x", [])))).toBe(
      "No prior readings",
    );
    expect(
      trendDataSpanLabel(computeTrend(series("x", [{ year: 2025, level: 1 }]))),
    ).toBe("1 reading · 2025");
    expect(
      trendDataSpanLabel(
        computeTrend(
          series("x", [
            { year: 2024, level: 1 },
            { year: 2025, level: 2 },
          ]),
        ),
      ),
    ).toBe("2 readings · 2024–2025");
    expect(
      trendDataSpanLabel(
        computeTrend(
          series("x", [
            { year: 2019, level: 1 },
            { year: 2022, level: 2 },
            { year: 2025, level: 3 },
          ]),
        ),
      ),
    ).toBe("3 readings · 2019–2025");
  });

  it("captions the previous value with its year, empty when none", () => {
    expect(
      trendPreviousLabel(
        computeTrend(
          series("pfoa", [
            { year: 2024, level: 2.4, unit: "ppt" },
            { year: 2025, level: 3.1, unit: "ppt" },
          ]),
        ),
      ),
    ).toBe("was 2.4 ppt in 2024");
    expect(
      trendPreviousLabel(computeTrend(series("x", [{ year: 2025, level: 1 }]))),
    ).toBe("");
  });
});

/* ---------- sparkline geometry ----------------------------------------- */

describe("sparklineGeometry", () => {
  it("returns null for fewer than two readings", () => {
    expect(sparklineGeometry([], { width: 60, height: 18 })).toBeNull();
    expect(
      sparklineGeometry([{ year: 2025, level: 1, unit: null }], {
        width: 60,
        height: 18,
      }),
    ).toBeNull();
  });

  it("spreads dots horizontally and inverts the y axis (max at top)", () => {
    const geo = sparklineGeometry(
      [
        { year: 2023, level: 0, unit: null },
        { year: 2024, level: 5, unit: null },
        { year: 2025, level: 10, unit: null },
      ],
      { width: 62, height: 20, padding: 2 },
    )!;
    expect(geo.dots).toHaveLength(3);
    // first dot at left edge, last at right edge
    expect(geo.dots[0].x).toBe(2);
    expect(geo.dots[2].x).toBe(60);
    // lowest level → bottom (largest y); highest level → top (smallest y)
    expect(geo.dots[0].y).toBeGreaterThan(geo.dots[2].y);
    expect(geo.polyline.split(" ")).toHaveLength(3);
  });

  it("draws a flat centered line for an all-equal series", () => {
    const geo = sparklineGeometry(
      [
        { year: 2024, level: 3, unit: null },
        { year: 2025, level: 3, unit: null },
      ],
      { width: 60, height: 20, padding: 2 },
    )!;
    expect(geo.dots[0].y).toBe(geo.dots[1].y);
    expect(geo.dots[0].y).toBe(10); // pad + innerH/2 = 2 + 16/2
  });
});
