"use client";

import { type ReactNode, useCallback, useRef, useState } from "react";
import { HabitatFindingModal } from "./habitat-finding-modal";
import type { HabitatModule } from "@/lib/habitat/types";
import type { HabitatFindingRow } from "@/lib/hooks/use-habitat-findings";

/**
 * Wraps a presentational tile in a real <button> that opens the
 * detail modal for its finding. The wrapper owns the open state and
 * the return-focus ref so the modal's mechanics (focus trap, ESC,
 * return focus) plug in cleanly. The visual treatment (surface-ai,
 * hover border) sits on the trigger button's className so the focus
 * ring wraps the whole card via the existing .btn:focus-visible
 * pattern in globals.css.
 */
export function HabitatFindingTrigger({
  row,
  habitatModule,
  houseId,
  children,
  className,
  title,
  onFirstOpen,
}: {
  row: HabitatFindingRow;
  habitatModule: HabitatModule;
  /**
   * Threaded through to the modal's `renderOverviewBody` context so
   * modules can spawn house-scoped affordances (e.g. WQA's CCR
   * upload). Required.
   */
  houseId: string;
  children: ReactNode;
  className?: string;
  title?: string;
  /**
   * Fired once, the first time this trigger opens its modal. The
   * dashboard preview uses it to stamp the "review your habitat findings"
   * onboarding milestone (issue #216) — opening any finding counts as
   * having seen them. Kept as an opt-in callback so this generic trigger
   * stays decoupled from the onboarding action; fire-and-forget, the open
   * doesn't wait on it.
   */
  onFirstOpen?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const hasFiredFirstOpen = useRef(false);

  const close = useCallback(() => setOpen(false), []);
  const getReturnFocus = useCallback(() => triggerRef.current, []);

  const handleOpen = useCallback(() => {
    setOpen(true);
    if (!hasFiredFirstOpen.current) {
      hasFiredFirstOpen.current = true;
      onFirstOpen?.();
    }
  }, [onFirstOpen]);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={handleOpen}
        className={className}
        aria-haspopup="dialog"
        title={title}
      >
        {children}
      </button>
      <HabitatFindingModal
        open={open}
        onClose={close}
        row={row}
        habitatModule={habitatModule}
        houseId={houseId}
        getReturnFocusElement={getReturnFocus}
      />
    </>
  );
}
