import { describe, expect, it } from "vitest";
import {
  buildSerialDecodeSystemPrompt,
  buildSerialDecodeUserMessage,
  type SerialDecodeInput,
} from "./prompt";

const baseInput: SerialDecodeInput = {
  manufacturer: "Whirlpool",
  model_number: "WRF555SDFZ",
  serial_number: "RY4434039",
};

describe("buildSerialDecodeSystemPrompt", () => {
  it("returns a non-empty string", () => {
    expect(buildSerialDecodeSystemPrompt().length).toBeGreaterThan(0);
  });

  it("is deterministic across calls (no per-input state leaks in)", () => {
    expect(buildSerialDecodeSystemPrompt()).toBe(
      buildSerialDecodeSystemPrompt(),
    );
  });

  it("names every field the model must populate", () => {
    const prompt = buildSerialDecodeSystemPrompt();
    expect(prompt).toContain("manufacture_date");
    expect(prompt).toContain("precision");
    expect(prompt).toContain("encoding_rule_cited");
    expect(prompt).toContain("confidence");
    expect(prompt).toContain("reasoning");
  });

  it("instructs the model to name the encoding rule before applying it", () => {
    expect(buildSerialDecodeSystemPrompt()).toMatch(
      /Name the encoding rule/i,
    );
  });

  it("requires character-by-character application", () => {
    expect(buildSerialDecodeSystemPrompt()).toMatch(
      /character[- ]by[- ]character/i,
    );
  });

  it("requires an internal consistency check before committing", () => {
    expect(buildSerialDecodeSystemPrompt()).toMatch(
      /[Ii]nternal consistency check/,
    );
  });

  it("instructs the model to return null when uncertain", () => {
    const prompt = buildSerialDecodeSystemPrompt();
    expect(prompt).toMatch(/manufacture_date: null/);
    expect(prompt).toMatch(/[Ww]hen in doubt/);
  });

  it("warns that confidently-wrong dates are worse than no date", () => {
    expect(buildSerialDecodeSystemPrompt()).toMatch(
      /confidently[- ]wrong date is worse/i,
    );
  });

  it("names the three precision values", () => {
    const prompt = buildSerialDecodeSystemPrompt();
    expect(prompt).toContain('"year"');
    expect(prompt).toContain('"month"');
    expect(prompt).toContain('"week"');
  });

  it("names the three confidence values", () => {
    const prompt = buildSerialDecodeSystemPrompt();
    expect(prompt).toContain('"high"');
    expect(prompt).toContain('"medium"');
    expect(prompt).toContain('"low"');
  });

  it("specifies the date format per precision (year / month / week)", () => {
    const prompt = buildSerialDecodeSystemPrompt();
    expect(prompt).toContain("YYYY");
    expect(prompt).toContain("YYYY-MM");
    expect(prompt).toContain("YYYY-Www");
  });
});

describe("buildSerialDecodeUserMessage", () => {
  it("returns a non-empty string", () => {
    expect(buildSerialDecodeUserMessage(baseInput).length).toBeGreaterThan(0);
  });

  it("includes the manufacturer, model number, and serial", () => {
    const message = buildSerialDecodeUserMessage(baseInput);
    expect(message).toContain("Whirlpool");
    expect(message).toContain("WRF555SDFZ");
    expect(message).toContain("RY4434039");
  });

  it("displays '(unknown)' when manufacturer is null", () => {
    const message = buildSerialDecodeUserMessage({
      ...baseInput,
      manufacturer: null,
    });
    expect(message).toMatch(/Manufacturer: \(unknown\)/);
  });

  it("displays '(unknown)' when model_number is null", () => {
    const message = buildSerialDecodeUserMessage({
      ...baseInput,
      model_number: null,
    });
    expect(message).toMatch(/Model number: \(unknown\)/);
  });

  it("still includes the serial number even when manufacturer and model are null", () => {
    const message = buildSerialDecodeUserMessage({
      manufacturer: null,
      model_number: null,
      serial_number: "RY4434039",
    });
    expect(message).toContain("RY4434039");
  });

  it("reinforces the do-not-guess rule", () => {
    expect(buildSerialDecodeUserMessage(baseInput)).toMatch(/do not guess/i);
  });
});
