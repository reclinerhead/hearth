// @vitest-environment jsdom

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { HabitatFindingModal } from "./habitat-finding-modal";
import { HabitatFindingTrigger } from "./habitat-finding-trigger";
import type { ActivityLog } from "@/lib/habitat/activity-log";
import type { HabitatModule } from "@/lib/habitat/types";
import type { HabitatFindingRow } from "@/lib/hooks/use-habitat-findings";

// React 19's act() helper warns when it doesn't see this flag; the flag
// tells React that the test environment guarantees state updates are
// flushed inside act() boundaries. See:
// https://react.dev/reference/react/act
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

/**
 * Smoke tests for the habitat finding detail modal. Validates the content
 * contract (headline / summary / module label / activity log / placeholder)
 * and the modal mechanics lifted from DocumentModal (ESC closes, backdrop
 * click closes, focus returns to the trigger after close).
 *
 * Uses plain react-dom + jsdom rather than @testing-library/react's
 * render() helper so the test doesn't depend on RTL's auto-cleanup
 * ordering; each test mounts a fresh root and unmounts in afterEach.
 */

const RADON_MODULE: HabitatModule = {
  key: "epa_radon_zone",
  name: "EPA Radon Zone",
  description: "Looks up county-level EPA radon potential.",
  cadence: "once",
  isApplicable: () => true,
  async check() {
    throw new Error("not used");
  },
};

const RADON_ACTIVITY_LOG: ActivityLog = {
  started_at: "2026-05-18T12:00:00.000Z",
  completed_at: "2026-05-18T12:00:00.002Z",
  total_duration_ms: 1.4,
  steps: [
    {
      step: 1,
      kind: "fetch",
      at_ms: 0.1,
      narration:
        "I started by pulling up the EPA's radon zone data for your county.",
      detail: "lib/habitat/modules/epa-radon-zone/data.ts",
      source: {
        label: "EPA Map of Radon Zones (June 2024)",
        url: "https://www.epa.gov/radon/epa-map-radon-zones-0",
      },
    },
    {
      step: 2,
      kind: "compute",
      at_ms: 0.3,
      narration:
        'I normalized "County, State" into the dataset\'s lookup key.',
      detail: "RADON_ZONES_BY_STATE[MI][washtenaw]",
    },
    {
      step: 3,
      kind: "rule",
      at_ms: 0.6,
      narration: "I checked what Zone 1 means: it's the EPA's highest tier.",
      result_summary: "Zone 1 — highest potential",
    },
    {
      step: 4,
      kind: "decide",
      at_ms: 0.9,
      narration:
        "Because your county is in Zone 1, I'm flagging this as a 'concern'.",
      result_summary: "Severity: concern",
      source: {
        label: "How Hearth classifies radon findings",
        url: "/about/classification#radon",
      },
    },
    {
      step: 5,
      kind: "finding",
      at_ms: 1.2,
      narration: "I put the finding together for your dashboard.",
    },
  ],
};

function makeRow(overrides: Partial<HabitatFindingRow> = {}): HabitatFindingRow {
  return {
    module_key: "epa_radon_zone",
    status: "completed",
    severity: "concern",
    headline: "EPA Radon Zone 1 — highest potential",
    summary: "Washtenaw County, MI is classified as EPA Radon Zone 1.",
    findings: { zone: 1 },
    source_url: "https://www.epa.gov/radon/epa-map-radon-zones-0",
    error: null,
    actions: [
      {
        kind: "product",
        label: "Short-term radon test kit",
        url: "https://example.com/kit",
        priceHint: "~$15",
      },
    ],
    activity_log: RADON_ACTIVITY_LOG,
    checked_at: "2026-05-17T10:00:00.000Z",
    ...overrides,
  };
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  document.documentElement.classList.remove("scroll-locked");
  document.body.classList.remove("scroll-locked");
});

function render(ui: React.ReactElement) {
  act(() => root.render(ui));
}

function clickByText(text: string) {
  const candidates = Array.from(
    container.querySelectorAll<HTMLElement>("button,a"),
  );
  const el = candidates.find((c) => c.textContent?.includes(text));
  if (!el) throw new Error(`No clickable element with text "${text}"`);
  act(() => el.click());
  return el;
}

function dispatchKey(key: string) {
  act(() => {
    document.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
  });
}

describe("HabitatFindingModal", () => {
  it("renders headline, summary, and module label", () => {
    render(
      <HabitatFindingModal
        open
        onClose={() => {}}
        row={makeRow()}
        habitatModule={RADON_MODULE}
      />,
    );
    expect(document.body.textContent).toContain(
      "EPA Radon Zone 1 — highest potential",
    );
    expect(document.body.textContent).toContain(
      "Washtenaw County, MI is classified as EPA Radon Zone 1.",
    );
    expect(document.body.textContent).toContain("EPA Radon Zone");
  });

  it("renders all activity log steps in order with their narration", () => {
    render(
      <HabitatFindingModal
        open
        onClose={() => {}}
        row={makeRow()}
        habitatModule={RADON_MODULE}
      />,
    );
    const items = Array.from(document.querySelectorAll("ol > li"));
    expect(items.length).toBe(RADON_ACTIVITY_LOG.steps.length);
    RADON_ACTIVITY_LOG.steps.forEach((step, i) => {
      expect(items[i].textContent).toContain(step.narration);
    });
  });

  it("renders source links with the right target attributes", () => {
    render(
      <HabitatFindingModal
        open
        onClose={() => {}}
        row={makeRow()}
        habitatModule={RADON_MODULE}
      />,
    );
    const links = Array.from(
      document.querySelectorAll<HTMLAnchorElement>("ol a"),
    );
    const externalLink = links.find((a) =>
      a.textContent?.includes("EPA Map of Radon Zones"),
    );
    expect(externalLink).toBeDefined();
    expect(externalLink?.getAttribute("target")).toBe("_blank");
    expect(externalLink?.getAttribute("rel")).toBe("noopener noreferrer");

    const internalLink = links.find((a) =>
      a.textContent?.includes("How Hearth classifies"),
    );
    expect(internalLink).toBeDefined();
    expect(internalLink?.getAttribute("target")).toBeNull();
    expect(internalLink?.getAttribute("rel")).toBeNull();
  });

  it("renders the placeholder when activity_log is null", () => {
    render(
      <HabitatFindingModal
        open
        onClose={() => {}}
        row={makeRow({ activity_log: null })}
        habitatModule={RADON_MODULE}
      />,
    );
    expect(document.body.textContent).toContain(
      "This finding was recorded before we started capturing how it was computed.",
    );
    expect(document.querySelector("ol")).toBeNull();
  });

  it("renders the placeholder when activity_log.steps is empty", () => {
    render(
      <HabitatFindingModal
        open
        onClose={() => {}}
        row={makeRow({
          activity_log: { ...RADON_ACTIVITY_LOG, steps: [] },
        })}
        habitatModule={RADON_MODULE}
      />,
    );
    expect(document.body.textContent).toContain(
      "This finding was recorded before we started capturing how it was computed.",
    );
  });

  it("renders no action shelf when actions is null", () => {
    render(
      <HabitatFindingModal
        open
        onClose={() => {}}
        row={makeRow({ actions: null })}
        habitatModule={RADON_MODULE}
      />,
    );
    expect(document.body.textContent).not.toContain("What to do next");
  });

  it("renders no action shelf when actions is empty", () => {
    render(
      <HabitatFindingModal
        open
        onClose={() => {}}
        row={makeRow({ actions: [] })}
        habitatModule={RADON_MODULE}
      />,
    );
    expect(document.body.textContent).not.toContain("What to do next");
  });

  it("ESC closes the modal", () => {
    let closes = 0;
    render(
      <HabitatFindingModal
        open
        onClose={() => {
          closes += 1;
        }}
        row={makeRow()}
        habitatModule={RADON_MODULE}
      />,
    );
    dispatchKey("Escape");
    expect(closes).toBe(1);
  });

  it("backdrop click closes the modal", () => {
    let closes = 0;
    render(
      <HabitatFindingModal
        open
        onClose={() => {
          closes += 1;
        }}
        row={makeRow()}
        habitatModule={RADON_MODULE}
      />,
    );
    const backdrop = document.querySelector<HTMLElement>(".fixed.inset-0");
    expect(backdrop).toBeTruthy();
    act(() => backdrop!.click());
    expect(closes).toBe(1);
  });

  it("focus returns to the trigger button after close", () => {
    render(
      <HabitatFindingTrigger row={makeRow()} habitatModule={RADON_MODULE}>
        <span>open me</span>
      </HabitatFindingTrigger>,
    );
    const trigger = clickByText("open me") as HTMLButtonElement;
    expect(document.querySelector('[role="dialog"]')).toBeTruthy();

    dispatchKey("Escape");
    expect(document.activeElement).toBe(trigger);
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });
});
