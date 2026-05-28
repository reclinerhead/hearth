import { describe, expect, it } from "vitest";
import {
  isValidPwsid,
  normalizePwsid,
  parsePwsid,
} from "./pwsid-validation";

describe("normalizePwsid", () => {
  it("uppercases lowercase letters", () => {
    expect(normalizePwsid("mi0003520")).toBe("MI0003520");
  });

  it("preserves already-uppercase input", () => {
    expect(normalizePwsid("MI0003520")).toBe("MI0003520");
  });

  it("trims leading and trailing whitespace", () => {
    expect(normalizePwsid("  MI0003520  ")).toBe("MI0003520");
    expect(normalizePwsid("\tMI0003520\n")).toBe("MI0003520");
  });

  it("trims AND uppercases together", () => {
    expect(normalizePwsid("  mi0003520 ")).toBe("MI0003520");
  });

  it("does not strip internal characters", () => {
    // Validation step rejects these; normalization keeps them visible
    // so the failure has a clear cause.
    expect(normalizePwsid("MI-0003520")).toBe("MI-0003520");
    expect(normalizePwsid("MI 0003520")).toBe("MI 0003520");
  });
});

describe("isValidPwsid", () => {
  it("accepts the canonical EPA format", () => {
    expect(isValidPwsid("MI0003520")).toBe(true);
    expect(isValidPwsid("CA1234567")).toBe(true);
    expect(isValidPwsid("NY9999999")).toBe(true);
  });

  it("rejects lowercase letters (caller must normalize first)", () => {
    expect(isValidPwsid("mi0003520")).toBe(false);
  });

  it("rejects too-short identifiers", () => {
    expect(isValidPwsid("MI000352")).toBe(false);
    expect(isValidPwsid("MI")).toBe(false);
    expect(isValidPwsid("")).toBe(false);
  });

  it("rejects too-long identifiers", () => {
    expect(isValidPwsid("MI00035200")).toBe(false);
    expect(isValidPwsid("MMI0003520")).toBe(false);
  });

  it("rejects digits in the state-code position", () => {
    expect(isValidPwsid("110003520")).toBe(false);
  });

  it("rejects letters in the identifier position", () => {
    expect(isValidPwsid("MIAAAAAAA")).toBe(false);
    expect(isValidPwsid("MI000ABCD")).toBe(false);
  });

  it("rejects whitespace or separators inside the string", () => {
    expect(isValidPwsid("MI 0003520")).toBe(false);
    expect(isValidPwsid("MI-0003520")).toBe(false);
    expect(isValidPwsid("MI.0003520")).toBe(false);
  });
});

describe("parsePwsid", () => {
  it("splits a canonical PWSID into its pieces", () => {
    expect(parsePwsid("MI0003520")).toEqual({
      stateCode: "MI",
      identifier: "0003520",
      canonical: "MI0003520",
    });
  });

  it("normalizes lowercase input before parsing", () => {
    expect(parsePwsid("mi0003520")).toEqual({
      stateCode: "MI",
      identifier: "0003520",
      canonical: "MI0003520",
    });
  });

  it("normalizes whitespace before parsing", () => {
    expect(parsePwsid("  MI0003520  ")).toEqual({
      stateCode: "MI",
      identifier: "0003520",
      canonical: "MI0003520",
    });
  });

  it("returns null for invalid input", () => {
    expect(parsePwsid("MI000352")).toBeNull();
    expect(parsePwsid("not a pwsid")).toBeNull();
    expect(parsePwsid("")).toBeNull();
    expect(parsePwsid("MI-0003520")).toBeNull();
  });
});
