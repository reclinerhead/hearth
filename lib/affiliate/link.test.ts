import { describe, expect, it } from "vitest";
import { affiliateLink } from "./link";

describe("affiliateLink", () => {
  // Identity passthrough today. The moment we start mutating URLs (Amazon
  // Associates tag injection, AAX redirect, per-region storefront swap),
  // these tests will fail and remind us to update both the helper and the
  // contract callers have come to rely on.
  it("returns Amazon URLs unchanged", () => {
    const url = "https://www.amazon.com/s?k=radon+test+kit";
    expect(affiliateLink(url)).toBe(url);
  });

  it("returns non-Amazon URLs unchanged", () => {
    const url = "https://www.epa.gov/radon";
    expect(affiliateLink(url)).toBe(url);
  });

  it("preserves existing query strings", () => {
    const url = "https://example.com/product?ref=hearth&sku=42";
    expect(affiliateLink(url)).toBe(url);
  });
});
