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
  children,
  className,
  title,
}: {
  row: HabitatFindingRow;
  habitatModule: HabitatModule;
  children: ReactNode;
  className?: string;
  title?: string;
}) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);

  const close = useCallback(() => setOpen(false), []);
  const getReturnFocus = useCallback(() => triggerRef.current, []);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen(true)}
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
        getReturnFocusElement={getReturnFocus}
      />
    </>
  );
}
