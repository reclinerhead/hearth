import { describe, it, expect } from "vitest";
import { classificationSchema, deltaSchema } from "./schema";

describe("classificationSchema", () => {
  describe("nameplate branch", () => {
    const validNameplate = {
      photo_kind: "nameplate" as const,
      classification: {
        name: "Furnace",
        type: "system" as const,
        subtype: null,
        confidence: 0.92,
      },
      extracted: {
        manufacturer: "Carrier",
        model_number: "58CTA070",
        serial_number: "0419A12345",
        installed_on: "2018-04-12",
        notes: "Gas, 70k BTU",
        pills: [
          { label: "BTU Input", value: "70,000" },
          { label: "Fuel", value: "Natural gas" },
          { label: "Voltage", value: "120V" },
        ],
      },
      room_suggestion: "Basement",
    };

    it("parses a fully-populated nameplate payload", () => {
      const parsed = classificationSchema.parse(validNameplate);
      expect(parsed.photo_kind).toBe("nameplate");
      if (parsed.photo_kind === "nameplate") {
        expect(parsed.classification.name).toBe("Furnace");
        expect(parsed.extracted.manufacturer).toBe("Carrier");
        expect(parsed.extracted.pills).toHaveLength(3);
        expect(parsed.extracted.pills[0]).toEqual({
          label: "BTU Input",
          value: "70,000",
        });
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
          pills: [],
        },
      };
      expect(() => classificationSchema.parse(partial)).not.toThrow();
    });

    describe("pills field", () => {
      it("accepts an empty pills array", () => {
        const payload = {
          ...validNameplate,
          extracted: { ...validNameplate.extracted, pills: [] },
        };
        expect(() => classificationSchema.parse(payload)).not.toThrow();
      });

      it("rejects a pill with an empty label", () => {
        const payload = {
          ...validNameplate,
          extracted: {
            ...validNameplate.extracted,
            pills: [{ label: "", value: "40 gallons" }],
          },
        };
        expect(() => classificationSchema.parse(payload)).toThrow();
      });

      it("rejects a pill with a label longer than 40 characters", () => {
        const payload = {
          ...validNameplate,
          extracted: {
            ...validNameplate.extracted,
            pills: [{ label: "x".repeat(41), value: "40 gallons" }],
          },
        };
        expect(() => classificationSchema.parse(payload)).toThrow();
      });

      it("rejects a pill with a value longer than 120 characters", () => {
        const payload = {
          ...validNameplate,
          extracted: {
            ...validNameplate.extracted,
            pills: [{ label: "Capacity", value: "x".repeat(121) }],
          },
        };
        expect(() => classificationSchema.parse(payload)).toThrow();
      });

      it("rejects a pill missing the value field", () => {
        const payload = {
          ...validNameplate,
          extracted: {
            ...validNameplate.extracted,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            pills: [{ label: "Capacity" } as any],
          },
        };
        expect(() => classificationSchema.parse(payload)).toThrow();
      });

      it("rejects a pill missing the label field", () => {
        const payload = {
          ...validNameplate,
          extracted: {
            ...validNameplate.extracted,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            pills: [{ value: "40 gallons" } as any],
          },
        };
        expect(() => classificationSchema.parse(payload)).toThrow();
      });

      it("rejects pills as a non-array", () => {
        const payload = {
          ...validNameplate,
          extracted: {
            ...validNameplate.extracted,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            pills: "not-an-array" as any,
          },
        };
        expect(() => classificationSchema.parse(payload)).toThrow();
      });

      it("rejects missing pills field entirely", () => {
        const { pills: _omit, ...extractedWithoutPills } =
          validNameplate.extracted;
        void _omit;
        const payload = {
          ...validNameplate,
          extracted: extractedWithoutPills,
        };
        expect(() => classificationSchema.parse(payload)).toThrow();
      });
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
        classification: { ...validNameplate.classification, type: "vacation" as any },
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
        subtype: null,
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
        classification: {
          name: "Cat",
          type: "appliance",
          subtype: null,
          confidence: 0.1,
        },
      };
      expect(() => classificationSchema.parse(bad)).toThrow();
    });
  });

  describe("property branch", () => {
    const validPropertyVehicle = {
      photo_kind: "nameplate" as const,
      classification: {
        name: "Vehicle",
        type: "property" as const,
        subtype: "vehicle" as const,
        confidence: 0.95,
      },
      extracted: {
        manufacturer: "Toyota",
        model_number: "Land Cruiser",
        serial_number: "JTEZU17R868001234",
        installed_on: null,
        notes: null,
        pills: [],
      },
      room_suggestion: "Garage",
    };

    it("parses a valid property/vehicle classification", () => {
      const parsed = classificationSchema.parse(validPropertyVehicle);
      if (parsed.photo_kind === "nameplate") {
        expect(parsed.classification.type).toBe("property");
        expect(parsed.classification.subtype).toBe("vehicle");
        expect(parsed.extracted.serial_number).toBe("JTEZU17R868001234");
      }
    });

    it("parses a property row with subtype=null (generic property)", () => {
      const parsed = classificationSchema.parse({
        ...validPropertyVehicle,
        classification: {
          ...validPropertyVehicle.classification,
          subtype: null,
        },
      });
      if (parsed.photo_kind === "nameplate") {
        expect(parsed.classification.subtype).toBeNull();
      }
    });

    it("parses a property/pet classification", () => {
      const parsed = classificationSchema.parse({
        ...validPropertyVehicle,
        classification: {
          name: "Pet",
          type: "property",
          subtype: "pet",
          confidence: 0.88,
        },
      });
      if (parsed.photo_kind === "nameplate") {
        expect(parsed.classification.subtype).toBe("pet");
      }
    });

    it("rejects an unknown subtype value", () => {
      const bad = {
        ...validPropertyVehicle,
        classification: {
          ...validPropertyVehicle.classification,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          subtype: "yacht" as any,
        },
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
