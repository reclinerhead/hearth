/**
 * Email for the water advisory watcher (issue #331): the Resend client
 * plus the three advisory templates, the confirmation email, and the
 * watcher-health alarm. Plain text + minimal HTML, no template library.
 *
 * Everything the city wrote is quoted and attributed, and HTML-escaped —
 * the advisory title/summary are scraped strings and must never be able
 * to inject markup into a subscriber's inbox.
 */

import { Resend } from "resend";
import type { AdvisoryEventKind } from "./types";

export function isEmailConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY && process.env.WATER_ADVISORY_FROM_EMAIL);
}

let client: Resend | null = null;
function resend(): Resend {
  const key = process.env.RESEND_API_KEY;
  if (!key) throw new Error("RESEND_API_KEY is not set");
  if (!client) client = new Resend(key);
  return client;
}

export type EmailMessage = { subject: string; text: string; html: string };

/** Send one email. Returns the provider message id. Throws on failure. */
export async function sendEmail(
  to: string,
  message: EmailMessage,
): Promise<string> {
  const from = process.env.WATER_ADVISORY_FROM_EMAIL;
  if (!from) throw new Error("WATER_ADVISORY_FROM_EMAIL is not set");
  const { data, error } = await resend().emails.send({
    from,
    to,
    subject: message.subject,
    text: message.text,
    html: message.html,
  });
  if (error) throw new Error(`Resend: ${error.name}: ${error.message}`);
  return data?.id ?? "";
}

// --------------------------------------------------------------------------
// Templates (pure)
// --------------------------------------------------------------------------

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** "2026-09-19" → "September 19, 2026" (calendar date, no timezone drift). */
export function formatPublishedOn(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(`${iso.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });
}

const GUIDANCE =
  "Until the advisory is lifted, boil tap water for two minutes before drinking, cooking, making ice, or brushing teeth — or use bottled water. Water for showering, laundry, and washing is fine.";

function shell(bodyHtml: string): string {
  return `<!doctype html><html><body style="margin:0;padding:24px;background:#0b0f19;color:#e6e1d8;font:16px/1.5 -apple-system,Segoe UI,Helvetica,Arial,sans-serif"><div style="max-width:560px;margin:0 auto">${bodyHtml}<p style="margin-top:32px;font-size:12px;color:#8a857c">Hearth · a ToddTech project</p></div></body></html>`;
}

const EVENT_SUBJECT: Record<AdvisoryEventKind, string> = {
  issued: "Boil water advisory issued",
  updated: "Boil water advisory updated",
  lifted: "Boil water advisory lifted",
};

const EVENT_LEAD: Record<AdvisoryEventKind, (place: string) => string> = {
  issued: (place) =>
    `${place} has posted a boil water advisory that appears to affect customers across the water system.`,
  updated: (place) => `${place} has updated a boil water advisory that affects customers across the water system.`,
  lifted: (place) => `${place} has lifted a boil water advisory. Tap water is safe to use again.`,
};

export type AdvisoryEmailInput = {
  event: AdvisoryEventKind;
  advisory: {
    title: string;
    summary: string;
    published_on: string | null;
    source_url: string;
  };
  place: { shortPlace: string; placeName: string };
  /** Who added the subscriber, for the "why am I getting this" line. */
  addedBy: string;
  unsubscribeUrl: string;
  /** The city's own alert signup, when it has one (issue #337). */
  officialAlerts?: { url: string; note: string | null } | null;
  /** Prefixes the subject and adds a banner line; used by "Send test email". */
  test?: boolean;
};

export function buildAdvisoryEmail(input: AdvisoryEmailInput): EmailMessage {
  const { event, advisory, place } = input;
  const date = formatPublishedOn(advisory.published_on);
  const attribution = date
    ? `${place.shortPlace}, published ${date}`
    : place.shortPlace;
  const subject = `${input.test ? "[Test] " : ""}${EVENT_SUBJECT[event]} — ${place.shortPlace}`;
  const lead = EVENT_LEAD[event](place.shortPlace);
  const why = `You're receiving this because ${input.addedBy} added you to Hearth's ${place.shortPlace} water advisory list.`;
  const testNote = input.test
    ? "This is a test message sent from Hearth's admin page. No advisory was issued."
    : null;
  const official = input.officialAlerts
    ? `${place.shortPlace} also offers its own alerts: ${input.officialAlerts.url}${input.officialAlerts.note ? ` (${input.officialAlerts.note})` : ""}`
    : null;

  const textParts = [
    advisory.title,
    "",
    ...(testNote ? [testNote, ""] : []),
    lead,
    "",
    advisory.summary ? `"${advisory.summary}" — ${attribution}` : `— ${attribution}`,
    "",
    `Read the notice: ${advisory.source_url}`,
    ...(event === "lifted" ? [] : ["", GUIDANCE]),
    ...(official ? ["", official] : []),
    "",
    why,
    `Unsubscribe: ${input.unsubscribeUrl}`,
  ];

  const html = shell(
    [
      testNote
        ? `<p style="padding:8px 12px;border:1px solid #d9a441;border-radius:6px;color:#f0c97a">${escapeHtml(testNote)}</p>`
        : "",
      `<p style="font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#8a857c;margin:0 0 4px">${escapeHtml(EVENT_SUBJECT[event])}</p>`,
      `<h1 style="font-size:22px;line-height:1.25;margin:0 0 16px;font-weight:500">${escapeHtml(advisory.title)}</h1>`,
      `<p>${escapeHtml(lead)}</p>`,
      advisory.summary
        ? `<blockquote style="margin:16px 0;padding:12px 16px;border-left:3px solid #d9a441;background:#141a27">${escapeHtml(advisory.summary)}<br><span style="font-size:13px;color:#8a857c">— ${escapeHtml(attribution)}</span></blockquote>`
        : `<p style="font-size:13px;color:#8a857c">— ${escapeHtml(attribution)}</p>`,
      `<p><a href="${escapeHtml(advisory.source_url)}" style="color:#f0c97a">Read the notice</a></p>`,
      event === "lifted" ? "" : `<p>${escapeHtml(GUIDANCE)}</p>`,
      input.officialAlerts
        ? `<p style="font-size:14px;color:#c9c3b8">${escapeHtml(place.shortPlace)} also offers its own alerts: <a href="${escapeHtml(input.officialAlerts.url)}" style="color:#f0c97a">${escapeHtml(input.officialAlerts.url)}</a>${input.officialAlerts.note ? ` <span style="color:#8a857c">(${escapeHtml(input.officialAlerts.note)})</span>` : ""}</p>`
        : "",
      `<p style="margin-top:28px;font-size:13px;color:#8a857c">${escapeHtml(why)} <a href="${escapeHtml(input.unsubscribeUrl)}" style="color:#8a857c">Unsubscribe</a>.</p>`,
    ].join(""),
  );

  return { subject, text: textParts.join("\n"), html };
}

export function buildConfirmationEmail(input: {
  name: string;
  place: { shortPlace: string; placeName: string };
  addedBy: string;
  confirmUrl: string;
}): EmailMessage {
  const subject = `Confirm ${input.place.shortPlace} water advisory alerts from Hearth`;
  const lead = `${input.addedBy} added you to Hearth's water advisory list for ${input.place.placeName}. Hearth watches the city's official advisory page every 30 minutes and emails this list when a boil water advisory that affects customers across the water system is issued, updated, or lifted.`;
  const text = [
    `Hi ${input.name},`,
    "",
    lead,
    "",
    `Confirm to start receiving alerts: ${input.confirmUrl}`,
    "",
    "If you didn't expect this, ignore it — nothing is sent until you confirm.",
  ].join("\n");
  const html = shell(
    [
      `<p>Hi ${escapeHtml(input.name)},</p>`,
      `<p>${escapeHtml(lead)}</p>`,
      `<p style="margin:24px 0"><a href="${escapeHtml(input.confirmUrl)}" style="display:inline-block;padding:10px 18px;background:#d9a441;color:#0b0f19;border-radius:6px;text-decoration:none;font-weight:500">Confirm and start receiving alerts</a></p>`,
      `<p style="font-size:13px;color:#8a857c">If you didn't expect this, ignore it — nothing is sent until you confirm.</p>`,
    ].join(""),
  );
  return { subject, text, html };
}

/** "Sep 23, 4:00 AM ET" — the house is in Michigan; the alarm reader is too. */
function formatEasternTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return `${d.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "America/Detroit",
  })} ET`;
}

/** "about 2 hours" / "about 35 minutes" between two ISO timestamps; null if unknown. */
export function describeOutage(lastOkAt: string | null, nowIso: string): string | null {
  if (!lastOkAt) return null;
  const ms = Date.parse(nowIso) - Date.parse(lastOkAt);
  if (!Number.isFinite(ms) || ms < 0) return null;
  const minutes = Math.round(ms / 60_000);
  if (minutes < 90) return `about ${minutes} minute${minutes === 1 ? "" : "s"}`;
  const hours = Math.round(minutes / 30) / 2;
  return `about ${hours} hour${hours === 1 ? "" : "s"}`;
}

export function buildWatcherAlarmEmail(input: {
  place: { shortPlace: string; placeName: string };
  recovered: boolean;
  consecutiveFailures: number;
  lastError: string | null;
  listUrl: string | null;
  /** The last successful run before this outage (issue #349). */
  lastOkAt: string | null;
  nowIso: string;
}): EmailMessage {
  const outage = describeOutage(input.lastOkAt, input.nowIso);
  const since = input.lastOkAt ? formatEasternTime(input.lastOkAt) : null;

  if (input.recovered) {
    const subject = `Water advisory watcher recovered — ${input.place.shortPlace}`;
    const text = `The ${input.place.placeName} advisory watcher is reading its source again after ${input.consecutiveFailures} consecutive failure(s)${outage && since ? ` — blind for ${outage}, since ${since}` : ""}.`;
    return { subject, text, html: shell(`<p>${escapeHtml(text)}</p>`) };
  }
  const subject = `Water advisory watcher is blind — ${input.place.shortPlace}`;
  const lines = [
    `The ${input.place.placeName} advisory watcher has failed ${input.consecutiveFailures} runs in a row${outage && since ? ` — blind for ${outage}, since its last good run at ${since}` : ""}. Until it recovers, Hearth cannot see new advisories for this city.`,
    "",
    `Last error: ${input.lastError ?? "unknown"}`,
    ...(input.listUrl ? ["", `Source page: ${input.listUrl}`] : []),
    "",
    "This alarm is sent once per outage; a recovery note follows when a run succeeds again.",
  ];
  return {
    subject,
    text: lines.join("\n"),
    html: shell(
      `<p>${escapeHtml(lines[0])}</p><p style="font-family:ui-monospace,monospace;font-size:13px;color:#f0c97a">${escapeHtml(lines[2])}</p>${input.listUrl ? `<p><a href="${escapeHtml(input.listUrl)}" style="color:#f0c97a">Source page</a></p>` : ""}<p style="font-size:13px;color:#8a857c">${escapeHtml(lines[lines.length - 1])}</p>`,
    ),
  };
}
