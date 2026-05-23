import { describe, expect, it } from "vitest";
import { caseFoldSerial, normalizeSerial } from "./serial-normalize";

describe("caseFoldSerial", () => {
  it("uppercases the input", () => {
    expect(caseFoldSerial("abc123")).toBe("ABC123");
  });

  it("preserves punctuation (the lighter pass — only case folds)", () => {
    expect(caseFoldSerial("1hgbh41j-xmn-109186")).toBe(
      "1HGBH41J-XMN-109186",
    );
  });

  it("trims surrounding whitespace", () => {
    expect(caseFoldSerial("  abc  ")).toBe("ABC");
  });

  it("returns null for empty input", () => {
    expect(caseFoldSerial("")).toBeNull();
    expect(caseFoldSerial("   ")).toBeNull();
  });

  it("returns null for null/undefined", () => {
    expect(caseFoldSerial(null)).toBeNull();
    expect(caseFoldSerial(undefined)).toBeNull();
  });
});

describe("normalizeSerial", () => {
  it("uppercases the input", () => {
    expect(normalizeSerial("abc123")).toBe("ABC123");
  });

  it("strips hyphens", () => {
    expect(normalizeSerial("1HGBH41J-XMN-109186")).toBe("1HGBH41JXMN109186");
  });

  it("strips whitespace embedded mid-string", () => {
    expect(normalizeSerial("ABC 123 45")).toBe("ABC12345");
  });

  it("strips dots, slashes, and colons", () => {
    expect(normalizeSerial("ABC.123/45:67")).toBe("ABC1234567");
  });

  it("collapses mixed punctuation+whitespace clusters", () => {
    expect(normalizeSerial("AB --  12 / 34")).toBe("AB1234");
  });

  it("returns null for empty/whitespace input", () => {
    expect(normalizeSerial("")).toBeNull();
    expect(normalizeSerial("   ")).toBeNull();
  });

  it("returns null for null/undefined", () => {
    expect(normalizeSerial(null)).toBeNull();
    expect(normalizeSerial(undefined)).toBeNull();
  });

  it("returns null when stripping leaves an empty string", () => {
    // "..." normalizes to "" — we treat that as no serial rather than
    // joining everything to everything in the matcher.
    expect(normalizeSerial("...")).toBeNull();
    expect(normalizeSerial(" - / . : ")).toBeNull();
  });

  it("preserves non-ASCII digits and letters (whitelisted strip only)", () => {
    // Cyrillic letter that happens to look like Latin 'A' — survives
    // the strip since it's not in the whitelisted character class.
    expect(normalizeSerial("ABCΩ123")).toBe("ABCΩ123");
  });
});
