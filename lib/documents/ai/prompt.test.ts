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

  it("lists the four equipment-type categories", () => {
    const prompt = buildClassifyPrompt();
    expect(prompt).toContain('"appliance"');
    expect(prompt).toContain('"system"');
    expect(prompt).toContain('"exterior"');
    expect(prompt).toContain('"property"');
  });

  describe("property type guidance (#23)", () => {
    it("describes property as items the homeowner owns that aren't installed infrastructure", () => {
      const prompt = buildClassifyPrompt();
      expect(prompt).toMatch(/aren't installed infrastructure/i);
    });

    it("calls out vehicles, electronics, and pets as property examples", () => {
      const prompt = buildClassifyPrompt();
      expect(prompt).toMatch(/vehicle/i);
      expect(prompt).toMatch(/television/i);
      expect(prompt).toMatch(/pet/i);
    });

    it("instructs the model to set subtype='vehicle' for VIN plates", () => {
      const prompt = buildClassifyPrompt();
      expect(prompt).toMatch(/subtype="vehicle"/);
      expect(prompt).toMatch(/VIN plate/);
    });

    it("instructs the model to set subtype='pet' for identifying pet documents", () => {
      const prompt = buildClassifyPrompt();
      expect(prompt).toMatch(/subtype="pet"/);
    });

    it("instructs the model to set subtype=null for non-property types", () => {
      const prompt = buildClassifyPrompt();
      expect(prompt).toMatch(/subtype=null/);
    });

    it("tells the model to place a VIN in serial_number", () => {
      const prompt = buildClassifyPrompt();
      expect(prompt).toMatch(/place the VIN in serial_number/i);
    });
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

  describe("canonical equipment names (#90)", () => {
    // The Smart Uploader's match-existing-inventory step depends on the
    // model returning a stable name for the same physical item across
    // multiple photos. The prompt pins seven equipment categories to
    // canonical names; lib/inventory/match-name.ts handles the residual
    // drift via aliases. These assertions pin the prompt contract so a
    // future edit can't quietly drop the guidance.

    it("instructs the model to return the canonical name exactly for common categories", () => {
      const prompt = buildClassifyPrompt();
      expect(prompt).toMatch(/EXACTLY the canonical name/i);
    });

    it("lists every canonical name the matcher relies on", () => {
      const prompt = buildClassifyPrompt();
      for (const canonical of [
        "Microwave",
        "Washing Machine",
        "Dryer",
        "Water Heater",
        "Refrigerator",
        "Air Conditioner",
        "Furnace",
      ]) {
        expect(prompt).toContain(`"${canonical}"`);
      }
    });

    it("names the synonyms the model must avoid for each canonical", () => {
      const prompt = buildClassifyPrompt();
      // Each "not X" disclaimer is the load-bearing part — without it
      // the model defaults to whatever form fits the image.
      for (const avoided of [
        "Microwave Oven",
        "Washer",
        "Clothes Washer",
        "Clothes Dryer",
        "Hot Water Heater",
        "Fridge",
        "AC",
        "Air Conditioning",
        "Gas Furnace",
      ]) {
        expect(prompt).toContain(`"${avoided}"`);
      }
    });

    it("explains why canonical names matter (so future edits don't strip the rationale)", () => {
      const prompt = buildClassifyPrompt();
      expect(prompt).toMatch(/duplicate inventory entry/i);
    });

    it("leaves room for natural vocabulary on items outside the canonical list", () => {
      const prompt = buildClassifyPrompt();
      expect(prompt).toMatch(/outside this list/i);
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
