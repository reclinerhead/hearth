"use client";

import { useId, useRef, useState } from "react";
import { DayPicker } from "react-day-picker";
import { Icon } from "./icon";
import { PickerPopover } from "./picker-popover";

/**
 * Hearth's custom date picker (issue #107). Replaces native
 * `<input type="date">` in the edit modals.
 *
 * Renders a `.input`-styled button trigger that shows the formatted
 * date (or the placeholder when empty) plus a calendar icon. Clicking
 * the trigger opens a `<PickerPopover>` containing a themed
 * `react-day-picker` instance. Selecting a day commits the value and
 * closes the popover; the "Clear" footer button writes `""` and
 * closes.
 *
 * Wire-format compatibility — the component's `value` and `onChange`
 * speak the same `YYYY-MM-DD` strings the previous native input did,
 * so server actions and prefill helpers don't change.
 *
 * Local-time conversion matters here: `new Date("2025-10-24")` parses
 * as UTC midnight and the formatted display can flip back a day in
 * negative-UTC time zones. We convert explicitly via local Y/M/D
 * accessors to keep the user's perceived date stable.
 */

function dateFromIso(iso: string): Date | undefined {
  if (!iso) return undefined;
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!match) return undefined;
  const year = Number.parseInt(match[1], 10);
  const month = Number.parseInt(match[2], 10) - 1;
  const day = Number.parseInt(match[3], 10);
  if (
    !Number.isFinite(year) ||
    !Number.isFinite(month) ||
    !Number.isFinite(day)
  ) {
    return undefined;
  }
  return new Date(year, month, day);
}

function isoFromDate(d: Date): string {
  const y = d.getFullYear().toString().padStart(4, "0");
  const m = (d.getMonth() + 1).toString().padStart(2, "0");
  const day = d.getDate().toString().padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function formatDisplay(iso: string): string {
  const d = dateFromIso(iso);
  if (!d) return "";
  return d.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export function DatePicker({
  label,
  value,
  onChange,
  placeholder = "Pick a date",
}: {
  label: string;
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
}) {
  const labelId = useId();
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const [open, setOpen] = useState(false);

  const selected = dateFromIso(value);
  const display = formatDisplay(value);
  const isEmpty = display === "";

  // Bounded month + year dropdowns so the user can jump to a far-back
  // year without click-stepping the chevrons month-by-month. 100 years
  // back covers older homes' purchase dates and the oldest realistic
  // install dates; 10 years forward covers next-service-due dates with
  // generous headroom. defaultMonth (today) falls inside this range.
  const today = new Date();
  const startMonth = new Date(today.getFullYear() - 100, 0, 1);
  const endMonth = new Date(today.getFullYear() + 10, 11, 31);

  return (
    <div>
      <label id={labelId} className="label">
        {label}
      </label>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-labelledby={labelId}
        aria-haspopup="dialog"
        aria-expanded={open}
        className="input picker-trigger"
      >
        <span
          className="picker-trigger-value"
          style={{
            color: isEmpty
              ? "var(--color-text-tertiary)"
              : "var(--color-text-primary)",
          }}
        >
          {isEmpty ? placeholder : display}
        </span>
        <span
          aria-hidden
          className="picker-trigger-icon"
          style={{ color: "var(--color-text-secondary)" }}
        >
          <Icon name="calendar" size={16} />
        </span>
      </button>
      <PickerPopover
        open={open}
        anchor={triggerRef.current}
        label={`${label} picker`}
        onClose={() => setOpen(false)}
      >
        <DayPicker
          mode="single"
          captionLayout="dropdown"
          startMonth={startMonth}
          endMonth={endMonth}
          selected={selected}
          defaultMonth={selected ?? new Date()}
          onSelect={(d) => {
            if (d) {
              onChange(isoFromDate(d));
              setOpen(false);
            }
          }}
          autoFocus
        />
        <div className="picker-popover-footer">
          <button
            type="button"
            className="picker-popover-link"
            onClick={() => {
              onChange("");
              setOpen(false);
            }}
          >
            Clear
          </button>
          <button
            type="button"
            className="picker-popover-link"
            onClick={() => {
              onChange(isoFromDate(new Date()));
              setOpen(false);
            }}
          >
            Today
          </button>
        </div>
      </PickerPopover>
    </div>
  );
}
