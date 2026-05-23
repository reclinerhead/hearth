import { describe, expect, it } from "vitest";
import { pickDefaultRoomId, type SeededRoom } from "./match-room";

const DEFAULT_ROOMS: SeededRoom[] = [
  { id: "r-kitchen", name: "Kitchen" },
  { id: "r-living", name: "Living Room" },
  { id: "r-bedroom", name: "Primary Bedroom" },
  { id: "r-bathroom", name: "Primary Bathroom" },
  { id: "r-basement", name: "Basement" },
  { id: "r-attic", name: "Attic" },
  { id: "r-garage", name: "Garage" },
  { id: "r-laundry", name: "Laundry" },
  { id: "r-exterior", name: "Exterior" },
];

describe("pickDefaultRoomId", () => {
  it("returns null when no rooms exist", () => {
    expect(
      pickDefaultRoomId({ rooms: [], suggestion: "Kitchen", type: "appliance" }),
    ).toBeNull();
  });

  it("matches the AI suggestion case-insensitively", () => {
    expect(
      pickDefaultRoomId({
        rooms: DEFAULT_ROOMS,
        suggestion: "kitchen",
        type: "appliance",
      }),
    ).toBe("r-kitchen");
  });

  it("trims whitespace around the AI suggestion", () => {
    expect(
      pickDefaultRoomId({
        rooms: DEFAULT_ROOMS,
        suggestion: "  Basement  ",
        type: "system",
      }),
    ).toBe("r-basement");
  });

  it("falls back to Basement when the suggestion misses for a system", () => {
    expect(
      pickDefaultRoomId({
        rooms: DEFAULT_ROOMS,
        suggestion: "Utility room",
        type: "system",
      }),
    ).toBe("r-basement");
  });

  it("falls back to Kitchen when the suggestion misses for an appliance", () => {
    expect(
      pickDefaultRoomId({
        rooms: DEFAULT_ROOMS,
        suggestion: "Pantry",
        type: "appliance",
      }),
    ).toBe("r-kitchen");
  });

  it("falls back to Exterior when the suggestion misses for an exterior item", () => {
    expect(
      pickDefaultRoomId({
        rooms: DEFAULT_ROOMS,
        suggestion: null,
        type: "exterior",
      }),
    ).toBe("r-exterior");
  });

  it("uses the type-based fallback when suggestion is null", () => {
    expect(
      pickDefaultRoomId({
        rooms: DEFAULT_ROOMS,
        suggestion: null,
        type: "system",
      }),
    ).toBe("r-basement");
  });

  it("falls back to Garage when the suggestion misses for a property item", () => {
    expect(
      pickDefaultRoomId({
        rooms: DEFAULT_ROOMS,
        suggestion: null,
        type: "property",
      }),
    ).toBe("r-garage");
  });

  it("returns the first room when neither suggestion nor fallback matches", () => {
    const oddRooms: SeededRoom[] = [
      { id: "first", name: "Sunroom" },
      { id: "second", name: "Mudroom" },
    ];
    expect(
      pickDefaultRoomId({
        rooms: oddRooms,
        suggestion: "Greenhouse",
        type: "appliance",
      }),
    ).toBe("first");
  });
});
