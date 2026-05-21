"use client";

import { useId, useRef, useState } from "react";
import { Icon } from "./icon";
import { PickerPopover } from "./picker-popover";

/**
 * Hearth's custom month picker (issue #107). Replaces the native
 * `<input type="month">` previously used for the inventory edit
 * modal's "Manufactured" field (issue #105).
 *
 * Wire-format compatibility — `value` and `onChange` speak the same
 * `YYYY-MM` strings the native input did, so the six-column
 * manufacture-date write contract on the server side stays unchanged.
 *
 * Lenient prefill: accepts `YYYY-MM` exact, `YYYY` (treated as
 * `YYYY-01`), and falls through any other format (e.g. ISO week
 * `YYYY-Www`) as no selection.
 *
 * The popup is a year header plus a 4x3 month grid — small enough
 * that pulling in a date-grid library would be a net loss in
 * surface area and styling control.
 */

const MONTH_LABELS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

type MonthValue = { year: number; month: number };

function parseValue(value: string): MonthValue | null {
  if (!value) return null;
  const trimmed = value.trim();
  const ym = /^(\d{4})-(\d{2})$/.exec(trimmed);
  if (ym) {
    const year = Number.parseInt(ym[1], 10);
    const month = Number.parseInt(ym[2], 10);
    if (month >= 1 && month <= 12) return { year, month };
    return null;
  }
  const yearOnly = /^(\d{4})$/.exec(trimmed);
  if (yearOnly) {
    const year = Number.parseInt(yearOnly[1], 10);
    return { year, month: 1 };
  }
  return null;
}

function formatValue(v: MonthValue): string {
  return `${v.year.toString().padStart(4, "0")}-${v.month.toString().padStart(2, "0")}`;
}

function formatDisplay(value: string): string {
  const parsed = parseValue(value);
  if (!parsed) return "";
  return `${MONTH_LABELS[parsed.month - 1]} ${parsed.year}`;
}

export function MonthPicker({
  label,
  value,
  onChange,
  placeholder = "Pick a month",
}: {
  label: string;
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
}) {
  const labelId = useId();
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const [open, setOpen] = useState(false);

  const selected = parseValue(value);
  const display = formatDisplay(value);
  const isEmpty = display === "";

  // Year shown in the popup header. Initialized to the selected year
  // or the current year if no value is set. Reset on each open so
  // browsing prior years on one open doesn't bleed into the next.
  const today = new Date();
  const todayValue: MonthValue = {
    year: today.getFullYear(),
    month: today.getMonth() + 1,
  };
  const [headerYear, setHeaderYear] = useState(
    selected?.year ?? todayValue.year,
  );

  function handleOpen() {
    if (!open) {
      setHeaderYear(selected?.year ?? todayValue.year);
    }
    setOpen((v) => !v);
  }

  function pick(month: number) {
    onChange(formatValue({ year: headerYear, month }));
    setOpen(false);
  }

  return (
    <div>
      <label id={labelId} className="label">
        {label}
      </label>
      <button
        ref={triggerRef}
        type="button"
        onClick={handleOpen}
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
        <div className="month-picker">
          <div className="month-picker-header">
            <button
              type="button"
              className="month-picker-nav"
              aria-label="Previous year"
              onClick={() => setHeaderYear((y) => y - 1)}
            >
              <Icon name="chevron-left" size={16} />
            </button>
            <span className="month-picker-year">{headerYear}</span>
            <button
              type="button"
              className="month-picker-nav"
              aria-label="Next year"
              onClick={() => setHeaderYear((y) => y + 1)}
            >
              <Icon name="chevron-right" size={16} />
            </button>
          </div>
          <div className="month-picker-grid">
            {MONTH_LABELS.map((label, idx) => {
              const month = idx + 1;
              const isSelected =
                selected?.year === headerYear && selected.month === month;
              const isToday =
                todayValue.year === headerYear && todayValue.month === month;
              return (
                <button
                  key={month}
                  type="button"
                  onClick={() => pick(month)}
                  className="month-picker-cell"
                  data-selected={isSelected ? "true" : "false"}
                  data-today={isToday ? "true" : "false"}
                  aria-pressed={isSelected}
                >
                  {label}
                </button>
              );
            })}
          </div>
        </div>
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
              onChange(formatValue(todayValue));
              setOpen(false);
            }}
          >
            This month
          </button>
        </div>
      </PickerPopover>
    </div>
  );
}
