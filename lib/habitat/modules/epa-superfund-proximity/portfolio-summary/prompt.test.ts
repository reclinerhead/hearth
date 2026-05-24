import { describe, expect, it } from "vitest";
import {
  buildPortfolioSummarySystemPrompt,
  buildPortfolioSummaryUserMessage,
  type PortfolioSummaryInput,
} from "./prompt";

function makeInput(
  overrides: Partial<PortfolioSummaryInput> = {},
): PortfolioSummaryInput {
  return {
    state: "MI",
    total_qualifying_sites: 2,
    portfolio_label: "worth_knowing",
    sites: [
      {
        name: "Allied Paper, Inc.",
        distance_miles: 1.0,
        bearing: "N",
        npl_status: "Final NPL",
        site_label: "worth_knowing",
        contaminants: ["Polychlorinated biphenyls", "Lead"],
        archived: false,
      },
      {
        name: "Auto Ion Chemicals, Inc.",
        distance_miles: 1.4,
        bearing: "N",
        npl_status: "Final NPL",
        site_label: "worth_knowing",
        contaminants: ["Trichloroethylene"],
        archived: false,
      },
    ],
    ...overrides,
  };
}

describe("buildPortfolioSummarySystemPrompt", () => {
  const prompt = buildPortfolioSummarySystemPrompt();

  it("forbids asserting the property is or isn't contaminated", () => {
    expect(prompt).toMatch(/never assert/i);
    expect(prompt).toMatch(/contaminated/i);
    expect(prompt).toMatch(/your home is safe/i);
    expect(prompt).toMatch(/forbidden/i);
  });

  it("frames the work as portfolio-level synthesis, not per-site repetition", () => {
    expect(prompt).toMatch(/synthesize/i);
    expect(prompt).toMatch(/portfolio-level/i);
    expect(prompt).toMatch(/do not repeat/i);
  });

  it("caps length at 4 sentences", () => {
    expect(prompt).toMatch(/2 to 4 sentences/i);
    expect(prompt).toMatch(/hard cap: 4/i);
  });

  it("instructs the model to translate NPL codes into plain English", () => {
    expect(prompt).toMatch(/translate NPL codes/i);
    expect(prompt).toMatch(/National Priorities List/i);
  });

  it("forbids markdown / headings / bullets to keep the surface plain prose", () => {
    expect(prompt).toMatch(/no headings, no bullet lists, no markdown/i);
  });

  it("uses angle-bracket placeholders in example values (anti-leak discipline)", () => {
    // Echoes the post-#81 leak-prevention pattern in the nameplate
    // prompt: no literal-looking example values that Grok could
    // memorize and reproduce in unrelated outputs.
    expect(prompt).toMatch(/<count>/);
    expect(prompt).toMatch(/<plain-English contaminant class>/);
  });
});

describe("buildPortfolioSummaryUserMessage", () => {
  it("singularizes the lede when there's exactly one qualifying site", () => {
    const msg = buildPortfolioSummaryUserMessage(
      makeInput({
        total_qualifying_sites: 1,
        sites: [
          {
            name: "Lone Pine Landfill",
            distance_miles: 1.4,
            bearing: "N",
            npl_status: "Final NPL",
            site_label: "worth_knowing",
            contaminants: ["Trichloroethylene"],
            archived: false,
          },
        ],
      }),
    );
    expect(msg).toMatch(/1 EPA Superfund site within/);
    expect(msg).not.toMatch(/1 EPA Superfund sites within/);
  });

  it("pluralizes the lede when there are multiple sites", () => {
    const msg = buildPortfolioSummaryUserMessage(makeInput());
    expect(msg).toMatch(/2 EPA Superfund sites within/);
  });

  it("names each site with distance, bearing, NPL status, and label", () => {
    const msg = buildPortfolioSummaryUserMessage(makeInput());
    expect(msg).toContain("Allied Paper, Inc.");
    expect(msg).toContain("1.0 mi N");
    expect(msg).toContain("Final NPL");
    expect(msg).toContain("Hearth's per-site label: worth_knowing");
    expect(msg).toContain("Auto Ion Chemicals, Inc.");
    expect(msg).toContain("1.4 mi N");
  });

  it("includes contaminants on each site when present", () => {
    const msg = buildPortfolioSummaryUserMessage(makeInput());
    expect(msg).toContain("Polychlorinated biphenyls");
    expect(msg).toContain("Lead");
    expect(msg).toContain("Trichloroethylene");
  });

  it("notes when EPA has not published a contaminants inventory for a site", () => {
    const msg = buildPortfolioSummaryUserMessage(
      makeInput({
        sites: [
          {
            name: "Mystery Site",
            distance_miles: 0.4,
            bearing: "NE",
            npl_status: "Final NPL",
            site_label: "worth_knowing",
            contaminants: [],
            archived: false,
          },
        ],
        total_qualifying_sites: 1,
      }),
    );
    expect(msg).toMatch(/EPA has not published a contaminant inventory/i);
  });

  it("marks suppressed per-site labels explicitly so the model doesn't invent reasoning", () => {
    const msg = buildPortfolioSummaryUserMessage(
      makeInput({
        portfolio_label: null,
        sites: [
          {
            name: "Distant Cleanup",
            distance_miles: 3.5,
            bearing: "S",
            npl_status: "Final NPL",
            site_label: null,
            contaminants: [],
            archived: false,
          },
        ],
        total_qualifying_sites: 1,
      }),
    );
    expect(msg).toMatch(/insufficient data to characterize/i);
  });

  it("notes archived sites", () => {
    const msg = buildPortfolioSummaryUserMessage(
      makeInput({
        sites: [
          {
            name: "Old Mill",
            distance_miles: 1.0,
            bearing: "N",
            npl_status: "Deleted from NPL",
            site_label: "informational",
            contaminants: ["Lead"],
            archived: true,
          },
        ],
        total_qualifying_sites: 1,
      }),
    );
    expect(msg).toContain("(archived)");
  });

  it("repeats the 'do not assert' instruction at the end of the message", () => {
    const msg = buildPortfolioSummaryUserMessage(makeInput());
    expect(msg).toMatch(/Do not assert the user's property is or isn't contaminated/);
  });
});
