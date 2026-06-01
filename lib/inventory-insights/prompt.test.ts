import { describe, expect, it } from "vitest";
import {
  buildResearchSystemPrompt,
  buildResearchUserMessage,
  type ResearchInventoryInput,
} from "./prompt";

const baseInput: ResearchInventoryInput = {
  manufacturer: "Maytag",
  model_number: "MDB4949SHZ0",
  inventory_name: "Maytag dishwasher",
  inventory_type: "appliance",
  ai_pills: null,
  serial_number: "1234567890",
  notes: null,
};

describe("buildResearchSystemPrompt", () => {
  it("returns a non-empty string", () => {
    expect(buildResearchSystemPrompt().length).toBeGreaterThan(0);
  });

  it("is deterministic across calls (no per-input state leaks in)", () => {
    expect(buildResearchSystemPrompt()).toBe(buildResearchSystemPrompt());
  });

  it("names all three section fields the model must populate", () => {
    const prompt = buildResearchSystemPrompt();
    expect(prompt).toContain("overview");
    expect(prompt).toContain("service_life");
    expect(prompt).toContain("maintenance");
  });

  it("names the headline and source_urls fields", () => {
    const prompt = buildResearchSystemPrompt();
    expect(prompt).toContain("headline");
    expect(prompt).toContain("source_urls");
  });

  it("names the found_specific_model boolean", () => {
    expect(buildResearchSystemPrompt()).toContain("found_specific_model");
  });

  it("states there is no browsing tool so source_urls stays empty by default", () => {
    expect(buildResearchSystemPrompt()).toMatch(
      /no web-browsing tool|no browsing tool|no web access/i,
    );
  });

  it("constrains ungrounded era/maker claims out of the headline", () => {
    expect(buildResearchSystemPrompt()).toMatch(/only when you can ground it/i);
  });

  it("includes the honesty rule allowing null per section", () => {
    const prompt = buildResearchSystemPrompt();
    expect(prompt).toMatch(/return null for that section/i);
    expect(prompt).toMatch(/Do not invent details/i);
  });

  it("specifies the per-section character ceiling", () => {
    expect(buildResearchSystemPrompt()).toMatch(/1200[- ]character/);
  });

  it("warns away from speculation and marketing language", () => {
    const prompt = buildResearchSystemPrompt();
    expect(prompt).toMatch(/Avoid marketing language/i);
    expect(prompt).toMatch(/Avoid speculation/i);
  });

  it("explicitly defers serial-number decoding to a separate process", () => {
    expect(buildResearchSystemPrompt()).toMatch(
      /Do not attempt to decode the serial number to a manufacture date/i,
    );
  });

  it("no longer references the manufacture-date encoding protocol", () => {
    const prompt = buildResearchSystemPrompt();
    expect(prompt).not.toMatch(/Manufacture date decoding/i);
    expect(prompt).not.toMatch(/Confidence gate/i);
    expect(prompt).not.toMatch(/character[- ]by[- ]character/i);
  });
});

describe("buildResearchUserMessage", () => {
  it("returns a non-empty string", () => {
    expect(buildResearchUserMessage(baseInput).length).toBeGreaterThan(0);
  });

  it("includes the manufacturer, model_number, and name", () => {
    const message = buildResearchUserMessage(baseInput);
    expect(message).toContain("Maytag");
    expect(message).toContain("MDB4949SHZ0");
    expect(message).toContain("Maytag dishwasher");
  });

  it("includes the inventory type", () => {
    expect(buildResearchUserMessage(baseInput)).toMatch(/Type: appliance/);
  });

  it("displays '(unknown)' when manufacturer is null", () => {
    const message = buildResearchUserMessage({
      ...baseInput,
      manufacturer: null,
    });
    expect(message).toMatch(/Manufacturer: \(unknown\)/);
  });

  it("displays '(unknown)' when model_number is null", () => {
    const message = buildResearchUserMessage({
      ...baseInput,
      model_number: null,
    });
    expect(message).toMatch(/Model number: \(unknown\)/);
  });

  describe("three explicit asks", () => {
    it("includes the numbered ask for overview", () => {
      const message = buildResearchUserMessage(baseInput);
      expect(message).toMatch(/1\.[\s\S]*?Populate the `overview` field/);
    });

    it("includes the numbered ask for service_life", () => {
      const message = buildResearchUserMessage(baseInput);
      expect(message).toMatch(/2\.[\s\S]*?Populate the `service_life` field/);
    });

    it("no longer asks the model to decode the serial number to a date", () => {
      const message = buildResearchUserMessage(baseInput);
      expect(message).not.toMatch(/decoding it to a manufacture date/i);
      expect(message).not.toMatch(/encoding rule/i);
    });

    it("includes the numbered ask for maintenance", () => {
      const message = buildResearchUserMessage(baseInput);
      expect(message).toMatch(/3\.[\s\S]*?Populate the `maintenance` field/);
    });

    it("reinforces the 'null is the correct answer' rule", () => {
      const message = buildResearchUserMessage(baseInput);
      expect(message).toMatch(/Returning null is the correct answer/i);
    });
  });

  describe("notes block", () => {
    it("includes the notes block when notes are present", () => {
      const message = buildResearchUserMessage({
        ...baseInput,
        notes: "Replaced control board in 2023",
      });
      expect(message).toMatch(/Additional notes/i);
      expect(message).toContain("Replaced control board in 2023");
    });

    it("omits the notes block when notes are null", () => {
      const message = buildResearchUserMessage({ ...baseInput, notes: null });
      expect(message).not.toMatch(/Additional notes/i);
    });
  });
});
