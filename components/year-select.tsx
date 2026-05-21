"use client";

import { useEffect, useRef, useState } from "react";
import { Icon } from "./icon";

/**
 * Year selector chip used inside both DatePicker and MonthPicker
 * (issue #107). Replaces the native `<select>` whose dropdown popup
 * (a) rendered with white background regardless of the document's
 * dark scheme on older Chromium builds, (b) had no way to control
 * padding/font/popup height, and (c) showed the full ~110-year list
 * in a single skinny column that ran the full viewport height.
 *
 * The component renders a chip-styled trigger and, when open, a
 * scrollable list of years anchored below the trigger. The list
 * uses the same Hearth surface treatment as the picker popover it
 * lives inside; the selected year scrolls into view on open so
 * `2005` is visible without manual scrolling.
 *
 * Outside-click and ESC are owned here rather than in the popover
 * shell so that closing the year list does not close the calendar.
 * The handler doesn't `stopPropagation` — if the click was outside
 * the picker entirely, the popover's own overlay handler will fire
 * and close both, which is the right cascade.
 */

export function YearSelect({
  value,
  min,
  max,
  onChange,
  ariaLabel = "Year",
}: {
  value: number;
  min: number;
  max: number;
  onChange: (year: number) => void;
  ariaLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const listRef = useRef<HTMLUListElement | null>(null);
  const selectedItemRef = useRef<HTMLButtonElement | null>(null);

  // Descending so recent years sit at the top — the user is far
  // more likely to be entering a recent year than a year 80+ back.
  const years: number[] = [];
  for (let y = max; y >= min; y -= 1) years.push(y);

  useEffect(() => {
    if (!open) return;
    const id = requestAnimationFrame(() => {
      selectedItemRef.current?.scrollIntoView({
        block: "center",
        behavior: "auto",
      });
      selectedItemRef.current?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(id);
  }, [open]);

  useEffect(() => {
    if (!open) return;

    function handleDown(e: MouseEvent) {
      const target = e.target as Node | null;
      if (!target) return;
      if (listRef.current?.contains(target)) return;
      if (triggerRef.current?.contains(target)) return;
      setOpen(false);
    }

    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.stopPropagation();
        e.preventDefault();
        setOpen(false);
        triggerRef.current?.focus();
      }
    }

    document.addEventListener("mousedown", handleDown, { capture: true });
    document.addEventListener("keydown", handleKey, { capture: true });
    return () => {
      document.removeEventListener("mousedown", handleDown, { capture: true });
      document.removeEventListener("keydown", handleKey, { capture: true });
    };
  }, [open]);

  return (
    <span className="year-select-root">
      <button
        ref={triggerRef}
        type="button"
        className="year-select-trigger"
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        {value}
        <Icon name="chevron-down" size={12} />
      </button>
      {open ? (
        <ul ref={listRef} className="year-select-list" role="listbox">
          {years.map((y) => {
            const isSelected = y === value;
            return (
              <li key={y} role="option" aria-selected={isSelected}>
                <button
                  ref={isSelected ? selectedItemRef : null}
                  type="button"
                  className="year-select-item"
                  data-selected={isSelected ? "true" : "false"}
                  onClick={() => {
                    onChange(y);
                    setOpen(false);
                  }}
                >
                  {y}
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}
    </span>
  );
}
