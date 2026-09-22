"use client";

/**
 * "Recent advisories" section of the WQA finding (issue #347).
 *
 * Renders the watcher's boil-water-advisory rows for the household's
 * water system, directly under the "Your water system" card. Fetched
 * LIVE when the finding opens — advisories change every 30 minutes on
 * the watcher's schedule, independently of `check()` runs, so they are
 * deliberately not part of the persisted finding payload.
 *
 * Reads go through the browser client under RLS (`water_advisory_sources`
 * and `water_advisories` are `to authenticated` SELECT). The PWSID is a
 * query key only; it is never rendered.
 *
 * States: not-watched (the city has no watcher source) → renders nothing;
 * watched-but-empty → one quiet line; watched → the timeline, oldest
 * first, with an open advisory featured in the warning tone.
 */

import { useEffect, useState } from "react";
import { Icon } from "@/components/icon";
import { Tooltip } from "@/components/tooltip";
import { createClient } from "@/lib/supabase/client";
import {
  buildAdvisoryTimeline,
  describeAdvisorySource,
  formatAdvisoryDate,
  type AdvisoryTimelineItem,
  type TimelineRow,
} from "@/lib/water-advisories/timeline";
import type { AdvisoryScope } from "@/lib/water-advisories/types";

type LoadState =
  | { kind: "loading" }
  | { kind: "not_watched" }
  | { kind: "error" }
  | {
      kind: "watched";
      sourceNote: string;
      watchingSince: string;
      items: AdvisoryTimelineItem[];
    };

export const ADVISORY_GUIDANCE =
  "Until it's lifted, boil tap water for two minutes before drinking, cooking, making ice, or brushing teeth — or use bottled water. Showering, laundry, and washing are fine.";

const SCOPE_META: Record<AdvisoryScope, { label: string; help: string }> = {
  system_wide: {
    label: "District-wide",
    help: "Affects customers across the water system.",
  },
  localized: {
    label: "Localized",
    help: "A listed set of streets or addresses, not the whole system.",
  },
  unknown: {
    label: "Scope unknown",
    help: "Hearth couldn't tell how wide this is from the notice. Treated as district-wide.",
  },
};

export function WqaAdvisoriesSection({ pwsid }: { pwsid: string }) {
  const [state, setState] = useState<LoadState>({ kind: "loading" });

  useEffect(() => {
    const supabase = createClient();
    let cancelled = false;

    async function load() {
      const { data: source, error: sourceError } = await supabase
        .from("water_advisory_sources")
        .select("kind, config, created_at, enabled")
        .eq("pwsid", pwsid)
        .maybeSingle();
      if (cancelled) return;
      if (sourceError) {
        setState({ kind: "error" });
        return;
      }
      if (!source || !source.enabled) {
        setState({ kind: "not_watched" });
        return;
      }
      const { data: rows, error } = await supabase
        .from("water_advisories")
        .select("source_url, title, summary, status, scope, published_on, first_seen_at")
        .eq("pwsid", pwsid)
        .order("first_seen_at", { ascending: false })
        .limit(20);
      if (cancelled) return;
      if (error) {
        setState({ kind: "error" });
        return;
      }
      setState({
        kind: "watched",
        sourceNote: describeAdvisorySource(
          source.kind as string,
          (source.config ?? {}) as Record<string, unknown>,
        ),
        watchingSince: (source.created_at as string).slice(0, 10),
        items: buildAdvisoryTimeline(
          (rows ?? []) as TimelineRow[],
          new Date().toISOString(),
        ),
      });
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [pwsid]);

  if (state.kind === "loading" || state.kind === "not_watched") return null;

  return (
    <section aria-labelledby="wqa-advisories-heading">
      <div className="eyebrow mb-1">Boil water advisories</div>
      <h3 id="wqa-advisories-heading" className="h3" style={{ marginBottom: 8 }}>
        Recent advisories
      </h3>

      {state.kind === "error" ? (
        <p className="text-small" style={{ color: "var(--color-text-tertiary)" }}>
          Couldn&rsquo;t load advisories right now. Hearth is still watching; try
          again in a moment.
        </p>
      ) : state.items.length === 0 ? (
        <p className="text-small" style={{ color: "var(--color-text-tertiary)" }}>
          No boil water advisories recorded since Hearth began watching on{" "}
          {formatAdvisoryDate(state.watchingSince)}.
        </p>
      ) : (
        <ol className="flex flex-col gap-2" style={{ listStyle: "none", margin: 0, padding: 0 }}>
          {state.items.map((item) => (
            <AdvisoryRow key={item.key} item={item} />
          ))}
        </ol>
      )}

      {state.kind === "watched" ? (
        <p
          className="text-small"
          style={{ color: "var(--color-text-tertiary)", marginTop: 8 }}
        >
          {state.sourceNote} Checked every 30 minutes; recorded since{" "}
          {formatAdvisoryDate(state.watchingSince)}.
        </p>
      ) : null}
    </section>
  );
}

function AdvisoryRow({ item }: { item: AdvisoryTimelineItem }) {
  const scope = SCOPE_META[item.scope];
  const dates =
    item.issuedOn && item.liftedOn
      ? `Issued ${formatAdvisoryDate(item.issuedOn)} · Lifted ${formatAdvisoryDate(item.liftedOn)}`
      : item.issuedOn
        ? item.open
          ? `Issued ${formatAdvisoryDate(item.issuedOn)}`
          : `Issued ${formatAdvisoryDate(item.issuedOn)} · no lift recorded`
        : item.liftedOn
          ? `Lifted ${formatAdvisoryDate(item.liftedOn)} · issue date not on record`
          : "";

  return (
    <li
      className="rounded-md"
      style={
        item.open
          ? {
              border: "1px solid color-mix(in oklab, var(--color-warning) 45%, transparent)",
              borderLeft: "3px solid var(--color-warning)",
              backgroundColor: "color-mix(in oklab, var(--color-warning) 10%, transparent)",
              padding: "var(--space-3) var(--space-4)",
            }
          : {
              border: "1px solid var(--color-border-subtle)",
              backgroundColor: "var(--color-bg-surface-raised)",
              padding: "var(--space-3) var(--space-4)",
            }
      }
    >
      <div className="flex flex-wrap items-center gap-1.5">
        {item.open ? (
          <span
            className="chip"
            style={{
              color: "var(--color-warning)",
              borderColor: "color-mix(in oklab, var(--color-warning) 45%, transparent)",
              fontWeight: 500,
            }}
          >
            <Icon name="alert-triangle" size={12} />
            Active now
          </span>
        ) : null}
        <Tooltip content={scope.help}>
          <span className="chip">{scope.label}</span>
        </Tooltip>
      </div>
      <div style={{ fontWeight: 500, marginTop: 6 }}>{item.title}</div>
      {item.open && item.summary ? (
        <p className="text-small" style={{ color: "var(--color-text-secondary)", margin: "4px 0 0" }}>
          {item.summary}
        </p>
      ) : null}
      {item.open ? (
        <p className="text-small" style={{ color: "var(--color-text-primary)", margin: "6px 0 0" }}>
          {ADVISORY_GUIDANCE}
        </p>
      ) : null}
      <div
        className="text-small flex flex-wrap items-center gap-x-3 gap-y-1"
        style={{ color: "var(--color-text-tertiary)", marginTop: 6 }}
      >
        {dates ? <span>{dates}</span> : null}
        <a
          href={item.sourceUrl}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1"
          style={{ color: "var(--color-text-secondary)" }}
        >
          Read the notice
          <Icon name="external-link" size={12} />
        </a>
      </div>
    </li>
  );
}
