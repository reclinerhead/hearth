import { describe, expect, it } from "vitest";
import { buildResearchPrompt, type ResearchInventoryInput } from "./prompt";

const baseInput: ResearchInventoryInput = {
  manufacturer: "Maytag",
  model_number: "MDB4949SHZ0",
  inventory_name: "Maytag dishwasher",
  inventory_type: "appliance",
  ai_pills: null,
  notes: null,
};

describe("buildResearchPrompt", () => {
  it("returns a non-empty string", () => {
    expect(buildResearchPrompt(baseInput).length).toBeGreaterThan(0);
  });

  it("includes the manufacturer, model_number, and name", () => {
    const prompt = buildResearchPrompt(baseInput);
    expect(prompt).toContain("Maytag");
    expect(prompt).toContain("MDB4949SHZ0");
    expect(prompt).toContain("Maytag dishwasher");
  });

  it("includes the inventory type", () => {
    const prompt = buildResearchPrompt(baseInput);
    expect(prompt).toMatch(/Type: appliance/);
  });

  it("names every output field the model must return", () => {
    const prompt = buildResearchPrompt(baseInput);
    expect(prompt).toContain("headline");
    expect(prompt).toContain("body");
    expect(prompt).toContain("source_urls");
    expect(prompt).toContain("found_specific_model");
  });

  it("specifies the headline and body character caps", () => {
    const prompt = buildResearchPrompt(baseInput);
    expect(prompt).toMatch(/120 characters/);
    expect(prompt).toMatch(/2400 characters/);
  });

  it("displays '(unknown)' when manufacturer is null", () => {
    const prompt = buildResearchPrompt({
      ...baseInput,
      manufacturer: null,
    });
    expect(prompt).toMatch(/Manufacturer: \(unknown\)/);
  });

  it("displays '(unknown)' when model_number is null", () => {
    const prompt = buildResearchPrompt({
      ...baseInput,
      model_number: null,
    });
    expect(prompt).toMatch(/Model number: \(unknown\)/);
  });

  describe("pills block", () => {
    it("includes a pills block when pills are present", () => {
      const prompt = buildResearchPrompt({
        ...baseInput,
        ai_pills: [
          { label: "Capacity", value: "40 gallons" },
          { label: "BTU Input", value: "40,000" },
        ],
      });
      expect(prompt).toMatch(/Details from the nameplate/i);
      expect(prompt).toContain("Capacity: 40 gallons");
      expect(prompt).toContain("BTU Input: 40,000");
    });

    it("omits the pills block when ai_pills is null", () => {
      const prompt = buildResearchPrompt({ ...baseInput, ai_pills: null });
      expect(prompt).not.toMatch(/Details from the nameplate/i);
    });

    it("omits the pills block when ai_pills is an empty array", () => {
      const prompt = buildResearchPrompt({ ...baseInput, ai_pills: [] });
      expect(prompt).not.toMatch(/Details from the nameplate/i);
    });
  });

  describe("notes block", () => {
    it("includes a notes block when notes are present", () => {
      const prompt = buildResearchPrompt({
        ...baseInput,
        notes: "Replaced control board in 2023",
      });
      expect(prompt).toMatch(/Additional notes/i);
      expect(prompt).toContain("Replaced control board in 2023");
    });

    it("omits the notes block when notes are null", () => {
      const prompt = buildResearchPrompt({ ...baseInput, notes: null });
      expect(prompt).not.toMatch(/Additional notes/i);
    });
  });

  it("tells the model to be honest when it can't find specific info", () => {
    const prompt = buildResearchPrompt(baseInput);
    expect(prompt).toMatch(/honest/i);
    expect(prompt).toMatch(/found_specific_model to false/);
  });
});
