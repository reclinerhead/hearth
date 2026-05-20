import { describe, it, expect } from "vitest";
import { buildClassifyPrompt, buildDeltaPrompt } from "./prompt";

describe("buildClassifyPrompt", () => {
  it("returns a non-empty string", () => {
    const prompt = buildClassifyPrompt();
    expect(prompt.length).toBeGreaterThan(0);
  });

  it("is deterministic across calls", () => {
    expect(buildClassifyPrompt()).toBe(buildClassifyPrompt());
  });

  it("names the three photo_kind categories the model picks between", () => {
    const prompt = buildClassifyPrompt();
    expect(prompt).toContain("nameplate");
    expect(prompt).toContain("appliance_photo");
    expect(prompt).toContain("not_useful");
  });

  it("lists the three equipment-type categories", () => {
    const prompt = buildClassifyPrompt();
    expect(prompt).toContain('"appliance"');
    expect(prompt).toContain('"system"');
    expect(prompt).toContain('"exterior"');
  });

  it("names every extractable field the model must populate on nameplate", () => {
    const prompt = buildClassifyPrompt();
    for (const field of [
      "manufacturer",
      "model_number",
      "serial_number",
      "installed_on",
      "notes",
    ]) {
      expect(prompt).toContain(field);
    }
  });

  it("specifies the confidence-score range (0.0 to 1.0)", () => {
    const prompt = buildClassifyPrompt();
    expect(prompt).toMatch(/0\.0 to 1\.0/);
  });

  it("instructs the model to use null instead of guessing on illegible fields", () => {
    const prompt = buildClassifyPrompt();
    expect(prompt).toMatch(/null/);
    expect(prompt).toMatch(/Do not guess/i);
  });

  describe("pills extraction guidance", () => {
    it("names the pills field as part of the nameplate extraction contract", () => {
      const prompt = buildClassifyPrompt();
      expect(prompt).toContain("pills");
    });

    it("documents the { label, value } pill shape", () => {
      const prompt = buildClassifyPrompt();
      expect(prompt).toContain("label");
      expect(prompt).toContain("value");
    });

    it("includes example pills the model can pattern-match against", () => {
      const prompt = buildClassifyPrompt();
      expect(prompt).toContain("Capacity");
      expect(prompt).toContain("BTU Input");
      expect(prompt).toContain("Voltage");
    });

    it("calls out the bounded label and value lengths", () => {
      const prompt = buildClassifyPrompt();
      expect(prompt).toMatch(/40 characters/);
      expect(prompt).toMatch(/120 characters/);
    });

    it("tells the model to skip industry-internal codes", () => {
      const prompt = buildClassifyPrompt();
      expect(prompt).toMatch(/industry-internal/i);
    });

    it("tells the model to skip facts already captured as named fields", () => {
      const prompt = buildClassifyPrompt();
      expect(prompt).toMatch(/already captured as named/i);
    });

    it("tells the model to return an empty array when there is nothing to extract", () => {
      const prompt = buildClassifyPrompt();
      expect(prompt).toMatch(/empty array/i);
    });
  });

  describe("derived-facts prohibition (#81)", () => {
    // The prior revision of this prompt used realistic-looking literal
    // pill values; Grok 4.3 was observed echoing them verbatim into
    // unrelated appliances' output. These assertions pin the no-leak
    // contract so a future edit can't silently re-introduce the bug.

    it("does not contain the previously-leaked Manufacture Date example value", () => {
      const prompt = buildClassifyPrompt();
      expect(prompt).not.toContain("29 Jan 2015");
    });

    it("does not contain the prior specific-looking pill example values", () => {
      // The Manufacture Date example was the proven leak vector, but
      // the surrounding examples used similarly specific-looking values
      // that could leak the same way. All replaced with placeholder
      // syntax.
      const prompt = buildClassifyPrompt();
      expect(prompt).not.toContain("40 gallons");
      expect(prompt).not.toContain("40,000");
      expect(prompt).not.toContain('"Natural gas"');
      expect(prompt).not.toContain('"120V"');
      expect(prompt).not.toContain('"150 PSI"');
    });

    it("uses angle-bracket placeholder syntax for pill example values", () => {
      const prompt = buildClassifyPrompt();
      expect(prompt).toMatch(/<[^>]+as printed>/);
    });

    it("explicitly prohibits a Manufacture Date pill", () => {
      const prompt = buildClassifyPrompt();
      expect(prompt).toMatch(/Do not include a Manufacture Date pill/i);
    });

    it("explicitly tells the model not to decode the serial number to produce a manufacture date", () => {
      const prompt = buildClassifyPrompt();
      expect(prompt).toMatch(/do not decode the serial number/i);
    });

    it("requires pills to be facts printed directly on the label", () => {
      const prompt = buildClassifyPrompt();
      expect(prompt).toMatch(/printed directly on the label/i);
    });

    it("prohibits pills derived from decoding identifiers", () => {
      const prompt = buildClassifyPrompt();
      expect(prompt).toMatch(/decoding serial numbers/i);
    });

    it("names model release year, generation, and equipment age as also-prohibited derived facts", () => {
      const prompt = buildClassifyPrompt();
      expect(prompt).toMatch(/model release year/i);
      expect(prompt).toMatch(/generation/i);
      expect(prompt).toMatch(/equipment age/i);
    });

    it("allows a Manufacture Date pill only when the date is printed verbatim on the label", () => {
      // The conditional exception — if a manufacture date IS printed
      // directly on the label (rare on appliances, common on water
      // heaters), capture it as a pill exactly as printed.
      const prompt = buildClassifyPrompt();
      expect(prompt).toMatch(/exactly as printed/i);
    });
  });
});

describe("buildDeltaPrompt", () => {
  const existingInventoryData = {
    manufacturer: "Carrier",
    model_number: "58CTA070",
    serial_number: null,
    installed_on: null,
    notes: "Gas, 70k BTU",
  };

  it("returns a non-empty string", () => {
    const prompt = buildDeltaPrompt({ existingInventoryData });
    expect(prompt.length).toBeGreaterThan(0);
  });

  it("includes a JSON-serialized block of the existing data", () => {
    const prompt = buildDeltaPrompt({ existingInventoryData });
    expect(prompt).toContain(JSON.stringify(existingInventoryData, null, 2));
  });

  it("introduces the existing-data block with a labeled section", () => {
    const prompt = buildDeltaPrompt({ existingInventoryData });
    expect(prompt).toMatch(/Existing data:/);
  });

  it("preserves null values in the serialized block (not stripped)", () => {
    const prompt = buildDeltaPrompt({ existingInventoryData });
    expect(prompt).toContain('"serial_number": null');
    expect(prompt).toContain('"installed_on": null');
  });

  it("serializes individual field values inside the block", () => {
    const prompt = buildDeltaPrompt({ existingInventoryData });
    expect(prompt).toContain('"manufacturer": "Carrier"');
    expect(prompt).toContain('"model_number": "58CTA070"');
  });

  it("handles an empty existing-data object cleanly", () => {
    const prompt = buildDeltaPrompt({ existingInventoryData: {} });
    expect(prompt).toContain("Existing data:");
    expect(prompt).toContain("{}");
  });

  it("documents the empty-deltas behaviour when no new info is found", () => {
    const prompt = buildDeltaPrompt({ existingInventoryData });
    expect(prompt).toMatch(/empty deltas map/i);
  });

  it("describes the currentValue / proposedValue contract", () => {
    const prompt = buildDeltaPrompt({ existingInventoryData });
    expect(prompt).toContain("currentValue");
    expect(prompt).toContain("proposedValue");
  });
});
