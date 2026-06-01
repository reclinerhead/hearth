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

  it("mandates a combustibles/clearance task for fuel-burning appliances", () => {
    const prompt = buildSynthesisSystemPrompt();
    expect(prompt).toMatch(/fuel-burning/i);
    expect(prompt).toMatch(/clear of combustibles/i);
  });

  it("tells the model that separate source sentences are not separate tasks", () => {
    expect(buildSynthesisSystemPrompt()).toMatch(
      /not automatically separate tasks/i,
    );
  });

  it("routes one-time setup checks away from recurring intervals", () => {
    const prompt = buildSynthesisSystemPrompt();
    expect(prompt).toMatch(/one-time setup/i);
    expect(prompt).toMatch(/cadence\.kind = 'one_time'/);
  });

  it("omits installer setup checks like leveling entirely, not even as one_time", () => {
    const prompt = buildSynthesisSystemPrompt();
    expect(prompt).toMatch(/installer setup/i);
    expect(prompt).toMatch(/do not emit them, not even as a one_time task/i);
  });

  it("routes symptom-conditional service to per-use awareness, not interval", () => {
    const prompt = buildSynthesisSystemPrompt();
    expect(prompt).toMatch(/symptom-conditional/i);
    expect(prompt).toMatch(/do not emit these as interval/i);
  });

  it("treats conditional symptom-watch as a per-use case", () => {
    const prompt = buildSynthesisSystemPrompt();
    expect(prompt).toMatch(/conditional symptom-watch is also per-use/i);
  });

  it("keeps the fuel-burning clearance baseline distinct from conditional service", () => {
    const prompt = buildSynthesisSystemPrompt();
    expect(prompt).toMatch(/don't conflate .*combustibles.* with .*leak-tested/i);
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
