import { describe, expect, it } from "vitest";
import {
  UNKNOWN_MODEL_NUMBER,
  displayModelNumber,
  isUnknownModelNumber,
  normalizeModelNumberForCreate,
} from "./model-number";

describe("normalizeModelNumberForCreate", () => {
  it("returns the sentinel for null", () => {
    expect(normalizeModelNumberForCreate(null)).toBe(UNKNOWN_MODEL_NUMBER);
  });

  it("returns the sentinel for empty string", () => {
    expect(normalizeModelNumberForCreate("")).toBe(UNKNOWN_MODEL_NUMBER);
  });

  it("returns the sentinel for whitespace-only", () => {
    expect(normalizeModelNumberForCreate("   ")).toBe(UNKNOWN_MODEL_NUMBER);
  });

  it("trims and returns a populated value verbatim", () => {
    expect(normalizeModelNumberForCreate("  WFG361LFQ  ")).toBe("WFG361LFQ");
  });

  it("does not normalize casing — a user-typed value is preserved", () => {
    expect(normalizeModelNumberForCreate("Wfg361Lfq")).toBe("Wfg361Lfq");
  });
});

describe("isUnknownModelNumber", () => {
  it("treats null as unknown", () => {
    expect(isUnknownModelNumber(null)).toBe(true);
  });

  it("matches the lowercase sentinel exactly", () => {
    expect(isUnknownModelNumber("unknown")).toBe(true);
  });

  it("matches case-insensitively (handles hand-edits)", () => {
    expect(isUnknownModelNumber("Unknown")).toBe(true);
    expect(isUnknownModelNumber("UNKNOWN")).toBe(true);
    expect(isUnknownModelNumber("uNkNoWn")).toBe(true);
  });

  it("matches with surrounding whitespace", () => {
    expect(isUnknownModelNumber("  unknown  ")).toBe(true);
  });

  it("does not match real model numbers", () => {
    expect(isUnknownModelNumber("WFG361LFQ")).toBe(false);
    expect(isUnknownModelNumber("RP145")).toBe(false);
  });

  it("does not match values that merely contain the sentinel", () => {
    expect(isUnknownModelNumber("unknown-1")).toBe(false);
    expect(isUnknownModelNumber("unknownmodel")).toBe(false);
  });

  it("treats empty/whitespace string as NOT unknown — these should never reach display code, but be explicit", () => {
    // normalizeModelNumberForCreate guarantees a populated string at the DB
    // layer, so a blank value at display time only happens for legacy rows
    // created before this convention. Those rows fall through to item.name
    // via the truthiness check that already gates the display branch.
    expect(isUnknownModelNumber("")).toBe(false);
    expect(isUnknownModelNumber("   ")).toBe(false);
  });
});

describe("displayModelNumber", () => {
  it("returns null when the value is the sentinel", () => {
    expect(displayModelNumber("unknown")).toBe(null);
    expect(displayModelNumber("Unknown")).toBe(null);
    expect(displayModelNumber("  UNKNOWN  ")).toBe(null);
  });

  it("returns null when the value is null", () => {
    expect(displayModelNumber(null)).toBe(null);
  });

  it("returns the trimmed value for real model numbers", () => {
    expect(displayModelNumber("WFG361LFQ")).toBe("WFG361LFQ");
    expect(displayModelNumber("  RP145  ")).toBe("RP145");
  });
});
