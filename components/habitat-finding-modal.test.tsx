// @vitest-environment jsdom

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { HabitatFindingModal } from "./habitat-finding-modal";
import { HabitatFindingTrigger } from "./habitat-finding-trigger";
import type { ActivityLog } from "@/lib/habitat/activity-log";
import type { HabitatModule, OverviewCard } from "@/lib/habitat/types";
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
  category: "environmental",
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

  it("renders the module thumbnail in the header when iconImage is set", () => {
    const moduleWithIcon: HabitatModule = {
      ...RADON_MODULE,
      iconImage: "/habitat_module_images/radon.jpg",
    };
    render(
      <HabitatFindingModal
        open
        onClose={() => {}}
        row={makeRow()}
        habitatModule={moduleWithIcon}
      />,
    );
    const header = container.querySelector("header");
    const img = header?.querySelector("img");
    expect(img).not.toBeNull();
    // next/image with `fill` rewrites the src through /_next/image with
    // the original path URL-encoded as the `url` query param. Match the
    // encoded form so the assertion survives the optimizer.
    expect(img?.getAttribute("src") ?? "").toContain(
      "habitat_module_images%2Fradon.jpg",
    );
  });

  it("does not render a thumbnail when the module has no iconImage", () => {
    render(
      <HabitatFindingModal
        open
        onClose={() => {}}
        row={makeRow()}
        habitatModule={RADON_MODULE}
      />,
    );
    const header = container.querySelector("header");
    expect(header?.querySelector("img")).toBeNull();
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
    // Activity log is collapsed by default — expand it first.
    clickByText("How we got here");
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
    clickByText("How we got here");
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
    clickByText("How we got here");
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
    clickByText("How we got here");
    expect(document.body.textContent).toContain(
      "This finding was recorded before we started capturing how it was computed.",
    );
  });

  it("the activity log is collapsed by default", () => {
    render(
      <HabitatFindingModal
        open
        onClose={() => {}}
        row={makeRow()}
        habitatModule={RADON_MODULE}
      />,
    );
    // The disclosure button is rendered, but no step list / placeholder
    // text is in the DOM until the user expands it.
    expect(document.body.textContent).toContain("How we got here");
    expect(document.querySelector("ol")).toBeNull();
    expect(document.body.textContent).not.toContain(
      RADON_ACTIVITY_LOG.steps[0].narration,
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

  describe("slotted shell", () => {
    // Two-card module to validate the count-aware back label, sorting,
    // and that the detail pane only renders when a module opts in.
    const TWO_CARD_DETAIL_TEXT = "Detail body for card-a";

    function makeSlottedModule(overrides: Partial<HabitatModule> = {}): HabitatModule {
      return {
        key: "test_slotted",
        name: "Test slotted module",
        description: "Test module for slotted-shell tests.",
        category: "environmental",
        cadence: "yearly",
        isApplicable: () => true,
        async check() {
          throw new Error("not used");
        },
        overviewCardsHeader: "Sites near your home",
        getOverviewCards(): OverviewCard[] {
          return [
            {
              id: "card-b",
              eyebrow: "Tier 2 · 1.0 mi NE",
              headline: "Beta site",
              subtitle: "200 Second St · Final NPL",
              severity: "caution",
              sourceUrl: "https://example.com/sites/b",
            },
            {
              id: "card-a",
              eyebrow: "Tier 1 · 0.4 mi ENE",
              headline: "Alpha site",
              subtitle: "100 First St · Final NPL",
              severity: "concern",
              sourceUrl: "https://example.com/sites/a",
            },
          ];
        },
        renderDetail(_row, cardId) {
          return <div>{`Detail body for ${cardId}`}</div>;
        },
        ...overrides,
      };
    }

    it("renders the overview-cards section under the module's header", () => {
      render(
        <HabitatFindingModal
          open
          onClose={() => {}}
          row={makeRow()}
          habitatModule={makeSlottedModule()}
        />,
      );
      expect(document.body.textContent).toContain("Sites near your home");
      expect(document.body.textContent).toContain("Alpha site");
      expect(document.body.textContent).toContain("Beta site");
    });

    it("preserves the order the module returns from getOverviewCards (module owns the sort, per #140)", () => {
      // The fixture returns Beta first, then Alpha. Prior to issue #140
      // the modal re-sorted by severity-desc and surfaced Alpha
      // (concern) before Beta (caution). Issue #140 hands the sort to
      // the module so Superfund's label-desc order can be honored;
      // every module is now expected to pre-sort. The modal renders
      // cards verbatim in the order the slot returned them.
      render(
        <HabitatFindingModal
          open
          onClose={() => {}}
          row={makeRow()}
          habitatModule={makeSlottedModule()}
        />,
      );
      const text = document.body.textContent ?? "";
      const alphaIdx = text.indexOf("Alpha site");
      const betaIdx = text.indexOf("Beta site");
      expect(alphaIdx).toBeGreaterThan(-1);
      expect(betaIdx).toBeGreaterThan(-1);
      expect(betaIdx).toBeLessThan(alphaIdx);
    });

    it("does not render the overview-cards section when getOverviewCards returns empty", () => {
      const mod = makeSlottedModule({ getOverviewCards: () => [] });
      render(
        <HabitatFindingModal
          open
          onClose={() => {}}
          row={makeRow()}
          habitatModule={mod}
        />,
      );
      expect(document.body.textContent).not.toContain("Sites near your home");
    });

    it("falls back to the modal's pre-slotted layout when the module omits the slots", () => {
      render(
        <HabitatFindingModal
          open
          onClose={() => {}}
          row={makeRow()}
          habitatModule={RADON_MODULE}
        />,
      );
      // No overview-cards section header should appear when the module
      // doesn't supply getOverviewCards.
      expect(document.body.textContent).not.toContain("Sites near your home");
      expect(document.body.textContent).not.toContain("Back to all");
    });

    it("clicking a card swaps the body to the detail pane and shows the count-aware back label", () => {
      render(
        <HabitatFindingModal
          open
          onClose={() => {}}
          row={makeRow()}
          habitatModule={makeSlottedModule()}
        />,
      );
      clickByText("Alpha site");
      expect(document.body.textContent).toContain(TWO_CARD_DETAIL_TEXT);
      expect(document.body.textContent).toContain("Back to all 2 findings");
      // Activity-log section belongs to the overview pane only.
      expect(document.body.textContent).not.toContain("How we got here");
    });

    it("uses the singular back label when there is only one card", () => {
      const mod = makeSlottedModule({
        getOverviewCards: () => [
          {
            id: "card-solo",
            eyebrow: "Tier 1 · 0.4 mi E",
            headline: "Solo site",
            subtitle: "1 Solo Way · Final NPL",
            severity: "concern",
          },
        ],
      });
      render(
        <HabitatFindingModal
          open
          onClose={() => {}}
          row={makeRow()}
          habitatModule={mod}
        />,
      );
      clickByText("Solo site");
      expect(document.body.textContent).toContain("Back to all findings");
      expect(document.body.textContent).not.toContain("Back to all 1 findings");
    });

    it("the back affordance returns to the overview pane", () => {
      render(
        <HabitatFindingModal
          open
          onClose={() => {}}
          row={makeRow()}
          habitatModule={makeSlottedModule()}
        />,
      );
      clickByText("Alpha site");
      expect(document.body.textContent).toContain(TWO_CARD_DETAIL_TEXT);
      clickByText("Back to all 2 findings");
      expect(document.body.textContent).not.toContain(TWO_CARD_DETAIL_TEXT);
      // Activity-log section is back, confirming we're in overview.
      expect(document.body.textContent).toContain("How we got here");
    });

    it("footer source link points to the card's sourceUrl in the detail pane and to the row's source_url in overview", () => {
      render(
        <HabitatFindingModal
          open
          onClose={() => {}}
          row={makeRow({ source_url: "https://example.com/row-source" })}
          habitatModule={makeSlottedModule()}
        />,
      );
      const overviewLink = Array.from(
        document.querySelectorAll<HTMLAnchorElement>("a"),
      ).find((a) => a.textContent?.includes("View source"));
      expect(overviewLink?.getAttribute("href")).toBe(
        "https://example.com/row-source",
      );

      clickByText("Alpha site");
      const detailLink = Array.from(
        document.querySelectorAll<HTMLAnchorElement>("a"),
      ).find((a) => a.textContent?.includes("View source"));
      expect(detailLink?.getAttribute("href")).toBe(
        "https://example.com/sites/a",
      );
    });

    it("ESC closes the modal from the detail pane", () => {
      let closes = 0;
      render(
        <HabitatFindingModal
          open
          onClose={() => {
            closes += 1;
          }}
          row={makeRow()}
          habitatModule={makeSlottedModule()}
        />,
      );
      clickByText("Alpha site");
      dispatchKey("Escape");
      expect(closes).toBe(1);
    });
  });

  /**
   * Issue #140: the `getFindingLabel` slot is three-state. The modal
   * must distinguish:
   *   - object returned → render that word
   *   - null returned    → suppress entirely (no second eyebrow word)
   *   - undefined returned (or slot not implemented) → fall back to
   *     the default severity word
   *
   * The legacy fallback case is load-bearing: rows persisted before
   * the slot was introduced return undefined, and they must keep
   * rendering the severity word so they don't visually regress
   * before the yearly cadence backfills them.
   */
  describe("getFindingLabel three-state semantics (issue #140)", () => {
    function moduleWithFindingLabel(
      ret: { word: string; color: string } | null | undefined,
    ): HabitatModule {
      return {
        ...RADON_MODULE,
        getFindingLabel: () => ret,
      };
    }

    it("renders the slot's word + color when getFindingLabel returns an object", () => {
      const mod = moduleWithFindingLabel({
        word: "Worth acting on",
        color: "rgb(123, 45, 67)",
      });
      render(
        <HabitatFindingModal
          open
          onClose={() => {}}
          row={makeRow()}
          habitatModule={mod}
        />,
      );
      expect(document.body.textContent).toContain("Worth acting on");
      // Default severity word must not also appear in the eyebrow.
      const header = container.querySelector("header");
      expect(header?.textContent).not.toContain("Concern");
    });

    it("suppresses the eyebrow word entirely when getFindingLabel returns null", () => {
      const mod = moduleWithFindingLabel(null);
      render(
        <HabitatFindingModal
          open
          onClose={() => {}}
          row={makeRow()}
          habitatModule={mod}
        />,
      );
      const header = container.querySelector("header");
      // No label word AND no severity-word fallback.
      expect(header?.textContent).not.toContain("Concern");
      expect(header?.textContent).not.toContain("Worth");
    });

    it("falls back to the default severity word when getFindingLabel returns undefined (legacy row)", () => {
      const mod = moduleWithFindingLabel(undefined);
      render(
        <HabitatFindingModal
          open
          onClose={() => {}}
          row={makeRow()}
          habitatModule={mod}
        />,
      );
      const header = container.querySelector("header");
      // Legacy contract — severity word still renders, same as a
      // module that doesn't implement the slot at all.
      expect(header?.textContent).toContain("Concern");
    });

    it("falls back to the default severity word when the slot is not implemented", () => {
      render(
        <HabitatFindingModal
          open
          onClose={() => {}}
          row={makeRow()}
          habitatModule={RADON_MODULE}
        />,
      );
      const header = container.querySelector("header");
      expect(header?.textContent).toContain("Concern");
    });
  });
});
