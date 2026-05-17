import { describe, expect, it } from "vitest";
import {
  buildHouseImagePrompt,
  deriveEraDescriptor,
  deriveStories,
  deriveStyleHint,
} from "./prompt";

describe("deriveEraDescriptor", () => {
  it("returns null when year_built is null", () => {
    expect(deriveEraDescriptor(null)).toBeNull();
  });

  // Boundary-by-boundary table: each row is the year immediately on
  // either side of an era boundary. Catches off-by-one drift if the
  // bucket cutoffs are edited.
  const boundaries: [year: number, expected: string][] = [
    [1850, "early 20th century"],
    [1919, "early 20th century"],
    [1920, "1930s-era"],
    [1945, "1930s-era"],
    [1946, "mid-century"],
    [1965, "mid-century"],
    [1966, "1970s-era"],
    [1985, "1970s-era"],
    [1986, "late 20th century"],
    [2005, "late 20th century"],
    [2006, "contemporary"],
    [2025, "contemporary"],
  ];
  it.each(boundaries)("year %i maps to %s", (year, expected) => {
    expect(deriveEraDescriptor(year)).toBe(expected);
  });
});

describe("deriveStyleHint", () => {
  it("returns null when description is null", () => {
    expect(deriveStyleHint(null)).toBeNull();
  });

  it("returns null when description has no recognized style", () => {
    expect(
      deriveStyleHint("Spacious home with three bedrooms and a fenced yard."),
    ).toBeNull();
  });

  const styleCases: [description: string, expected: string][] = [
    ["A classic Craftsman bungalow with built-ins.", "Craftsman"],
    ["Charming Cape Cod with dormers.", "Cape Cod"],
    ["This Colonial sits on a corner lot.", "Colonial"],
    ["Victorian features throughout.", "Victorian"],
    ["Modern farmhouse with shiplap.", "Farmhouse"],
    ["This 1940s bungalow has original hardwoods.", "Bungalow"],
    ["A cozy cottage tucked behind mature trees.", "Cottage"],
    ["Storybook Tudor with leaded glass.", "Tudor"],
    ["Single-story ranch in established neighborhood.", "Ranch"],
    ["Contemporary build with clean lines.", "Contemporary"],
  ];
  it.each(styleCases)("matches style in %j", (description, expected) => {
    expect(deriveStyleHint(description)).toBe(expected);
  });

  it("prefers multi-word style over single-word prefix", () => {
    // "Cape Cod" must match before the (intentionally absent) plain
    // "Cape" alternative; this exercises ordering of the keyword table.
    expect(deriveStyleHint("Cape Cod cottage")).toBe("Cape Cod");
  });

  it("is case-insensitive", () => {
    expect(deriveStyleHint("a beautiful COLONIAL home")).toBe("Colonial");
  });

  it("does not match partial words", () => {
    // 'Ranch' should not match inside 'Branch' or 'Rancher's'.
    expect(deriveStyleHint("Located near Branch Avenue.")).toBeNull();
  });
});

describe("deriveStories", () => {
  it("returns null when description is null", () => {
    expect(deriveStories(null)).toBeNull();
  });

  const storyCases: [description: string, expected: string][] = [
    ["Charming two-story Colonial.", "two-story"],
    ["A spacious 2-story home.", "two-story"],
    ["Single-story ranch on a corner lot.", "single-story"],
    ["This one-story home has open floor plan.", "single-story"],
    ["1-story brick home.", "single-story"],
    ["Three-story townhouse downtown.", "three-story"],
    ["3 story walk-up.", "three-story"],
  ];
  it.each(storyCases)("matches stories in %j", (description, expected) => {
    expect(deriveStories(description)).toBe(expected);
  });

  it("returns null when no stories phrase is present", () => {
    expect(deriveStories("Lovely home with hardwood floors.")).toBeNull();
  });
});

describe("buildHouseImagePrompt", () => {
  it("assembles a full prompt with all three signals", () => {
    const prompt = buildHouseImagePrompt({
      yearBuilt: 1925,
      description: "Charming two-story Craftsman with original woodwork.",
    });
    expect(prompt).toContain("typical 1930s-era Craftsman home");
    expect(prompt).toContain("two-story");
    expect(prompt).toContain("front exterior view");
    expect(prompt).toContain("architectural drawing aesthetic");
  });

  it("omits era cleanly when year_built is null", () => {
    const prompt = buildHouseImagePrompt({
      yearBuilt: null,
      description: "Single-story Ranch.",
    });
    expect(prompt).toContain("typical Ranch home");
    // No "null" or "undefined" tokens leak in.
    expect(prompt).not.toMatch(/null|undefined/i);
  });

  it("omits style cleanly when description has no recognized style", () => {
    const prompt = buildHouseImagePrompt({
      yearBuilt: 1955,
      description: "Three bedroom, two bath home with a finished basement.",
    });
    expect(prompt).toContain("typical mid-century home");
  });

  it("omits stories cleanly when description has no stories phrase", () => {
    const prompt = buildHouseImagePrompt({
      yearBuilt: 1990,
      description: "A Colonial with formal dining and an attached garage.",
    });
    expect(prompt).toContain("typical late 20th century Colonial home");
    // The 'stories clause' should be absent — no double-comma or double-space.
    expect(prompt).not.toMatch(/,\s*,/);
    expect(prompt).not.toMatch(/ {2,}/);
  });

  it("omits everything cleanly when nothing is known", () => {
    const prompt = buildHouseImagePrompt({
      yearBuilt: null,
      description: null,
    });
    expect(prompt).toContain("typical home");
    expect(prompt).not.toMatch(/null|undefined/i);
    expect(prompt).not.toMatch(/ {2,}/);
  });

  it("does not leak literal description details into the prompt", () => {
    // Specific physical details — colors, materials, exact features —
    // are the kind of thing that makes the model over-literalize. The
    // prompt builder must NOT pass them through.
    const description =
      "Two-story Colonial with red brick exterior, black shutters, and a wraparound porch with white railings.";
    const prompt = buildHouseImagePrompt({
      yearBuilt: 1995,
      description,
    });
    expect(prompt).not.toMatch(/red brick|shutters|wraparound|railings/i);
    // The general signals still come through.
    expect(prompt).toContain("typical late 20th century Colonial home");
    expect(prompt).toContain("two-story");
  });

  it("is deterministic for the same input", () => {
    const input = {
      yearBuilt: 1948,
      description: "Mid-century Ranch with low-pitched roofline.",
    };
    expect(buildHouseImagePrompt(input)).toBe(buildHouseImagePrompt(input));
  });
});
