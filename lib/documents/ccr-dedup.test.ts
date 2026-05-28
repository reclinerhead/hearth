import { describe, expect, it } from "vitest";
import { decideCcrDedupReason } from "./ccr-dedup";

describe("decideCcrDedupReason", () => {
  it("returns 'first-upload' when neither contributor nor report row exist", () => {
    expect(
      decideCcrDedupReason({ contributorExists: false, reportExists: false }),
    ).toBe("first-upload");
  });

  it("returns 'same-ccr-different-bytes' when only the report row exists", () => {
    expect(
      decideCcrDedupReason({ contributorExists: false, reportExists: true }),
    ).toBe("same-ccr-different-bytes");
  });

  it("returns 'identical-bytes' when the contributor row already exists", () => {
    expect(
      decideCcrDedupReason({ contributorExists: true, reportExists: true }),
    ).toBe("identical-bytes");
  });

  it("returns 'identical-bytes' even when reportExists is false (contributor takes precedence)", () => {
    // Structurally the report row should always exist when a
    // contributor row does (the contributor table FKs to it), so
    // this combination shouldn't arise in practice. The function
    // still picks the contributor-row interpretation defensively —
    // a byte-identical re-upload reads as 'identical-bytes'
    // regardless of upstream state.
    expect(
      decideCcrDedupReason({ contributorExists: true, reportExists: false }),
    ).toBe("identical-bytes");
  });
});
