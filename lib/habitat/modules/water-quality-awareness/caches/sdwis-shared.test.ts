import { describe, expect, it } from "vitest";
import { dedupeByKey } from "./sdwis-shared";

describe("dedupeByKey", () => {
  it("returns an empty array on empty input", () => {
    expect(dedupeByKey([], (x) => String(x))).toEqual([]);
  });

  it("preserves items whose keys are unique", () => {
    const items = [
      { id: "a", v: 1 },
      { id: "b", v: 2 },
      { id: "c", v: 3 },
    ];
    expect(dedupeByKey(items, (i) => i.id)).toEqual(items);
  });

  it("drops earlier duplicates (last-write-wins)", () => {
    const items = [
      { id: "a", v: 1 },
      { id: "b", v: 2 },
      { id: "a", v: 99 }, // duplicate id, later wins
    ];
    const result = dedupeByKey(items, (i) => i.id);
    expect(result).toHaveLength(2);
    expect(result.find((i) => i.id === "a")?.v).toBe(99);
  });

  it("regression: SDWIS violation conflict key dedup (the bug this helper fixes)", () => {
    // EPA's VIOLATION endpoint sometimes returns multiple rows for
    // the same (pwsid, violation_id). Before this helper, the batched
    // UPSERT failed with "ON CONFLICT DO UPDATE command cannot
    // affect row a second time". After: last write wins, the upsert
    // succeeds.
    const records = [
      { pwsid: "MI0003520", violation_id: "V1", contaminant_code: "5000" },
      { pwsid: "MI0003520", violation_id: "V2", contaminant_code: "1022" },
      { pwsid: "MI0003520", violation_id: "V1", contaminant_code: "5000-amended" },
    ];
    const deduped = dedupeByKey(
      records,
      (r) => `${r.pwsid}|${r.violation_id}`,
    );
    expect(deduped).toHaveLength(2);
    const v1 = deduped.find((r) => r.violation_id === "V1");
    expect(v1?.contaminant_code).toBe("5000-amended");
  });
});
