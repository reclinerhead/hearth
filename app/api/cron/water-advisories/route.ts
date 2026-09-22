/**
 * Water advisory watcher (issue #331) — the scheduled poll that reads each
 * watched city's advisory page, records what it finds, and emails the
 * confirmed subscriber list when a district-wide advisory is issued,
 * updated, or lifted.
 *
 * Runs every 30 minutes on Vercel Cron (see vercel.json). This route is
 * the thin I/O shell; the decisions live in pure, unit-tested modules:
 *   - lib/water-advisories/adapters/*  — fetch + parse per source kind
 *   - lib/water-advisories/classify.ts — status + scope
 *   - lib/water-advisories/plan.ts     — diff against stored rows → events
 *
 * RAILS:
 *   - Seed silently. A source with no stored advisories is imported with
 *     no notifications (plan.ts enforces it; the route just logs it).
 *   - District-wide only. Only notifiable events reach subscribers.
 *   - Dry-run by default. WATER_ADVISORY_NOTIFY_ENABLED must be "true"
 *     for a subscriber email to leave the building; otherwise every
 *     planned send is logged and nothing is sent or recorded.
 *   - Idempotent sends. A water_advisory_notifications row is inserted
 *     BEFORE the provider call; the unique key rejects a repeat.
 *   - Alarm on blindness. Consecutive failures past the threshold email
 *     WATER_ADVISORY_ALERT_EMAIL once, with a recovery note when a run
 *     succeeds again. A parse that yields zero entries is a failure.
 *
 * AUTH: bearer CRON_SECRET, same as the storage sweep; the proxy exempts
 * /api/cron/* so the cookie-less cron request reaches the handler.
 */

import { siteUrl } from "@/lib/public-pages/site-url";
import { createServiceClient } from "@/lib/supabase/service";
import {
  fetchOpenCitiesAdvisories,
  openCitiesListConfigSchema,
} from "@/lib/water-advisories/adapters/opencities-list";
import { classify } from "@/lib/water-advisories/classify";
import {
  buildAdvisoryEmail,
  buildWatcherAlarmEmail,
  isEmailConfigured,
  sendEmail,
} from "@/lib/water-advisories/email";
import { resolvePlaceNames, type PlaceNames } from "@/lib/water-advisories/place";
import { planAdvisoryRun, type AdvisoryUpsert } from "@/lib/water-advisories/plan";
import type {
  AdvisoryEvent,
  ParsedAdvisory,
  SourceKind,
  StoredAdvisory,
} from "@/lib/water-advisories/types";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const DEFAULT_FAILURE_ALERT_AFTER = 2;

type ServiceClient = ReturnType<typeof createServiceClient>;

type SourceRow = {
  pwsid: string;
  kind: SourceKind;
  config: Record<string, unknown>;
  enabled: boolean;
  consecutive_failures: number;
  failure_alerted_at: string | null;
};

type SubscriberRow = {
  id: string;
  name: string;
  email: string;
  unsubscribe_token: string;
  added_by_label: string;
};

type RunOptions = {
  notifyEnabled: boolean;
  alertEmail: string | null;
  failureAlertAfter: number;
  nowIso: string;
};

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

// --------------------------------------------------------------------------
// Adapter dispatch
// --------------------------------------------------------------------------

async function runAdapter(
  source: SourceRow,
  knownUrls: ReadonlySet<string>,
): Promise<{ parsed: ParsedAdvisory[]; systemWidePhrases: string[]; listUrl: string }> {
  switch (source.kind) {
    case "opencities_list": {
      const config = openCitiesListConfigSchema.parse(source.config);
      const parsed = await fetchOpenCitiesAdvisories(config, { knownUrls });
      return {
        parsed,
        systemWidePhrases: config.system_wide_phrases ?? [],
        listUrl: config.list_url,
      };
    }
    default:
      throw new Error(`unknown source kind: ${String(source.kind)}`);
  }
}

// --------------------------------------------------------------------------
// Health bookkeeping
// --------------------------------------------------------------------------

async function recordFailure(
  supabase: ServiceClient,
  source: SourceRow,
  place: PlaceNames,
  listUrl: string | null,
  message: string,
  opts: RunOptions,
): Promise<{ alerted: boolean }> {
  const consecutive = source.consecutive_failures + 1;
  const patch: Record<string, unknown> = {
    last_run_at: opts.nowIso,
    consecutive_failures: consecutive,
    last_error: message.slice(0, 1_000),
    updated_at: opts.nowIso,
  };

  let alerted = false;
  const shouldAlert =
    consecutive >= opts.failureAlertAfter &&
    !source.failure_alerted_at &&
    opts.alertEmail &&
    isEmailConfigured();
  if (shouldAlert) {
    try {
      await sendEmail(
        opts.alertEmail!,
        buildWatcherAlarmEmail({
          place,
          recovered: false,
          consecutiveFailures: consecutive,
          lastError: message,
          listUrl,
        }),
      );
      patch.failure_alerted_at = opts.nowIso;
      alerted = true;
    } catch (err) {
      console.error(`[water-advisories] ${source.pwsid} alarm email failed:`, errorMessage(err));
    }
  }

  const { error } = await supabase
    .from("water_advisory_sources")
    .update(patch)
    .eq("pwsid", source.pwsid);
  if (error) {
    console.error(`[water-advisories] ${source.pwsid} health write failed:`, error.message);
  }
  return { alerted };
}

async function recordSuccess(
  supabase: ServiceClient,
  source: SourceRow,
  place: PlaceNames,
  opts: RunOptions,
): Promise<void> {
  if (source.failure_alerted_at && opts.alertEmail && isEmailConfigured()) {
    try {
      await sendEmail(
        opts.alertEmail,
        buildWatcherAlarmEmail({
          place,
          recovered: true,
          consecutiveFailures: source.consecutive_failures,
          lastError: null,
          listUrl: null,
        }),
      );
    } catch (err) {
      console.error(`[water-advisories] ${source.pwsid} recovery email failed:`, errorMessage(err));
    }
  }
  const { error } = await supabase
    .from("water_advisory_sources")
    .update({
      last_run_at: opts.nowIso,
      last_ok_at: opts.nowIso,
      consecutive_failures: 0,
      last_error: null,
      failure_alerted_at: null,
      updated_at: opts.nowIso,
    })
    .eq("pwsid", source.pwsid);
  if (error) {
    console.error(`[water-advisories] ${source.pwsid} health write failed:`, error.message);
  }
}

// --------------------------------------------------------------------------
// Notifications
// --------------------------------------------------------------------------

async function notifySubscribers(
  supabase: ServiceClient,
  source: SourceRow,
  place: PlaceNames,
  events: AdvisoryEvent[],
  advisoryIdByUrl: Map<string, string>,
  upsertByUrl: Map<string, AdvisoryUpsert>,
  opts: RunOptions,
): Promise<{ planned: number; sent: number; skipped: number; failed: number }> {
  const result = { planned: 0, sent: 0, skipped: 0, failed: 0 };
  if (events.length === 0) return result;

  const { data: subs, error } = await supabase
    .from("water_advisory_subscribers")
    .select("id, name, email, unsubscribe_token, added_by_label")
    .eq("pwsid", source.pwsid)
    .eq("status", "confirmed");
  if (error) throw new Error(`subscriber read: ${error.message}`);
  const subscribers = (subs ?? []) as SubscriberRow[];

  const base = siteUrl();
  for (const event of events) {
    const advisoryId = advisoryIdByUrl.get(event.source_url);
    const advisory = upsertByUrl.get(event.source_url);
    if (!advisoryId || !advisory) {
      console.error(`[water-advisories] ${source.pwsid} no row for event ${event.source_url}`);
      continue;
    }
    console.info(
      `[water-advisories] ${source.pwsid} event[${event.kind}] "${event.title}" → ${subscribers.length} subscriber(s)${opts.notifyEnabled ? "" : " (dry-run)"}`,
    );
    for (const sub of subscribers) {
      result.planned++;
      if (!opts.notifyEnabled) continue;

      // Row first. A unique-violation means this exact send already
      // happened (a retried run) — skip, never resend.
      const { data: note, error: insertError } = await supabase
        .from("water_advisory_notifications")
        .insert({
          advisory_id: advisoryId,
          subscriber_id: sub.id,
          channel: "email",
          event: event.kind,
          content_hash: event.content_hash,
        })
        .select("id")
        .maybeSingle();
      if (insertError) {
        if (insertError.code === "23505") {
          result.skipped++;
          continue;
        }
        result.failed++;
        console.error(`[water-advisories] notification insert failed:`, insertError.message);
        continue;
      }

      try {
        const message = buildAdvisoryEmail({
          event: event.kind,
          advisory: {
            title: advisory.title,
            summary: advisory.summary,
            published_on: advisory.published_on,
            source_url: advisory.source_url,
          },
          place,
          addedBy: sub.added_by_label,
          unsubscribeUrl: `${base}/api/advisories/unsubscribe?token=${encodeURIComponent(sub.unsubscribe_token)}`,
        });
        const providerId = await sendEmail(sub.email, message);
        await supabase
          .from("water_advisory_notifications")
          .update({ sent_at: new Date().toISOString(), provider_message_id: providerId })
          .eq("id", note!.id);
        result.sent++;
      } catch (err) {
        result.failed++;
        const message = errorMessage(err);
        console.error(`[water-advisories] send to ${sub.id} failed:`, message);
        await supabase
          .from("water_advisory_notifications")
          .update({ error: message.slice(0, 1_000) })
          .eq("id", note!.id);
      }
    }
  }
  return result;
}

// --------------------------------------------------------------------------
// One source
// --------------------------------------------------------------------------

async function processSource(
  supabase: ServiceClient,
  source: SourceRow,
  place: PlaceNames,
  opts: RunOptions,
): Promise<Record<string, unknown>> {
  const tag = `[water-advisories] ${source.pwsid}`;

  const { data: storedRows, error: storedError } = await supabase
    .from("water_advisories")
    .select(
      "id, source_url, title, summary, status, scope, content_hash, published_on, on_emergency_banner, raw",
    )
    .eq("pwsid", source.pwsid);
  if (storedError) throw new Error(`stored read: ${storedError.message}`);
  const stored = (storedRows ?? []) as StoredAdvisory[];
  const knownUrls = new Set(stored.map((s) => s.source_url));

  let adapterResult: Awaited<ReturnType<typeof runAdapter>>;
  try {
    adapterResult = await runAdapter(source, knownUrls);
  } catch (err) {
    const message = errorMessage(err);
    console.error(`${tag} fetch/parse failed:`, message);
    const listUrl =
      typeof source.config.list_url === "string" ? source.config.list_url : null;
    const { alerted } = await recordFailure(supabase, source, place, listUrl, message, opts);
    return {
      pwsid: source.pwsid,
      status: "failed",
      error: message,
      consecutiveFailures: source.consecutive_failures + 1,
      alerted,
    };
  }

  const classified = adapterResult.parsed.map((p) =>
    classify(p, { systemWidePhrases: adapterResult.systemWidePhrases }),
  );
  const plan = planAdvisoryRun({ stored, parsed: classified, nowIso: opts.nowIso });

  // Apply upserts: new rows in one insert (returning ids), changed/seen
  // rows as individual updates so first_seen_at is never rewritten.
  const advisoryIdByUrl = new Map(stored.map((s) => [s.source_url, s.id]));
  const upsertByUrl = new Map(plan.upserts.map((u) => [u.source_url, u]));
  const inserts = plan.upserts.filter((u) => u.first_seen_at);
  const updates = plan.upserts.filter((u) => !u.first_seen_at);

  if (inserts.length > 0) {
    const { data, error } = await supabase
      .from("water_advisories")
      .insert(inserts.map((u) => ({ pwsid: source.pwsid, ...u })))
      .select("id, source_url");
    if (error) throw new Error(`advisory insert: ${error.message}`);
    for (const row of (data ?? []) as { id: string; source_url: string }[]) {
      advisoryIdByUrl.set(row.source_url, row.id);
    }
  }
  for (const u of updates) {
    const { source_url, ...patch } = u;
    const { error } = await supabase
      .from("water_advisories")
      .update(patch)
      .eq("source_url", source_url);
    if (error) throw new Error(`advisory update: ${error.message}`);
  }

  const notifiable = plan.events.filter((e) => e.notifiable);
  const recorded = plan.events.length - notifiable.length;
  if (plan.seedOnly) {
    console.info(`${tag} seeded ${plan.counts.new} advisories silently`);
  }
  for (const e of plan.events) {
    if (!e.notifiable) console.info(`${tag} event[${e.kind}] "${e.title}" (localized — recorded, not sent)`);
  }

  const sends = await notifySubscribers(
    supabase,
    source,
    place,
    notifiable,
    advisoryIdByUrl,
    upsertByUrl,
    opts,
  );

  await recordSuccess(supabase, source, place, opts);

  const summary = {
    pwsid: source.pwsid,
    status: plan.seedOnly ? "seeded" : "ok",
    parsed: plan.counts.parsed,
    new: plan.counts.new,
    changed: plan.counts.changed,
    unchanged: plan.counts.unchanged,
    events: notifiable.length,
    localizedEvents: recorded,
    sends,
  };
  console.info(`${tag} run`, summary);
  return summary;
}

// --------------------------------------------------------------------------
// Handler
// --------------------------------------------------------------------------

export async function GET(request: Request): Promise<Response> {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    console.error("[water-advisories] CRON_SECRET is not set — refusing to run");
    return json({ error: "Watcher is not configured." }, 500);
  }
  if (request.headers.get("authorization") !== `Bearer ${secret}`) {
    return json({ error: "Unauthorized." }, 401);
  }

  const opts: RunOptions = {
    notifyEnabled: process.env.WATER_ADVISORY_NOTIFY_ENABLED === "true",
    alertEmail: process.env.WATER_ADVISORY_ALERT_EMAIL || null,
    failureAlertAfter: envInt("WATER_ADVISORY_FAILURE_ALERT_AFTER", DEFAULT_FAILURE_ALERT_AFTER),
    nowIso: new Date().toISOString(),
  };
  if (opts.notifyEnabled && !isEmailConfigured()) {
    console.error(
      "[water-advisories] WATER_ADVISORY_NOTIFY_ENABLED is true but RESEND_API_KEY / WATER_ADVISORY_FROM_EMAIL are not set — sends will fail",
    );
  }

  const supabase = createServiceClient();
  const { data: sourceRows, error } = await supabase
    .from("water_advisory_sources")
    .select("pwsid, kind, config, enabled, consecutive_failures, failure_alerted_at")
    .eq("enabled", true);
  if (error) {
    console.error("[water-advisories] source read failed:", error.message);
    return json({ error: "Could not read sources." }, 500);
  }
  const sources = (sourceRows ?? []) as SourceRow[];
  const places = await resolvePlaceNames(
    supabase,
    sources.map((s) => s.pwsid),
  );

  const results: Record<string, unknown>[] = [];
  for (const source of sources) {
    const place = places.get(source.pwsid)!;
    try {
      results.push(await processSource(supabase, source, place, opts));
    } catch (err) {
      // A DB-side failure after the fetch succeeded. Count it as a
      // failure for the health record so it can alarm like a fetch would.
      const message = errorMessage(err);
      console.error(`[water-advisories] ${source.pwsid} run failed:`, message);
      const { alerted } = await recordFailure(supabase, source, place, null, message, opts);
      results.push({ pwsid: source.pwsid, status: "failed", error: message, alerted });
    }
  }

  return json(
    {
      status: "ok",
      notifyEnabled: opts.notifyEnabled,
      emailConfigured: isEmailConfigured(),
      sources: results,
    },
    200,
  );
}
