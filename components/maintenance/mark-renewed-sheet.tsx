"use client";

// Mark-renewed completion sheet (issue #137). Used for renewal-kind
// tasks. The cadence is open-ended from the user's perspective — a
// vehicle registration might be renewed for 1 year or 2 years, an
// insurance policy might be 6 or 12 months — so the sheet surfaces
// the term cards from renewal_options and lets the user pick.
//
// Term cards show the projected expiration inline ("12 months · May
// 24, 2027") so the user sees the consequence of their choice before
// they confirm.
//
// An "Enter a different date instead" escape hatch is always available
// when term cards exist, for the case where the user knows the actual
// expiration date doesn't match any offered term (Michigan registrations
// expire on the registrant's birthday, not a clean N months out).

import { useState } from "react";
import { completeTaskAction } from "@/app/actions/maintenance/complete-task";
import { DatePicker } from "@/components/date-picker";
import { Icon } from "@/components/icon";
import type { RenewalTermOption } from "@/lib/maintenance/renewal-terms";
import { MaintenanceModalShell } from "./maintenance-modal-shell";

export type MarkRenewedSheetTask = {
  id: string;
  title: string;
  subtitle: string | null;
  /**
   * Renewal-term cards persisted on the task. Empty / null means we
   * have no per-issuer term knowledge and fall back to a bare date
   * picker.
   */
  renewal_options: RenewalTermOption[] | null;
};

export function MarkRenewedSheet({
  task,
  onSaved,
  onCancel,
}: {
  task: MarkRenewedSheetTask;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const renewalOptions = task.renewal_options ?? [];
  const isMichiganRegistration =
    task.title === "Vehicle registration renewal" &&
    task.subtitle?.includes("Michigan SOS");

  const today = todayIso();
  const [renewedOn, setRenewedOn] = useState(today);
  // Pre-select the longest available term — matches the cadence_kind
  // default that the direct-event pipeline writes (longest term ==
  // most common renewal). Means the most common case is one-tap.
  const [selectedTerm, setSelectedTerm] = useState<number | null>(
    longestTerm(renewalOptions),
  );
  const [customDate, setCustomDate] = useState<string>("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const usingCustomDate = selectedTerm === null;
  const newExpiration = usingCustomDate
    ? customDate || null
    : selectedTerm !== null
      ? projectExpiration(renewedOn, selectedTerm)
      : null;

  async function handleSave() {
    if (!newExpiration) {
      setError("Pick a renewal term or enter an expiration date.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const result = await completeTaskAction({
        taskId: task.id,
        completedOn: renewedOn,
        newExpiration,
        notes: notes.trim() || null,
      });
      if (result.ok) {
        onSaved();
      } else {
        setError(result.error);
      }
    } catch (err) {
      console.error("[mark-renewed] save failed", err);
      setError("Something went wrong saving. Try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <MaintenanceModalShell
      title="Mark renewed"
      eyebrow={task.title}
      onClose={() => {
        if (!saving) onCancel();
      }}
      closable={!saving}
    >
      <div className="flex flex-col gap-4">
        <DatePicker
          label="When was it renewed?"
          value={renewedOn}
          onChange={(v) => setRenewedOn(v || today)}
        />

        <div>
          <label className="label">New expiration date</label>
          {renewalOptions.length > 0 ? (
            <div className="flex flex-col gap-2">
              <div className="grid grid-cols-2 gap-2">
                {renewalOptions.map((opt) => {
                  const projected = projectExpiration(
                    renewedOn,
                    opt.interval_months,
                  );
                  const isSelected =
                    !usingCustomDate && selectedTerm === opt.interval_months;
                  return (
                    <button
                      type="button"
                      key={opt.interval_months}
                      onClick={() => {
                        setSelectedTerm(opt.interval_months);
                        setCustomDate("");
                      }}
                      className="p-3 text-left transition-colors"
                      style={{
                        borderRadius: "var(--radius-md)",
                        backgroundColor: isSelected
                          ? "color-mix(in oklab, var(--color-accent) 14%, var(--color-bg-surface))"
                          : "var(--color-bg-surface)",
                        border: isSelected
                          ? "1px solid var(--color-accent)"
                          : "1px solid var(--color-border-subtle)",
                      }}
                    >
                      <div style={{ fontWeight: 500 }}>{opt.label}</div>
                      <div
                        className="text-small"
                        style={{
                          color: "var(--color-text-tertiary)",
                          marginTop: 2,
                        }}
                      >
                        {formatLongDate(projected)}
                      </div>
                    </button>
                  );
                })}
              </div>
              <button
                type="button"
                onClick={() => {
                  setSelectedTerm(null);
                  setCustomDate((v) => v || "");
                }}
                className="text-small text-left"
                style={{
                  color: "var(--color-text-secondary)",
                  textDecoration: "underline",
                  alignSelf: "flex-start",
                  paddingTop: 2,
                }}
              >
                Enter a different date instead
              </button>
              {usingCustomDate ? (
                <div style={{ marginTop: 4 }}>
                  <DatePicker
                    label="Expiration date"
                    value={customDate}
                    onChange={setCustomDate}
                    placeholder="Pick an expiration date"
                  />
                </div>
              ) : null}
            </div>
          ) : (
            <DatePicker
              label="Expiration date"
              value={customDate}
              onChange={(v) => {
                setCustomDate(v);
                setSelectedTerm(null);
              }}
              placeholder="Pick an expiration date"
            />
          )}
        </div>

        {isMichiganRegistration ? (
          <div
            className="text-small flex items-start gap-2 p-3"
            style={{
              backgroundColor:
                "color-mix(in oklab, var(--color-warning) 10%, transparent)",
              border:
                "1px solid color-mix(in oklab, var(--color-warning) 22%, transparent)",
              borderRadius: "var(--radius-md)",
            }}
          >
            <Icon
              name="info"
              size={14}
              style={{
                color: "var(--color-warning)",
                marginTop: 2,
                flexShrink: 0,
              }}
            />
            <span style={{ color: "var(--color-text-secondary)" }}>
              Michigan registrations expire on the registrant&apos;s birthday,
              not exactly N years from today. If you know the exact expiration
              date, enter it above. Or upload the new registration when it
              arrives and Hearth will set the date automatically.
            </span>
          </div>
        ) : null}

        <div>
          <label htmlFor="mark-renewed-notes" className="label">
            Notes (optional)
          </label>
          <textarea
            id="mark-renewed-notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            className="input"
            rows={2}
            placeholder="Anything worth remembering about this renewal"
          />
        </div>

        {error ? (
          <div
            className="text-small"
            role="alert"
            style={{ color: "var(--color-danger)" }}
          >
            {error}
          </div>
        ) : null}

        <div className="flex gap-2 justify-end">
          <button
            type="button"
            className="btn btn-ghost"
            onClick={onCancel}
            disabled={saving}
          >
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={handleSave}
            disabled={saving || !newExpiration}
          >
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </MaintenanceModalShell>
  );
}

function todayIso(): string {
  const d = new Date();
  const y = d.getFullYear().toString().padStart(4, "0");
  const m = (d.getMonth() + 1).toString().padStart(2, "0");
  const day = d.getDate().toString().padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function longestTerm(options: RenewalTermOption[]): number | null {
  if (options.length === 0) return null;
  return Math.max(...options.map((o) => o.interval_months));
}

function projectExpiration(renewedOn: string, intervalMonths: number): string {
  const parts = renewedOn.split("-").map((s) => Number.parseInt(s, 10));
  if (parts.length !== 3 || parts.some((n) => !Number.isFinite(n))) {
    return renewedOn;
  }
  const [y, m, d] = parts;
  const next = new Date(Date.UTC(y, m - 1 + intervalMonths, d));
  return next.toISOString().slice(0, 10);
}

function formatLongDate(iso: string): string {
  const parts = iso.split("-").map((s) => Number.parseInt(s, 10));
  if (parts.length !== 3 || parts.some((n) => !Number.isFinite(n))) return iso;
  const [y, m, d] = parts;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}
