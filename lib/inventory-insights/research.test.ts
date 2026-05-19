import { describe, expect, it } from "vitest";
import { insightsSchema } from "./research";

const valid = {
  headline: "40-gallon natural gas water heaters, Rheem ProValue line",
  overview: "Rheem's entry-level residential gas water heater line.",
  service_life:
    "Anode rod lasts 4-6 years before needing replacement; the tank itself averages 10-12 years.",
  maintenance:
    "Flush the tank annually to remove sediment; replace the anode rod every 5 years.",
  source_urls: ["https://example.com/rheem/spec-sheet"],
  found_specific_model: true,
};

describe("insightsSchema", () => {
  it("parses a payload with all three sections populated", () => {
    expect(() => insightsSchema.parse(valid)).not.toThrow();
  });

  it("parses a payload with all three sections null", () => {
    const payload = {
      ...valid,
      overview: null,
      service_life: null,
      maintenance: null,
    };
    expect(() => insightsSchema.parse(payload)).not.toThrow();
  });

  it("parses a partial payload (one section null)", () => {
    const payload = { ...valid, service_life: null };
    const parsed = insightsSchema.parse(payload);
    expect(parsed.service_life).toBeNull();
    expect(parsed.overview).not.toBeNull();
    expect(parsed.maintenance).not.toBeNull();
  });

  it("rejects an empty-string overview (must be null or non-empty)", () => {
    expect(() =>
      insightsSchema.parse({ ...valid, overview: "" }),
    ).toThrow();
  });

  it("rejects an empty-string service_life", () => {
    expect(() =>
      insightsSchema.parse({ ...valid, service_life: "" }),
    ).toThrow();
  });

  it("rejects an empty-string maintenance", () => {
    expect(() =>
      insightsSchema.parse({ ...valid, maintenance: "" }),
    ).toThrow();
  });

  it("rejects an overview longer than 1200 characters", () => {
    expect(() =>
      insightsSchema.parse({ ...valid, overview: "x".repeat(1201) }),
    ).toThrow();
  });

  it("rejects a service_life longer than 1200 characters", () => {
    expect(() =>
      insightsSchema.parse({ ...valid, service_life: "x".repeat(1201) }),
    ).toThrow();
  });

  it("rejects a maintenance longer than 1200 characters", () => {
    expect(() =>
      insightsSchema.parse({ ...valid, maintenance: "x".repeat(1201) }),
    ).toThrow();
  });

  it("rejects a missing headline", () => {
    const { headline: _omit, ...withoutHeadline } = valid;
    void _omit;
    expect(() => insightsSchema.parse(withoutHeadline)).toThrow();
  });

  it("rejects a missing overview key (Zod requires the field present even when null)", () => {
    const { overview: _omit, ...withoutOverview } = valid;
    void _omit;
    expect(() => insightsSchema.parse(withoutOverview)).toThrow();
  });

  it("rejects a missing service_life key", () => {
    const { service_life: _omit, ...withoutServiceLife } = valid;
    void _omit;
    expect(() => insightsSchema.parse(withoutServiceLife)).toThrow();
  });

  it("rejects a missing maintenance key", () => {
    const { maintenance: _omit, ...withoutMaintenance } = valid;
    void _omit;
    expect(() => insightsSchema.parse(withoutMaintenance)).toThrow();
  });

  it("rejects a non-boolean found_specific_model", () => {
    expect(() =>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      insightsSchema.parse({ ...valid, found_specific_model: "yes" as any }),
    ).toThrow();
  });

  it("rejects a non-URL source_url entry", () => {
    expect(() =>
      insightsSchema.parse({ ...valid, source_urls: ["not-a-url"] }),
    ).toThrow();
  });

  it("accepts an empty source_urls array", () => {
    expect(() =>
      insightsSchema.parse({ ...valid, source_urls: [] }),
    ).not.toThrow();
  });

  it("rejects a headline longer than 120 characters", () => {
    expect(() =>
      insightsSchema.parse({ ...valid, headline: "x".repeat(121) }),
    ).toThrow();
  });
});
