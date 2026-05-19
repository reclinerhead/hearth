import { describe, it, expect } from "vitest";
import { classificationSchema, deltaSchema } from "./schema";

describe("classificationSchema", () => {
  describe("nameplate branch", () => {
    const validNameplate = {
      photo_kind: "nameplate" as const,
      classification: {
        name: "Furnace",
        type: "system" as const,
        confidence: 0.92,
      },
      extracted: {
        manufacturer: "Carrier",
        model_number: "58CTA070",
        serial_number: "0419A12345",
        installed_on: "2018-04-12",
        notes: "Gas, 70k BTU",
      },
      room_suggestion: "Basement",
    };

    it("parses a fully-populated nameplate payload", () => {
      const parsed = classificationSchema.parse(validNameplate);
      expect(parsed.photo_kind).toBe("nameplate");
      if (parsed.photo_kind === "nameplate") {
        expect(parsed.classification.name).toBe("Furnace");
        expect(parsed.extracted.manufacturer).toBe("Carrier");
      }
    });

    it("accepts null extracted fields when individual values aren't legible", () => {
      const partial = {
        ...validNameplate,
        extracted: {
          manufacturer: "Carrier",
          model_number: null,
          serial_number: null,
          installed_on: null,
          notes: null,
        },
      };
      expect(() => classificationSchema.parse(partial)).not.toThrow();
    });

    it("accepts null room_suggestion", () => {
      const parsed = classificationSchema.parse({
        ...validNameplate,
        room_suggestion: null,
      });
      expect(parsed.photo_kind).toBe("nameplate");
    });

    it("rejects confidence outside [0, 1]", () => {
      const bad = {
        ...validNameplate,
        classification: { ...validNameplate.classification, confidence: 1.5 },
      };
      expect(() => classificationSchema.parse(bad)).toThrow();
    });

    it("rejects a non-enum equipment type", () => {
      const bad = {
        ...validNameplate,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        classification: { ...validNameplate.classification, type: "vehicle" as any },
      };
      expect(() => classificationSchema.parse(bad)).toThrow();
    });

    it("rejects an empty classification name", () => {
      const bad = {
        ...validNameplate,
        classification: { ...validNameplate.classification, name: "" },
      };
      expect(() => classificationSchema.parse(bad)).toThrow();
    });

    it("rejects extracted=null on the nameplate branch", () => {
      const bad = { ...validNameplate, extracted: null };
      expect(() => classificationSchema.parse(bad)).toThrow();
    });
  });

  describe("appliance_photo branch", () => {
    const valid = {
      photo_kind: "appliance_photo" as const,
      classification: {
        name: "Washing Machine",
        type: "appliance" as const,
        confidence: 0.81,
      },
      extracted: null,
      room_suggestion: "Laundry Room",
    };

    it("parses a typical appliance_photo payload", () => {
      const parsed = classificationSchema.parse(valid);
      expect(parsed.photo_kind).toBe("appliance_photo");
      if (parsed.photo_kind === "appliance_photo") {
        expect(parsed.extracted).toBeNull();
      }
    });

    it("rejects extracted as an object on appliance_photo", () => {
      const bad = {
        ...valid,
        extracted: { manufacturer: "Whirlpool" },
      };
      expect(() => classificationSchema.parse(bad)).toThrow();
    });
  });

  describe("not_useful branch", () => {
    const valid = {
      photo_kind: "not_useful" as const,
      classification: null,
      extracted: null,
      room_suggestion: null,
    };

    it("parses a valid not_useful payload", () => {
      const parsed = classificationSchema.parse(valid);
      expect(parsed.photo_kind).toBe("not_useful");
    });

    it("rejects classification non-null on not_useful", () => {
      const bad = {
        ...valid,
        classification: { name: "Cat", type: "appliance", confidence: 0.1 },
      };
      expect(() => classificationSchema.parse(bad)).toThrow();
    });
  });

  it("rejects an unknown photo_kind discriminator", () => {
    expect(() =>
      classificationSchema.parse({
        photo_kind: "vacation_pic",
        classification: null,
        extracted: null,
        room_suggestion: null,
      }),
    ).toThrow();
  });

  it("rejects payloads missing photo_kind entirely", () => {
    expect(() =>
      classificationSchema.parse({
        classification: null,
        extracted: null,
        room_suggestion: null,
      }),
    ).toThrow();
  });
});

describe("deltaSchema", () => {
  it("parses an empty deltas map (no new info)", () => {
    const parsed = deltaSchema.parse({ deltas: {}, confidence: 0.5 });
    expect(parsed.deltas).toEqual({});
  });

  it("parses a delta entry that fills in a previously-null field", () => {
    const parsed = deltaSchema.parse({
      deltas: {
        serial_number: { currentValue: null, proposedValue: "0419A12345" },
      },
      confidence: 0.88,
    });
    expect(parsed.deltas.serial_number).toEqual({
      currentValue: null,
      proposedValue: "0419A12345",
    });
  });

  it("parses a delta entry that contradicts the current value", () => {
    expect(() =>
      deltaSchema.parse({
        deltas: {
          manufacturer: {
            currentValue: "Carrier",
            proposedValue: "Bryant",
          },
        },
        confidence: 0.72,
      }),
    ).not.toThrow();
  });

  it("rejects confidence outside [0, 1]", () => {
    expect(() =>
      deltaSchema.parse({ deltas: {}, confidence: 2 }),
    ).toThrow();
  });

  it("rejects a delta with a null proposedValue (must be a string)", () => {
    expect(() =>
      deltaSchema.parse({
        deltas: {
          notes: { currentValue: "old", proposedValue: null },
        },
        confidence: 0.5,
      }),
    ).toThrow();
  });

  it("rejects a delta entry missing proposedValue", () => {
    expect(() =>
      deltaSchema.parse({
        deltas: {
          notes: { currentValue: "old" },
        },
        confidence: 0.5,
      }),
    ).toThrow();
  });

  it("rejects a payload missing the deltas field", () => {
    expect(() => deltaSchema.parse({ confidence: 0.5 })).toThrow();
  });
});
