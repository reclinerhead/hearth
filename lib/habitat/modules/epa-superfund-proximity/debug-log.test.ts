import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { writeSuperfundSummaryDebugLog } from "./debug-log";
import type { PortfolioSummaryDebugCapture } from "./portfolio-summary/generate";

// Mock node:fs/promises so we can assert what the helper would (or
// wouldn't) write, without touching the real filesystem.
const appendFileMock = vi.fn(async () => undefined);
const mkdirMock = vi.fn(async () => undefined);
vi.mock("node:fs/promises", () => ({
  appendFile: (...args: unknown[]) => appendFileMock(...args),
  mkdir: (...args: unknown[]) => mkdirMock(...args),
}));

function makeCapture(
  overrides: Partial<PortfolioSummaryDebugCapture> = {},
): PortfolioSummaryDebugCapture {
  return {
    startedAt: "2026-05-24T10:00:00.000Z",
    durationMs: 1234,
    model: "openai/gpt-5-mini",
    input: {
      state: "MI",
      total_qualifying_sites: 2,
      portfolio_label: "worth_knowing",
      water_source: "well",
      basement_present: true,
      sites: [
        {
          name: "Allied Paper, Inc.",
          distance_miles: 1.2,
          bearing: "N",
          npl_status: "Final NPL",
          site_label: "worth_knowing",
          contaminants: ["Polychlorinated biphenyls", "Lead"],
          archived: false,
        },
      ],
    },
    systemPrompt: "TEST_SYSTEM_PROMPT",
    userMessage: "TEST_USER_MESSAGE",
    responseText: "Two sites are nearby. One is active.",
    error: null,
    ...overrides,
  };
}

const ORIGINAL_NODE_ENV = process.env.NODE_ENV;

beforeEach(() => {
  appendFileMock.mockClear();
  mkdirMock.mockClear();
});

afterEach(() => {
  // Restore the original NODE_ENV after each test so a test that
  // sets it doesn't leak into the next file's runs.
  if (ORIGINAL_NODE_ENV === undefined) {
    delete process.env.NODE_ENV;
  } else {
    process.env.NODE_ENV = ORIGINAL_NODE_ENV;
  }
});

describe("writeSuperfundSummaryDebugLog — dev-only gate (issue #158)", () => {
  it("writes a block to the log file when NODE_ENV === 'development'", async () => {
    process.env.NODE_ENV = "development";
    await writeSuperfundSummaryDebugLog(makeCapture());
    expect(mkdirMock).toHaveBeenCalledOnce();
    expect(appendFileMock).toHaveBeenCalledOnce();
    const [, written] = appendFileMock.mock.calls[0] as [
      string,
      string,
      string,
    ];
    expect(written).toContain("Timestamp:    2026-05-24T10:00:00.000Z");
    expect(written).toContain("Model:        openai/gpt-5-mini");
    expect(written).toContain("--- system prompt ---");
    expect(written).toContain("TEST_SYSTEM_PROMPT");
    expect(written).toContain("--- user message ---");
    expect(written).toContain("TEST_USER_MESSAGE");
    expect(written).toContain("--- response (summary text) ---");
    expect(written).toContain("Two sites are nearby. One is active.");
  });

  it("early-returns and writes nothing when NODE_ENV === 'production'", async () => {
    process.env.NODE_ENV = "production";
    await writeSuperfundSummaryDebugLog(makeCapture());
    expect(mkdirMock).not.toHaveBeenCalled();
    expect(appendFileMock).not.toHaveBeenCalled();
  });

  it("early-returns and writes nothing when NODE_ENV === 'preview' (Vercel preview)", async () => {
    // Vercel sets NODE_ENV to "production" on previews too, but a
    // hand-set "preview" string is also possible (Vercel exposes
    // VERCEL_ENV separately). Treat anything that isn't exactly
    // "development" as a non-dev environment.
    process.env.NODE_ENV = "preview";
    await writeSuperfundSummaryDebugLog(makeCapture());
    expect(appendFileMock).not.toHaveBeenCalled();
  });

  it("early-returns and writes nothing when NODE_ENV is unset", async () => {
    delete process.env.NODE_ENV;
    await writeSuperfundSummaryDebugLog(makeCapture());
    expect(appendFileMock).not.toHaveBeenCalled();
  });

  it("includes the homeowner property context in the rendered input block", async () => {
    process.env.NODE_ENV = "development";
    await writeSuperfundSummaryDebugLog(
      makeCapture({
        input: {
          ...makeCapture().input,
          water_source: "municipal",
          basement_present: false,
        },
      }),
    );
    const [, written] = appendFileMock.mock.calls[0] as [
      string,
      string,
      string,
    ];
    expect(written).toContain("water_source: municipal");
    expect(written).toContain("basement_present: no");
  });

  it("renders '(unset)' for missing model and '(not assembled — model unset)' for missing prompts", async () => {
    process.env.NODE_ENV = "development";
    await writeSuperfundSummaryDebugLog(
      makeCapture({
        model: null,
        systemPrompt: null,
        userMessage: null,
        responseText: null,
        error: "SUPERFUND_SUMMARY_MODEL is not set",
      }),
    );
    const [, written] = appendFileMock.mock.calls[0] as [
      string,
      string,
      string,
    ];
    expect(written).toContain("Model:        (unset)");
    expect(written).toContain("(not assembled — model unset)");
    expect(written).toContain("--- error ---");
    expect(written).toContain("SUPERFUND_SUMMARY_MODEL is not set");
  });

  it("never throws when the filesystem write fails", async () => {
    process.env.NODE_ENV = "development";
    appendFileMock.mockRejectedValueOnce(new Error("disk full"));
    // Suppress the console.warn noise the helper emits on failure
    // so the test output stays clean.
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    await expect(
      writeSuperfundSummaryDebugLog(makeCapture()),
    ).resolves.toBeUndefined();
    warnSpy.mockRestore();
  });
});
