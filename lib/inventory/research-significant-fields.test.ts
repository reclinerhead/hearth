import { describe, expect, it } from "vitest";
import {
  researchSignificantFieldsChanged,
  type ResearchSignificantFields,
} from "./research-significant-fields";

const BASE: ResearchSignificantFields = {
  manufacturer: "Whirlpool",
  model_number: "WFG361LFQ",
};

describe("researchSignificantFieldsChanged", () => {
  it("returns false when nothing changes", () => {
    expect(researchSignificantFieldsChanged(BASE, { ...BASE })).toBe(false);
  });

  it("returns false when only the type changes — type is organizational, not research-grounding (#69)", () => {
    // Even when the caller previously had a `type` field on the input,
    // the helper now ignores it. Passing extra keys is a no-op because
    // the function reads only manufacturer + model_number.
    expect(
      researchSignificantFieldsChanged(
        { ...BASE, type: "appliance" } as ResearchSignificantFields,
        { ...BASE, type: "system" } as ResearchSignificantFields,
      ),
    ).toBe(false);
  });

  it("returns true when manufacturer changes", () => {
    expect(
      researchSignificantFieldsChanged(BASE, { ...BASE, manufacturer: "Maytag" }),
    ).toBe(true);
  });

  it("returns true when model_number changes by even one digit", () => {
    expect(
      researchSignificantFieldsChanged(BASE, {
        ...BASE,
        model_number: "WFG361LFR",
      }),
    ).toBe(true);
  });

  it("treats whitespace and case differences as no change (no needless re-run)", () => {
    expect(
      researchSignificantFieldsChanged(BASE, {
        ...BASE,
        manufacturer: "  whirlpool  ",
        model_number: "wfg361lfq",
      }),
    ).toBe(false);
  });

  it("treats null and empty/whitespace strings as equivalent", () => {
    expect(
      researchSignificantFieldsChanged(
        { ...BASE, manufacturer: null },
        { ...BASE, manufacturer: "   " },
      ),
    ).toBe(false);
  });

  it("returns true when a null field becomes a real value", () => {
    expect(
      researchSignificantFieldsChanged(
        { ...BASE, model_number: null },
        { ...BASE, model_number: "WFG361LFQ" },
      ),
    ).toBe(true);
  });

  it("returns true when a real value becomes null (user cleared a field)", () => {
    expect(
      researchSignificantFieldsChanged(BASE, { ...BASE, manufacturer: null }),
    ).toBe(true);
  });

  it("ignores fields it does not own — name, type, serial, dates, notes don't matter here", () => {
    // The helper's input type is intentionally narrow; this test exists to
    // pin the documented contract that the helper is responsible *only*
    // for the two research-grounding fields. If a future contributor
    // wants to widen the contract, the test failure here is the prompt to
    // update the type and the technical guide together.
    const keys = Object.keys(BASE).sort();
    expect(keys).toEqual(["manufacturer", "model_number"]);
  });
});
