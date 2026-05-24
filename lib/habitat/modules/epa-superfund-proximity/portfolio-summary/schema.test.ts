import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  getPortfolioSummaryModel,
  portfolioSummarySchema,
} from "./schema";

describe("portfolioSummarySchema", () => {
  it("accepts a normal 2–4 sentence paragraph", () => {
    const result = portfolioSummarySchema.safeParse({
      summary:
        "Five EPA Superfund sites are within 5 miles of your home. The two most relevant are the active cleanups carrying chlorinated solvents in groundwater. Two others are in long-term monitoring with cleanup substantially complete.",
    });
    expect(result.success).toBe(true);
  });

  it("rejects an empty string", () => {
    const result = portfolioSummarySchema.safeParse({ summary: "" });
    expect(result.success).toBe(false);
  });

  it("rejects a too-short string (under the 40-char floor)", () => {
    const result = portfolioSummarySchema.safeParse({
      summary: "Just one site nearby.",
    });
    expect(result.success).toBe(false);
  });

  it("rejects a missing summary field", () => {
    const result = portfolioSummarySchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it("rejects a string over the 1200-char ceiling", () => {
    const result = portfolioSummarySchema.safeParse({
      summary: "a".repeat(1201),
    });
    expect(result.success).toBe(false);
  });
});

describe("getPortfolioSummaryModel", () => {
  const originals = {
    SUPERFUND_SUMMARY_MODEL: process.env.SUPERFUND_SUMMARY_MODEL,
    BRIEFING_PRIMARY_MODEL: process.env.BRIEFING_PRIMARY_MODEL,
  };

  beforeEach(() => {
    delete process.env.SUPERFUND_SUMMARY_MODEL;
    delete process.env.BRIEFING_PRIMARY_MODEL;
  });

  afterEach(() => {
    if (originals.SUPERFUND_SUMMARY_MODEL !== undefined) {
      process.env.SUPERFUND_SUMMARY_MODEL = originals.SUPERFUND_SUMMARY_MODEL;
    }
    if (originals.BRIEFING_PRIMARY_MODEL !== undefined) {
      process.env.BRIEFING_PRIMARY_MODEL = originals.BRIEFING_PRIMARY_MODEL;
    }
  });

  it("returns the SUPERFUND_SUMMARY_MODEL value when set", () => {
    process.env.SUPERFUND_SUMMARY_MODEL = "openai/gpt-5-mini";
    expect(getPortfolioSummaryModel()).toBe("openai/gpt-5-mini");
  });

  it("falls back to BRIEFING_PRIMARY_MODEL when the dedicated var is unset", () => {
    process.env.BRIEFING_PRIMARY_MODEL = "xai/grok-4.3";
    expect(getPortfolioSummaryModel()).toBe("xai/grok-4.3");
  });

  it("prefers the dedicated var when both are set", () => {
    process.env.SUPERFUND_SUMMARY_MODEL = "openai/gpt-5-mini";
    process.env.BRIEFING_PRIMARY_MODEL = "xai/grok-4.3";
    expect(getPortfolioSummaryModel()).toBe("openai/gpt-5-mini");
  });

  it("returns an empty string when neither is set (graceful-skip signal)", () => {
    expect(getPortfolioSummaryModel()).toBe("");
  });
});
