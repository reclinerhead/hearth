"use client";

// Client-side wrapper that turns the presentational MaintenanceTaskRow
// into an interactive surface (issue #137). Owns the modal's open
// state and the return-focus ref so the focus trap inside
// MaintenanceTaskModal can hand focus back cleanly when closed.
//
// Mirrors HabitatFindingTrigger. Keeping the visual treatment in the
// row component and the interaction in this wrapper lets the row stay
// reusable in non-modal contexts (history lists, future reports)
// without dragging modal state along.

import { useRef, useState } from "react";
import {
  MaintenanceTaskRow,
  type MaintenanceTaskRowData,
  type RightLabelMode,
  type RowTone,
} from "./maintenance-task-row";
import { MaintenanceTaskModal } from "./maintenance-task-modal";

export function MaintenanceTaskTrigger({
  task,
  tone,
  relativeMode,
}: {
  task: MaintenanceTaskRowData;
  tone: RowTone;
  relativeMode: RightLabelMode;
}) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);

  return (
    <>
      <MaintenanceTaskRow
        ref={triggerRef}
        task={task}
        tone={tone}
        relativeMode={relativeMode}
        onClick={() => setOpen(true)}
      />
      {open ? (
        <MaintenanceTaskModal
          taskId={task.id}
          onClose={() => setOpen(false)}
          getReturnFocusElement={() => triggerRef.current}
        />
      ) : null}
    </>
  );
}
