/**
 * The pure diff at the heart of the water advisory watcher (issue #331).
 *
 * Given what the adapter parsed this run and what `hearth.water_advisories`
 * already holds for the source, decide (a) which rows to upsert and (b)
 * which events fire. The route applies the upserts and hands notifiable
 * events to the emailer; nothing in here touches I/O or the clock beyond
 * the `nowIso` it is handed.
 *
 * Rules:
 *   - SEED SILENTLY. When the store is empty for this source, every parsed
 *     entry is inserted and NO events fire. Otherwise the first run would
 *     email everyone about the last month of history.
 *   - issued:  a new URL whose status is active / scheduled / unknown. The
 *              list page is advisory-only, so an entry our status heuristics
 *              can't read is still an advisory — over-notify, don't miss.
 *   - lifted:  a new URL with status lifted, OR an existing row whose parsed
 *              status flips to lifted. Takes precedence over `updated`.
 *   - updated: an existing URL whose content hash (title + summary) changed.
 *   - An entry that disappeared from the page is left alone (its
 *     last_seen_at simply stops advancing). It never notifies.
 *   - notifiable = scope is system_wide or unknown. Localized advisories are
 *     recorded and visible on the admin page but not sent (district-wide
 *     only for now).
 */

import { createHash } from "node:crypto";
import type {
  AdvisoryDetail,
  AdvisoryEvent,
  AdvisoryScope,
  AdvisoryStatus,
  ClassifiedAdvisory,
  StoredAdvisory,
} from "./types";

export type AdvisoryUpsert = {
  source_url: string;
  title: string;
  summary: string;
  status: AdvisoryStatus;
  scope: AdvisoryScope;
  published_on: string | null;
  on_emergency_banner: boolean;
  content_hash: string;
  last_seen_at: string;
  /** Set on new rows and on rows whose content/status/scope changed;
   *  omitted on an unchanged row so the DB keeps the previous value. */
  last_changed_at?: string;
  raw: Record<string, unknown>;
  /** Set on brand-new rows; omitted on updates so the DB keeps the original. */
  first_seen_at?: string;
};

export type AdvisoryPlan = {
  /** True when the store was empty and this run only seeded it. */
  seedOnly: boolean;
  upserts: AdvisoryUpsert[];
  events: AdvisoryEvent[];
  counts: { parsed: number; new: number; changed: number; unchanged: number };
};

export type PlanInput = {
  stored: readonly StoredAdvisory[];
  parsed: readonly ClassifiedAdvisory[];
  nowIso: string;
};

/**
 * SHA-256 over the normalized title + summary, plus the detail page's
 * heading and lead when the advisory has one (issue #355). Status is not
 * included — a status flip is its own event, not an "update". With no
 * detail the digest is byte-identical to the pre-#355 formula, so rows
 * from sources without detail pages (RSS) never re-hash on deploy.
 */
export function hashAdvisoryContent(
  title: string,
  summary: string,
  detail?: AdvisoryDetail,
): string {
  const norm = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();
  const hash = createHash("sha256").update(`${norm(title)}\n${norm(summary)}`);
  if (detail) {
    hash.update(`\n${norm(detail.title ?? "")}\n${norm(detail.lead ?? "")}`);
  }
  return hash.digest("hex");
}

export function isNotifiableScope(scope: AdvisoryScope): boolean {
  return scope !== "localized";
}

export function planAdvisoryRun(input: PlanInput): AdvisoryPlan {
  const storedByUrl = new Map(input.stored.map((s) => [s.source_url, s]));
  const seedOnly = input.stored.length === 0;

  const upserts: AdvisoryUpsert[] = [];
  const events: AdvisoryEvent[] = [];
  const counts = { parsed: input.parsed.length, new: 0, changed: 0, unchanged: 0 };

  // De-duplicate parsed entries by URL (the banner and the list can carry
  // the same advisory); the first occurrence wins for title/summary, but
  // a banner appearance anywhere marks the row.
  const seen = new Map<string, ClassifiedAdvisory>();
  for (const p of input.parsed) {
    const existing = seen.get(p.source_url);
    if (!existing) {
      seen.set(p.source_url, p);
    } else if (p.on_emergency_banner && !existing.on_emergency_banner) {
      seen.set(p.source_url, {
        ...existing,
        on_emergency_banner: true,
        scope: "system_wide",
      });
    }
  }

  for (const p of seen.values()) {
    const contentHash = hashAdvisoryContent(p.title, p.summary, p.detail);
    const prev = storedByUrl.get(p.source_url);

    if (!prev) {
      counts.new++;
      upserts.push({
        source_url: p.source_url,
        title: p.title,
        summary: p.summary,
        status: p.status,
        scope: p.scope,
        published_on: p.published_on,
        on_emergency_banner: p.on_emergency_banner,
        content_hash: contentHash,
        first_seen_at: input.nowIso,
        last_seen_at: input.nowIso,
        last_changed_at: input.nowIso,
        raw: p.raw,
      });
      if (!seedOnly) {
        events.push({
          kind: p.status === "lifted" ? "lifted" : "issued",
          source_url: p.source_url,
          title: p.title,
          scope: p.scope,
          notifiable: isNotifiableScope(p.scope),
          content_hash: contentHash,
        });
      }
      continue;
    }

    // Scope only ever ratchets up: once a row is known district-wide
    // (e.g. it was on the banner), a later run that no longer sees the
    // banner must not downgrade it.
    const scope: AdvisoryScope =
      prev.scope === "system_wide" ? "system_wide" : p.scope;
    const publishedOn = p.published_on ?? prev.published_on;

    const statusFlippedToLifted =
      p.status === "lifted" && prev.status !== "lifted";
    const contentChanged = prev.content_hash !== contentHash;
    const changed =
      contentChanged ||
      prev.status !== p.status ||
      prev.scope !== scope ||
      prev.on_emergency_banner !== p.on_emergency_banner ||
      (prev.published_on ?? null) !== (publishedOn ?? null);

    if (changed) counts.changed++;
    else counts.unchanged++;

    const upsert: AdvisoryUpsert = {
      source_url: p.source_url,
      title: p.title,
      summary: p.summary,
      status: p.status,
      scope,
      published_on: publishedOn,
      on_emergency_banner: p.on_emergency_banner,
      content_hash: contentHash,
      last_seen_at: input.nowIso,
      // Merge, don't replace: the detail page is re-read only while the
      // advisory is open, so on other runs its fields (detail_title, …)
      // live only in the stored capture. The fresh parse wins for the
      // keys it carries.
      raw: { ...prev.raw, ...p.raw },
    };
    if (changed) upsert.last_changed_at = input.nowIso;
    upserts.push(upsert);

    if (statusFlippedToLifted) {
      events.push({
        kind: "lifted",
        source_url: p.source_url,
        title: p.title,
        scope,
        notifiable: isNotifiableScope(scope),
        content_hash: contentHash,
      });
    } else if (contentChanged) {
      events.push({
        kind: "updated",
        source_url: p.source_url,
        title: p.title,
        scope,
        notifiable: isNotifiableScope(scope),
        content_hash: contentHash,
      });
    }
  }

  return { seedOnly, upserts, events, counts };
}
