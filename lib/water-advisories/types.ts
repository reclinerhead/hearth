/**
 * Shared shapes for the water advisory watcher (issue #331).
 *
 * The pipeline is: adapter (I/O) → ParsedAdvisory[] → classify (pure) →
 * plan (pure diff against stored rows) → route applies upserts and hands
 * notifiable events to the emailer. Everything between the adapter and
 * the route is I/O-free and unit-tested.
 */

export type AdvisoryStatus = "active" | "scheduled" | "lifted" | "unknown";
export type AdvisoryScope = "system_wide" | "localized" | "unknown";
export type AdvisoryEventKind = "issued" | "updated" | "lifted";

/** Adapter kinds. Widened alongside the CHECK constraint on `sources.kind`. */
export type SourceKind = "opencities_list" | "rss";

/**
 * What an adapter hands back for one advisory, before classification.
 * `published_on` is an ISO date (`YYYY-MM-DD`) or null when the source
 * doesn't print one for that entry.
 */
export type ParsedAdvisory = {
  source_url: string;
  title: string;
  summary: string;
  published_on: string | null;
  on_emergency_banner: boolean;
  /** Adapter-specific capture for debugging parser drift. */
  raw: Record<string, unknown>;
};

/** A ParsedAdvisory after `classify()` has stamped status + scope. */
export type ClassifiedAdvisory = ParsedAdvisory & {
  status: AdvisoryStatus;
  scope: AdvisoryScope;
};

/** The subset of a `hearth.water_advisories` row the planner compares. */
export type StoredAdvisory = {
  id: string;
  source_url: string;
  title: string;
  summary: string;
  status: AdvisoryStatus;
  scope: AdvisoryScope;
  content_hash: string;
  published_on: string | null;
  on_emergency_banner: boolean;
  /** Prior capture; merged under the new parse so detail-page fields
   *  (read only on first sight) survive later runs. */
  raw: Record<string, unknown>;
};

export type AdvisoryEvent = {
  kind: AdvisoryEventKind;
  source_url: string;
  title: string;
  scope: AdvisoryScope;
  /** True when subscribers should be told (district-wide or unknown scope). */
  notifiable: boolean;
  content_hash: string;
};
