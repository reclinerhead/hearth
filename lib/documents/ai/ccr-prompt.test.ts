// Regression tests for the CCR extraction prompt. Issue #176 — WQA-3.
//
// The prompt's two contracts are load-bearing for every downstream WQA
// surface:
//
//   1. Schema fidelity. The model must populate exactly the five
//      sections (header_metadata, detected_contaminants, lead_copper_
//      distribution, ucmr_results, free_testing_offer) — no more, no
//      less. The pinned assertions below catch silent edits that drop
//      a section or add a sixth.
//
//   2. Scope discipline (the headline new contract for WQA-3). The
//      prompt MUST explicitly instruct the model to ignore marketing,
//      educational, source-water-assessment, infrastructure-
//      improvement, customer-tip, and other narrative content. The
//      pinned assertions below catch silent edits that paraphrase the
//      ignore-narrative rule away.
//
// Same anti-leak discipline as issue #81's nameplate prompt — example
// values must be angle-bracket placeholders, never literal contaminant
// names or utility names. The anti-leak block at the bottom catches
// any future edit that re-introduces specific-looking literals.

import { describe, it, expect } from "vitest";
import { buildCcrSystemPrompt, buildCcrUserPrompt } from "./ccr-prompt";

describe("buildCcrSystemPrompt", () => {
  it("returns a non-empty string", () => {
    expect(buildCcrSystemPrompt().length).toBeGreaterThan(0);
  });

  it("is deterministic across calls", () => {
    expect(buildCcrSystemPrompt()).toBe(buildCcrSystemPrompt());
  });

  it("frames the input as a Consumer Confidence Report (CCR)", () => {
    const prompt = buildCcrSystemPrompt();
    expect(prompt).toMatch(/Consumer Confidence Report/i);
    expect(prompt).toMatch(/CCR/);
  });

  describe("the five extraction sections", () => {
    // The schema in ccr-schema.ts pins these section names; the prompt
    // must use the exact names so generateObject's validation passes.

    it("names header_metadata as a top-level section", () => {
      expect(buildCcrSystemPrompt()).toContain("header_metadata");
    });

    it("names detected_contaminants as a top-level section", () => {
      expect(buildCcrSystemPrompt()).toContain("detected_contaminants");
    });

    it("names lead_copper_distribution as a top-level section", () => {
      expect(buildCcrSystemPrompt()).toContain("lead_copper_distribution");
    });

    it("names ucmr_results as a top-level section", () => {
      expect(buildCcrSystemPrompt()).toContain("ucmr_results");
    });

    it("names free_testing_offer as a top-level section", () => {
      expect(buildCcrSystemPrompt()).toContain("free_testing_offer");
    });

    it("names ai_confidence as the overall extraction confidence field", () => {
      expect(buildCcrSystemPrompt()).toContain("ai_confidence");
    });

    it("names every per-contaminant field the schema requires", () => {
      const prompt = buildCcrSystemPrompt();
      for (const field of [
        "contaminant_name",
        "contaminant_code",
        "detected_level",
        "unit",
        "mcl",
        "mclg",
        "mcl_action_level",
        "sources",
        "monitoring_period",
        "violation_in_period_ind",
      ]) {
        expect(prompt).toContain(field);
      }
    });

    it("names the lead-copper distribution sub-fields", () => {
      const prompt = buildCcrSystemPrompt();
      for (const field of [
        "percentile_90",
        "action_level",
        "samples_collected",
        "samples_exceeding_action_level",
        "lead_service_line_count",
      ]) {
        expect(prompt).toContain(field);
      }
    });

    it("names the free-testing offer fields", () => {
      const prompt = buildCcrSystemPrompt();
      expect(prompt).toContain("offered");
      expect(prompt).toContain("contact_method");
      expect(prompt).toContain("contact_value");
      expect(prompt).toMatch(/phone/);
      expect(prompt).toMatch(/email/);
      expect(prompt).toMatch(/web/);
    });
  });

  describe("scope discipline — ignore-narrative rule (WQA-3 headline contract)", () => {
    // These assertions pin the load-bearing scope-discipline copy. If
    // a future edit paraphrases the rule away, every downstream WQA
    // surface starts absorbing marketing/educational/source-water
    // narrative that has no schema home. The fix is to make these
    // assertions fail loudly so the regression is caught.

    it("explicitly instructs the model to ignore marketing, educational, and regulatory-background content", () => {
      const prompt = buildCcrSystemPrompt();
      expect(prompt).toMatch(
        /Ignore all marketing, educational, regulatory-background/,
      );
    });

    it("explicitly names source-water assessments as out of scope", () => {
      expect(buildCcrSystemPrompt()).toMatch(/source-water assessments/i);
    });

    it("explicitly names infrastructure improvement as out of scope", () => {
      expect(buildCcrSystemPrompt()).toMatch(/infrastructure improvement/i);
    });

    it("explicitly names customer tips as out of scope", () => {
      expect(buildCcrSystemPrompt()).toMatch(/customer tips/i);
    });

    it("explicitly names awards / recognitions / certifications as out of scope", () => {
      const prompt = buildCcrSystemPrompt();
      expect(prompt).toMatch(/Awards/);
      expect(prompt).toMatch(/recognitions/i);
    });

    it("explicitly names photos / staff bios / message-from-the-director as out of scope", () => {
      const prompt = buildCcrSystemPrompt();
      expect(prompt).toMatch(/photographs/i);
      expect(prompt).toMatch(/staff bios/i);
      expect(prompt).toMatch(/message-from-the-director/i);
    });

    it("explicitly names rate structures / billing / pricing as out of scope", () => {
      const prompt = buildCcrSystemPrompt();
      expect(prompt).toMatch(/Pricing/);
      expect(prompt).toMatch(/rate structures/i);
      expect(prompt).toMatch(/billing/i);
    });

    it("explicitly names climate / sustainability copy as out of scope", () => {
      expect(buildCcrSystemPrompt()).toMatch(/climate \/ sustainability/i);
    });

    it("explains the consequence of extracting out-of-scope content (no schema home, wasted effort)", () => {
      // Naming the consequence in the prompt itself helps the model
      // calibrate on edge cases without us enumerating every
      // category of fluff. Removing this rationale is a regression.
      const prompt = buildCcrSystemPrompt();
      expect(prompt).toMatch(/nowhere to land/i);
    });

    it("explicitly excludes lead service line replacement program narrative (keeping only the count)", () => {
      const prompt = buildCcrSystemPrompt();
      expect(prompt).toMatch(/Lead service line replacement program narrative/i);
      expect(prompt).toMatch(/lead_service_line_count/);
    });

    it("explicitly excludes compliance prose (data comes from SDWIS)", () => {
      const prompt = buildCcrSystemPrompt();
      expect(prompt).toMatch(/Compliance prose/i);
      expect(prompt).toMatch(/SDWIS/);
    });
  });

  describe("load-bearing extraction rules", () => {
    it("instructs the model to return null rather than fabricate", () => {
      const prompt = buildCcrSystemPrompt();
      expect(prompt).toMatch(/Return null for any section you cannot read confidently/);
      expect(prompt).toMatch(/Do not fabricate/);
    });

    it("instructs the model to use units as printed (no conversion)", () => {
      const prompt = buildCcrSystemPrompt();
      expect(prompt).toMatch(/Use the units as printed in the report/);
      expect(prompt).toMatch(/Do not convert ppb to mg\/L/);
    });

    it("instructs the model to set the violation flag only when the report flags it", () => {
      expect(buildCcrSystemPrompt()).toMatch(
        /Set the violation_in_period_ind only when the report itself flags it/,
      );
    });

    it("tells the model to skip non-detect rows", () => {
      const prompt = buildCcrSystemPrompt();
      expect(prompt).toMatch(/Skip rows for non-detect contaminants/i);
    });

    it("distinguishes empty arrays from null", () => {
      const prompt = buildCcrSystemPrompt();
      expect(prompt).toMatch(/Empty arrays/);
      expect(prompt).toMatch(/Null is the correct shape when the section is missing/);
    });

    it("uses ai_confidence < 0.3 as the failed-extraction escape valve", () => {
      expect(buildCcrSystemPrompt()).toMatch(/below 0\.3/i);
    });

    it("frames report_year as the COVERAGE year, not the publication year", () => {
      const prompt = buildCcrSystemPrompt();
      expect(prompt).toMatch(/COVERAGE year/);
      expect(prompt).toMatch(/NOT the publication year/);
    });

    it("uses ISO YYYY-MM-DD for publication_date", () => {
      expect(buildCcrSystemPrompt()).toMatch(/ISO YYYY-MM-DD/);
    });
  });

  describe("anti-leak guard (#81 mirror)", () => {
    // CCR prompts run on uploaded utility documents — if example
    // contaminant names or MCL values leak, every Hearth user could
    // end up with the leaked value in their extraction. These
    // assertions catch any future edit that re-introduces literals.

    it("uses angle-bracket placeholder syntax for the example values", () => {
      const prompt = buildCcrSystemPrompt();
      expect(prompt).toMatch(/<contaminant name as printed>/);
      expect(prompt).toMatch(/<unit as printed>/);
    });

    it("does not embed plausible-looking literal contaminant names", () => {
      const prompt = buildCcrSystemPrompt();
      // These are the contaminants most likely to be used as examples
      // because they're the highest-profile CCR entries. If a future
      // edit adds a literal `"Lead"` or `"PFOA"` as an example value,
      // the model could echo it into extractions for utilities that
      // don't report them.
      // Note: we intentionally allow the words "lead" and "copper" in
      // narrative context (e.g. naming the lead_copper_distribution
      // section); only literal example *values* are prohibited.
      expect(prompt).not.toMatch(/"contaminant_name":\s*"Lead"/);
      expect(prompt).not.toMatch(/"contaminant_name":\s*"Copper"/);
      expect(prompt).not.toMatch(/"contaminant_name":\s*"PFOA"/);
      expect(prompt).not.toMatch(/"contaminant_name":\s*"PFOS"/);
      expect(prompt).not.toMatch(/"contaminant_name":\s*"TTHM"/);
    });

    it("does not embed plausible-looking literal utility names", () => {
      const prompt = buildCcrSystemPrompt();
      // Kalamazoo is the reference utility in the WQA design docs and
      // a tempting place for a literal example to creep in. Keep it
      // out of the prompt itself — the user-prompt builder injects
      // the actual utility name at call time.
      expect(prompt).not.toMatch(/Kalamazoo/);
      expect(prompt).not.toMatch(/City of /);
    });

    it("does not embed plausible-looking literal numeric values that could leak", () => {
      const prompt = buildCcrSystemPrompt();
      // Common CCR-shaped numerics that, if used as literal examples,
      // could echo into real extractions: lead action level (0.015 mg/L
      // or 15 ppb), copper action level (1.3 mg/L), MCL values for
      // common contaminants.
      expect(prompt).not.toMatch(/"detected_level":\s*0\.015/);
      expect(prompt).not.toMatch(/"detected_level":\s*15/);
      expect(prompt).not.toMatch(/"detected_level":\s*1\.3/);
      expect(prompt).not.toMatch(/"mcl":\s*0\.015/);
    });

    it("does not embed plausible-looking literal PWSID values", () => {
      const prompt = buildCcrSystemPrompt();
      // Kalamazoo's PWSID is a tempting literal-example value. The
      // prompt should not include it — the user-prompt builder
      // injects the real PWSID at call time.
      expect(prompt).not.toMatch(/MI0003520/);
      expect(prompt).not.toMatch(/[A-Z]{2}\d{7}/);
    });
  });
});

describe("buildCcrUserPrompt", () => {
  const baseInput = {
    expected_pwsid: "AB1234567",
    expected_utility_name: "<placeholder utility name>",
    known_system_context: "<placeholder system context>",
  };

  it("returns a non-empty string", () => {
    expect(buildCcrUserPrompt(baseInput).length).toBeGreaterThan(0);
  });

  it("includes the expected PWSID for cross-checking", () => {
    const prompt = buildCcrUserPrompt(baseInput);
    expect(prompt).toContain("AB1234567");
    expect(prompt).toMatch(/Expected PWSID/);
  });

  it("includes the expected utility name for cross-checking", () => {
    const prompt = buildCcrUserPrompt(baseInput);
    expect(prompt).toContain("<placeholder utility name>");
    expect(prompt).toMatch(/Expected utility name/);
  });

  it("includes the known system context block when provided", () => {
    const prompt = buildCcrUserPrompt(baseInput);
    expect(prompt).toContain("<placeholder system context>");
    expect(prompt).toMatch(/What we already know about this utility/i);
  });

  it("omits the known-system-context block cleanly when null", () => {
    const prompt = buildCcrUserPrompt({
      ...baseInput,
      known_system_context: null,
    });
    expect(prompt).not.toMatch(/What we already know about this utility/i);
  });

  it("handles a null expected_pwsid gracefully", () => {
    const prompt = buildCcrUserPrompt({
      ...baseInput,
      expected_pwsid: null,
    });
    expect(prompt).toMatch(/unknown/i);
    expect(prompt).toMatch(/please record whatever PWSID the report prints/i);
  });

  it("handles a null expected_utility_name gracefully", () => {
    const prompt = buildCcrUserPrompt({
      ...baseInput,
      expected_utility_name: null,
    });
    expect(prompt).toMatch(/Expected utility name.*unknown/i);
  });

  it("tells the model to record what the document prints, not the expected values", () => {
    const prompt = buildCcrUserPrompt(baseInput);
    expect(prompt).toMatch(/AS PRINTED IN THE REPORT/);
    expect(prompt).toMatch(/do not substitute the expected values/i);
  });

  it("reiterates the scope rule (stay within the five sections)", () => {
    const prompt = buildCcrUserPrompt(baseInput);
    expect(prompt).toMatch(/Stay strictly within the five sections/);
    expect(prompt).toMatch(/Ignore marketing/);
  });
});
