"use client";

import { useRouter } from "next/navigation";
import { useState, useSyncExternalStore, useTransition, type FormEvent } from "react";
import { addSubscriberAction } from "@/app/actions/water-advisories/add-subscriber";
import { removeSubscriberAction } from "@/app/actions/water-advisories/remove-subscriber";
import { resendConfirmationAction } from "@/app/actions/water-advisories/resend-confirmation";
import { sendTestEmailAction } from "@/app/actions/water-advisories/send-test-email";
import { Icon, type IconName } from "@/components/icon";
import { Toast } from "@/components/toast";
import { Tooltip } from "@/components/tooltip";
import { SectionHeader } from "@/components/ui";
import type { AdvisoryScope, AdvisoryStatus } from "@/lib/water-advisories/types";

/**
 * Admin surface for the water advisory watcher (issue #331). One city at
 * a time: the watcher's mode + health, the advisories it has recorded,
 * and the subscriber list with its actions. Everything mutating goes
 * through server actions under app/actions/water-advisories/ and the
 * page re-renders via router.refresh().
 *
 * Designed to be usable from a phone during an advisory — single column
 * below `sm`, forms stack, rows wrap.
 */

export type AdminAdvisory = {
  id: string;
  title: string;
  summary: string;
  status: AdvisoryStatus;
  scope: AdvisoryScope;
  publishedOn: string | null;
  onEmergencyBanner: boolean;
  sourceUrl: string;
  firstSeenAt: string;
  lastChangedAt: string;
};

export type AdminSubscriber = {
  id: string;
  name: string;
  email: string;
  address: string;
  status: "pending" | "confirmed" | "unsubscribed";
  createdAt: string;
  confirmedAt: string | null;
  addedBy: string;
};

export type AdminCity = {
  pwsid: string;
  shortPlace: string;
  placeName: string;
  kind: string;
  listUrl: string | null;
  enabled: boolean;
  lastRunAt: string | null;
  lastOkAt: string | null;
  consecutiveFailures: number;
  lastError: string | null;
  advisories: AdminAdvisory[];
  subscribers: AdminSubscriber[];
};

type ToastState = { message: string; icon: IconName } | null;

const EMPTY_FORM = {
  name: "",
  email: "",
  address_line1: "",
  address_line2: "",
  city: "",
  state: "",
  postal_code: "",
};

export function WaterAdvisoryAdmin({
  cities,
  loadError,
  notifyEnabled,
  emailConfigured,
  alertEmailConfigured,
}: {
  cities: AdminCity[];
  loadError: string | null;
  notifyEnabled: boolean;
  emailConfigured: boolean;
  alertEmailConfigured: boolean;
}) {
  const router = useRouter();
  const [selectedPwsid, setSelectedPwsid] = useState<string | null>(
    cities[0]?.pwsid ?? null,
  );
  const [toast, setToast] = useState<ToastState>(null);
  const [isPending, startTransition] = useTransition();

  const city = cities.find((c) => c.pwsid === selectedPwsid) ?? cities[0] ?? null;

  function notify(message: string, icon: IconName = "circle-check") {
    setToast(null);
    // Defer so a back-to-back message restarts the toast's timer.
    queueMicrotask(() => setToast({ message, icon }));
  }

  return (
    <div className="flex flex-col gap-8">
      <header>
        <div className="eyebrow mb-1">Admin · Water quality</div>
        <h1 className="h1">Water advisories</h1>
        <p
          className="text-small mt-2 max-w-2xl"
          style={{ color: "var(--color-text-secondary)" }}
        >
          Hearth checks each city&rsquo;s official advisory page every 30 minutes
          and emails the people below when a boil water advisory that affects
          customers across the water system is issued, updated, or lifted.
        </p>
      </header>

      {loadError ? (
        <div
          className="surface p-4 text-small"
          style={{ borderColor: "var(--color-danger)", color: "var(--color-text-primary)" }}
        >
          <span style={{ color: "var(--color-danger)" }}>Couldn&rsquo;t load part of this page:</span>{" "}
          {loadError}
        </div>
      ) : null}

      {cities.length > 1 ? (
        <div className="flex flex-wrap gap-2" role="tablist" aria-label="Cities">
          {cities.map((c) => {
            const active = c.pwsid === city?.pwsid;
            return (
              <button
                key={c.pwsid}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setSelectedPwsid(c.pwsid)}
                className="chip"
                style={
                  active
                    ? {
                        color: "var(--color-text-primary)",
                        borderColor: "var(--color-accent)",
                        backgroundColor:
                          "color-mix(in oklab, var(--color-accent) 14%, var(--color-bg-surface-raised))",
                      }
                    : undefined
                }
              >
                {c.shortPlace}
              </button>
            );
          })}
        </div>
      ) : null}

      {!city ? (
        <div className="surface p-4 text-small" style={{ color: "var(--color-text-tertiary)" }}>
          No cities are on the watch list yet. Sources are seeded by migration today;
          admin-added cities arrive with the discovery flow.
        </div>
      ) : (
        <>
          <WatcherPanel
            city={city}
            notifyEnabled={notifyEnabled}
            emailConfigured={emailConfigured}
            alertEmailConfigured={alertEmailConfigured}
            busy={isPending}
            onSendTest={() =>
              startTransition(async () => {
                const res = await sendTestEmailAction(city.pwsid);
                if (res.ok) notify(`Test email sent to ${res.to}.`, "sparkles");
                else notify(res.error, "alert-triangle");
              })
            }
          />

          <AdvisoriesPanel city={city} />

          <SubscribersPanel
            city={city}
            emailConfigured={emailConfigured}
            busy={isPending}
            onRemove={(id) =>
              startTransition(async () => {
                const res = await removeSubscriberAction(id);
                if (res.ok) {
                  notify("Subscriber removed.");
                  router.refresh();
                } else notify(res.error, "alert-triangle");
              })
            }
            onResend={(id) =>
              startTransition(async () => {
                const res = await resendConfirmationAction(id);
                if (res.ok) notify("Confirmation email re-sent.", "sparkles");
                else notify(res.error, "alert-triangle");
              })
            }
            onAdd={(form, done) =>
              startTransition(async () => {
                const res = await addSubscriberAction({ pwsid: city.pwsid, ...form });
                if (res.ok) {
                  notify(res.warning ?? "Added — confirmation email sent.", res.warning ? "alert-triangle" : "sparkles");
                  done();
                  router.refresh();
                } else notify(res.error, "alert-triangle");
              })
            }
          />
        </>
      )}

      {toast ? (
        <Toast message={toast.message} icon={toast.icon} onClose={() => setToast(null)} />
      ) : null}
    </div>
  );
}

// --------------------------------------------------------------------------
// Watcher panel
// --------------------------------------------------------------------------

function WatcherPanel({
  city,
  notifyEnabled,
  emailConfigured,
  alertEmailConfigured,
  busy,
  onSendTest,
}: {
  city: AdminCity;
  notifyEnabled: boolean;
  emailConfigured: boolean;
  alertEmailConfigured: boolean;
  busy: boolean;
  onSendTest: () => void;
}) {
  const latest = city.advisories[0] ?? null;
  const healthy = city.consecutiveFailures === 0;

  return (
    <section>
      <SectionHeader
        eyebrow="The watcher"
        title={city.placeName}
        trailing={
          <Pill tone={notifyEnabled ? "success" : "warning"}>
            {notifyEnabled ? "Live" : "Dry run"}
          </Pill>
        }
      />
      <div className="surface p-4 sm:p-5 flex flex-col gap-4">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <Fact label="Sending">
            {notifyEnabled
              ? "Subscribers are emailed on district-wide events."
              : "Recording only — planned sends are logged, nobody is emailed."}
            {!emailConfigured ? (
              <span className="block mt-1" style={{ color: "var(--color-warning)" }}>
                Email isn&rsquo;t configured on this deployment.
              </span>
            ) : null}
            {!alertEmailConfigured ? (
              <span className="block mt-1" style={{ color: "var(--color-warning)" }}>
                No alarm address set — a blind watcher won&rsquo;t email anyone.
              </span>
            ) : null}
          </Fact>
          <Fact label="Last check">
            {city.lastRunAt ? <When iso={city.lastRunAt} /> : "Hasn't run yet."}
            <span
              className="block mt-1"
              style={{ color: healthy ? "var(--color-success)" : "var(--color-danger)" }}
            >
              {healthy
                ? "Reading the city page normally."
                : `${city.consecutiveFailures} failure${city.consecutiveFailures === 1 ? "" : "s"} in a row.`}
            </span>
            {!healthy && city.lastError ? (
              <span
                className="block mt-1 font-mono text-[12px] break-words"
                style={{ color: "var(--color-text-tertiary)" }}
              >
                {city.lastError}
              </span>
            ) : null}
          </Fact>
          <Fact label="Latest advisory">
            {latest ? (
              <>
                <span className="block">{latest.title}</span>
                <span className="flex flex-wrap gap-1.5 mt-2">
                  <StatusPill status={latest.status} />
                  <ScopePill scope={latest.scope} />
                </span>
              </>
            ) : (
              "Nothing recorded yet — the first run seeds the list silently."
            )}
          </Fact>
        </div>

        <div className="flex flex-wrap items-center gap-2 pt-1">
          <button
            type="button"
            className="btn btn-ghost"
            onClick={onSendTest}
            disabled={busy || !emailConfigured}
          >
            <Icon name="sparkles" size={16} />
            Send test email to me
          </button>
          {city.listUrl ? (
            <a
              href={city.listUrl}
              target="_blank"
              rel="noreferrer"
              className="btn btn-ghost"
            >
              <Icon name="external-link" size={16} />
              City page
            </a>
          ) : null}
        </div>
      </div>
    </section>
  );
}

// --------------------------------------------------------------------------
// Advisories panel
// --------------------------------------------------------------------------

function AdvisoriesPanel({ city }: { city: AdminCity }) {
  const rows = city.advisories.slice(0, 8);
  return (
    <section>
      <SectionHeader
        eyebrow="Recorded from the city page"
        title="Recent advisories"
        trailing={
          city.advisories.length > 0 ? (
            <span className="text-small" style={{ color: "var(--color-text-tertiary)" }}>
              {city.advisories.length}
            </span>
          ) : null
        }
      />
      {rows.length === 0 ? (
        <div className="surface p-4 text-small" style={{ color: "var(--color-text-tertiary)" }}>
          No advisories recorded yet.
        </div>
      ) : (
        <div className="surface divide-y" style={{ borderColor: "var(--color-border-subtle)" }}>
          {rows.map((a) => (
            <div key={a.id} className="p-4 flex flex-col gap-1.5" style={{ borderColor: "inherit" }}>
              <div className="flex items-start gap-3">
                <div className="min-w-0 flex-1">
                  <a
                    href={a.sourceUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="block"
                    style={{ fontWeight: 500, color: "var(--color-text-primary)" }}
                  >
                    {a.title}
                  </a>
                  {a.summary ? (
                    <p
                      className="text-small mt-1"
                      style={{ color: "var(--color-text-secondary)" }}
                    >
                      {a.summary}
                    </p>
                  ) : null}
                </div>
                <Icon
                  name="external-link"
                  size={14}
                  style={{ color: "var(--color-text-tertiary)", flexShrink: 0, marginTop: 4 }}
                />
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                <StatusPill status={a.status} />
                <ScopePill scope={a.scope} />
                {a.onEmergencyBanner ? (
                  <Tooltip content="The city carried this on its site-wide emergency banner.">
                    <span className="chip" style={{ color: "var(--color-accent)" }}>
                      Banner
                    </span>
                  </Tooltip>
                ) : null}
                <span className="text-small" style={{ color: "var(--color-text-tertiary)" }}>
                  {a.publishedOn ? `Published ${formatDate(a.publishedOn)}` : "No published date"} ·
                  first seen <When iso={a.firstSeenAt} />
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

// --------------------------------------------------------------------------
// Subscribers panel
// --------------------------------------------------------------------------

function SubscribersPanel({
  city,
  emailConfigured,
  busy,
  onRemove,
  onResend,
  onAdd,
}: {
  city: AdminCity;
  emailConfigured: boolean;
  busy: boolean;
  onRemove: (id: string) => void;
  onResend: (id: string) => void;
  onAdd: (form: typeof EMPTY_FORM, done: () => void) => void;
}) {
  const [form, setForm] = useState(EMPTY_FORM);
  const [confirmRemoveId, setConfirmRemoveId] = useState<string | null>(null);
  const confirmed = city.subscribers.filter((s) => s.status === "confirmed").length;

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    onAdd(form, () => setForm(EMPTY_FORM));
  }

  function field(key: keyof typeof EMPTY_FORM) {
    return {
      value: form[key],
      onChange: (e: React.ChangeEvent<HTMLInputElement>) =>
        setForm((f) => ({ ...f, [key]: e.target.value })),
    };
  }

  return (
    <section className="flex flex-col gap-4">
      <SectionHeader
        eyebrow="Who gets emailed"
        title="Subscribers"
        trailing={
          city.subscribers.length > 0 ? (
            <span className="text-small" style={{ color: "var(--color-text-tertiary)" }}>
              {confirmed} confirmed · {city.subscribers.length} total
            </span>
          ) : null
        }
      />

      {city.subscribers.length === 0 ? (
        <div className="surface p-4 text-small" style={{ color: "var(--color-text-tertiary)" }}>
          Nobody yet. Add yourself first, confirm from the email, then use
          &ldquo;Send test email to me&rdquo; above.
        </div>
      ) : (
        <div className="surface divide-y" style={{ borderColor: "var(--color-border-subtle)" }}>
          {city.subscribers.map((s) => (
            <div
              key={s.id}
              className="p-4 flex flex-col sm:flex-row sm:items-center gap-3"
              style={{ borderColor: "inherit" }}
            >
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span style={{ fontWeight: 500 }}>{s.name}</span>
                  <SubscriberPill status={s.status} />
                </div>
                <div className="text-small truncate" style={{ color: "var(--color-text-secondary)" }}>
                  {s.email}
                </div>
                {s.address ? (
                  <div className="text-small" style={{ color: "var(--color-text-tertiary)" }}>
                    {s.address}
                  </div>
                ) : null}
                <div className="text-small" style={{ color: "var(--color-text-tertiary)" }}>
                  Added by {s.addedBy} · <When iso={s.createdAt} />
                  {s.confirmedAt ? (
                    <>
                      {" "}· confirmed <When iso={s.confirmedAt} />
                    </>
                  ) : null}
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2 sm:justify-end">
                {s.status === "pending" ? (
                  <button
                    type="button"
                    className="btn btn-ghost"
                    onClick={() => onResend(s.id)}
                    disabled={busy || !emailConfigured}
                  >
                    <Icon name="refresh-cw" size={14} />
                    Resend confirmation
                  </button>
                ) : null}
                {s.status !== "unsubscribed" ? (
                  confirmRemoveId === s.id ? (
                    <>
                      <button
                        type="button"
                        className="btn btn-ghost"
                        style={{ color: "var(--color-danger)", borderColor: "var(--color-danger)" }}
                        onClick={() => {
                          setConfirmRemoveId(null);
                          onRemove(s.id);
                        }}
                        disabled={busy}
                      >
                        Yes, remove
                      </button>
                      <button
                        type="button"
                        className="btn btn-ghost"
                        onClick={() => setConfirmRemoveId(null)}
                        disabled={busy}
                      >
                        Keep
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      className="btn btn-ghost"
                      onClick={() => setConfirmRemoveId(s.id)}
                      disabled={busy}
                    >
                      <Icon name="trash" size={14} />
                      Remove
                    </button>
                  )
                ) : null}
              </div>
            </div>
          ))}
        </div>
      )}

      <form onSubmit={submit} className="surface p-4 sm:p-5 flex flex-col gap-4">
        <div>
          <div className="eyebrow mb-1">Add someone</div>
          <p className="text-small" style={{ color: "var(--color-text-secondary)" }}>
            They get a confirmation email first. Nothing is sent to them until they
            click it. Address is optional and only stored for now.
          </p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="label" htmlFor="sub-name">Name</label>
            <input id="sub-name" className="input" required autoComplete="off" {...field("name")} />
          </div>
          <div>
            <label className="label" htmlFor="sub-email">Email</label>
            <input
              id="sub-email"
              className="input"
              type="email"
              required
              inputMode="email"
              autoComplete="off"
              {...field("email")}
            />
          </div>
          <div className="sm:col-span-2">
            <label className="label" htmlFor="sub-addr1">Address</label>
            <input id="sub-addr1" className="input" placeholder="Street address" {...field("address_line1")} />
          </div>
          <div className="sm:col-span-2">
            <input
              className="input"
              aria-label="Address line 2"
              placeholder="Apt, unit, etc. (optional)"
              {...field("address_line2")}
            />
          </div>
          <div>
            <label className="label" htmlFor="sub-city">City</label>
            <input id="sub-city" className="input" {...field("city")} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label" htmlFor="sub-state">State</label>
              <input id="sub-state" className="input" maxLength={2} placeholder="MI" {...field("state")} />
            </div>
            <div>
              <label className="label" htmlFor="sub-zip">ZIP</label>
              <input id="sub-zip" className="input" inputMode="numeric" {...field("postal_code")} />
            </div>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <button type="submit" className="btn btn-primary" disabled={busy}>
            <Icon name="plus" size={16} />
            Add and send confirmation
          </button>
          <span className="text-small" style={{ color: "var(--color-text-tertiary)" }}>
            to the {city.shortPlace} list
          </span>
        </div>
      </form>
    </section>
  );
}

// --------------------------------------------------------------------------
// Small pieces
// --------------------------------------------------------------------------

type Tone = "success" | "warning" | "info" | "danger" | "accent" | "neutral";

const TONE_COLOR: Record<Tone, string> = {
  success: "var(--color-success)",
  warning: "var(--color-warning)",
  info: "var(--color-info)",
  danger: "var(--color-danger)",
  accent: "var(--color-accent)",
  neutral: "var(--color-text-tertiary)",
};

function Pill({ tone, children }: { tone: Tone; children: React.ReactNode }) {
  return (
    <span
      className="chip"
      style={{
        color: TONE_COLOR[tone],
        borderColor: `color-mix(in oklab, ${TONE_COLOR[tone]} 40%, transparent)`,
      }}
    >
      {children}
    </span>
  );
}

const STATUS_META: Record<AdvisoryStatus, { label: string; tone: Tone; help: string }> = {
  active: { label: "Active", tone: "warning", help: "The city says this advisory is in effect." },
  scheduled: { label: "Scheduled", tone: "info", help: "A precautionary advisory the city has announced for planned work." },
  lifted: { label: "Lifted", tone: "success", help: "The city has lifted this advisory." },
  unknown: { label: "Status unknown", tone: "neutral", help: "Hearth couldn't read a status from the title. Treated as active." },
};

const SCOPE_META: Record<AdvisoryScope, { label: string; tone: Tone; help: string }> = {
  system_wide: {
    label: "District-wide",
    tone: "accent",
    help: "Affects customers across the water system. Subscribers are emailed.",
  },
  localized: {
    label: "Localized",
    tone: "neutral",
    help: "A listed set of streets or addresses. Recorded here but not emailed — notifications are district-wide only for now.",
  },
  unknown: {
    label: "Scope unknown",
    tone: "neutral",
    help: "Hearth couldn't tell how wide this is. Treated as district-wide so nobody misses a city-wide advisory.",
  },
};

function StatusPill({ status }: { status: AdvisoryStatus }) {
  const m = STATUS_META[status];
  return (
    <Tooltip content={m.help}>
      <Pill tone={m.tone}>{m.label}</Pill>
    </Tooltip>
  );
}

function ScopePill({ scope }: { scope: AdvisoryScope }) {
  const m = SCOPE_META[scope];
  return (
    <Tooltip content={m.help}>
      <Pill tone={m.tone}>{m.label}</Pill>
    </Tooltip>
  );
}

function SubscriberPill({ status }: { status: AdminSubscriber["status"] }) {
  if (status === "confirmed") return <Pill tone="success">Confirmed</Pill>;
  if (status === "pending") {
    return (
      <Tooltip content="Added, but hasn't clicked the confirmation link yet. Not emailed until they do.">
        <Pill tone="warning">Pending</Pill>
      </Tooltip>
    );
  }
  return <Pill tone="neutral">Unsubscribed</Pill>;
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <div className="eyebrow mb-1">{label}</div>
      <div className="text-small" style={{ color: "var(--color-text-primary)" }}>
        {children}
      </div>
    </div>
  );
}

function formatDate(isoDate: string): string {
  const d = new Date(`${isoDate.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return isoDate;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}

/**
 * Local-time timestamp, formatted only after mount. The server renders in
 * UTC and React does not patch a mismatched text node on hydration (it
 * keeps the server string), so a server-side toLocaleString would leave
 * the admin reading UTC labelled as if it were local. Until the effect
 * runs the element shows an explicit-UTC string so nothing is ever
 * ambiguous.
 */
function When({ iso }: { iso: string }) {
  // true only on the client after hydration; the server snapshot is
  // false, so server and first client render agree (UTC string), then
  // the post-hydration render swaps to the browser's zone.
  const hydrated = useSyncExternalStore(
    subscribeNoop,
    () => true,
    () => false,
  );
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return <time dateTime={iso}>{iso}</time>;
  const opts: Intl.DateTimeFormatOptions = {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  };
  const text = hydrated
    ? d.toLocaleString("en-US", opts)
    : `${d.toLocaleString("en-US", { ...opts, timeZone: "UTC" })} UTC`;
  return <time dateTime={iso}>{text}</time>;
}

function subscribeNoop() {
  return () => {};
}
