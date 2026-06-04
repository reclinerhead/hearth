import { describe, expect, it } from "vitest";
import { deriveIsFirstUnresearchedItem } from "./first-unresearched";

describe("deriveIsFirstUnresearchedItem", () => {
  it("is true only when this item is unresearched AND the house has none researched", () => {
    expect(
      deriveIsFirstUnresearchedItem({
        itemHasInsights: false,
        houseHasResearchedItem: false,
      }),
    ).toBe(true);
  });

  it("is false when this item already has insights (even if it's the only one)", () => {
    // The house-has-researched flag counts this item too, so in practice these
    // travel together; assert the item gate independently anyway.
    expect(
      deriveIsFirstUnresearchedItem({
        itemHasInsights: true,
        houseHasResearchedItem: true,
      }),
    ).toBe(false);
  });

  it("is false when another item in the house has been researched", () => {
    // A fresh, unresearched item loaded after the household's first research:
    // condition (a) holds but (b) does not, so the teach never re-surfaces.
    expect(
      deriveIsFirstUnresearchedItem({
        itemHasInsights: false,
        houseHasResearchedItem: true,
      }),
    ).toBe(false);
  });

  it("is false once this item carries insights regardless of the house flag", () => {
    expect(
      deriveIsFirstUnresearchedItem({
        itemHasInsights: true,
        houseHasResearchedItem: false,
      }),
    ).toBe(false);
  });
});
