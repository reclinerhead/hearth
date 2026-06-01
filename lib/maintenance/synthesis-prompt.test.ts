import { describe, expect, it } from "vitest";
import {
  buildSynthesisSystemPrompt,
  buildSynthesisUserMessage,
  type SynthesisInput,
} from "./synthesis-prompt";

const baseInput: SynthesisInput = {
  inventory: {
    id: "inv-1",
    name: "Dryer",
    type: "appliance",
    subtype: null,
    manufacturer: "Kenmore",
    model_number: "110.76902690",
    installed_on: null,
    purchased_on: null,
  },
  ai_insights: {
    headline: "Gas clothes dryers",
    overview: "An entry-level gas dryer.",
    service_life: "10-15 years.",
    maintenance: "Clean the lint screen after every load.",
    generated_at: "2026-05-23T22:17:29.150Z",
  },
  habitat_findings: [],
  linked_receipts: [],
};

const runDate = new Date("2026-06-01T12:00:00Z");

describe("buildSynthesisSystemPrompt", () => {
  it("returns a non-empty, deterministic string", () => {
    expect(buildSynthesisSystemPrompt().length).toBeGreaterThan(0);
    expect(buildSynthesisSystemPrompt()).toBe(buildSynthesisSystemPrompt());
  });

  it("documents the reasoning fields the model must populate", () => {
    const prompt = buildSynthesisSystemPrompt();
    expect(prompt).toContain("source_kind");
    expect(prompt).toContain("cadence_basis");
    expect(prompt).toContain("modifiers");
  });

  it("documents the system_age modifier kind (the age-based modulation signal)", () => {
    expect(buildSynthesisSystemPrompt()).toContain("system_age");
  });

  it("anchors receipts via anchor.kind 'receipt' — not the schema-invalid 'receipt_anchored'", () => {
    const prompt = buildSynthesisSystemPrompt();
    // 'receipt_anchored' is a valid source_kind, but NOT a valid anchor.kind
    // (schema enum: receipt / install_date / synthesis_default). The earlier
    // prompt told the model to set anchor.kind to 'receipt_anchored', which
    // silently fails validation and drops the task.
    expect(prompt).toContain("anchor.kind to 'receipt'");
    expect(prompt).not.toContain("anchor.kind to 'receipt_anchored'");
  });

  it("documents the task kind values distinct from cadence timing", () => {
    const prompt = buildSynthesisSystemPrompt();
    expect(prompt).toMatch(/'service'/);
    expect(prompt).toMatch(/'inspection'/);
    expect(prompt).toMatch(/'consumable'/);
  });
});

describe("buildSynthesisUserMessage", () => {
  it("includes the item identity", () => {
    const message = buildSynthesisUserMessage(baseInput, runDate);
    expect(message).toContain("Dryer");
    expect(message).toContain("Kenmore");
    expect(message).toContain("110.76902690");
  });

  it("states today's date so receipt/install anchoring can be computed", () => {
    const message = buildSynthesisUserMessage(baseInput, runDate);
    expect(message).toContain("2026-06-01");
    expect(message).toMatch(/Today's date/i);
  });

  it("renders '(none on file)' when there is no service history", () => {
    const message = buildSynthesisUserMessage(baseInput, runDate);
    expect(message).toMatch(/Service history: \(none on file\)/);
  });

  it("renders linked receipts with their document_id when present", () => {
    const message = buildSynthesisUserMessage(
      {
        ...baseInput,
        linked_receipts: [
          {
            document_id: "doc-9",
            transaction_date: "2025-09-01",
            transaction_type: "service",
            vendor_name: "Acme HVAC",
            notes: null,
          },
        ],
      },
      runDate,
    );
    expect(message).toContain("doc-9");
    expect(message).toContain("Acme HVAC");
  });
});
