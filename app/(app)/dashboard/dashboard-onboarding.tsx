"use client";

import { useState, type ReactNode } from "react";
import type { House } from "@/types/house";
import { DashboardLive } from "./dashboard-live";
import type { Milestone } from "./onboarding-milestones";
import { OnboardingMilestonesPanel } from "./onboarding-milestones-panel";

/**
 * Thin client coordinator for the dashboard's onboarding surfaces (issue
 * #220). It renders the milestones panel and `DashboardLive` as siblings and
 * holds the two pieces of state they need to share:
 *
 *   - **Edit-modal open** — the go-deeper panel's "house facts" card (in the
 *     milestones panel) opens the home-details edit modal that `DashboardLive`
 *     owns. We lift only the open boolean; the modal itself stays in
 *     `DashboardLive`.
 *   - **Go-deeper reopen** — the `?` trigger lives in `DashboardLive`'s address
 *     row, but the go-deeper panel is rendered by the milestones panel, so the
 *     "reopen" flag is routed up here and back down.
 *
 * `page.tsx` is a server component, so this is the nearest common ancestor
 * that can own that client state. Returns a fragment so both children stay
 * direct flex children of the dashboard column (preserving the gap layout).
 */
export function DashboardOnboarding({
  houseId,
  milestones,
  initialHouse,
  lifecycleOutlookSlot,
}: {
  houseId: string;
  milestones: Milestone[];
  initialHouse: House;
  lifecycleOutlookSlot?: ReactNode;
}) {
  const [editOpen, setEditOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);

  return (
    <>
      <OnboardingMilestonesPanel
        houseId={houseId}
        milestones={milestones}
        reopened={helpOpen}
        onCloseReopen={() => setHelpOpen(false)}
        onOpenHomeDetails={() => setEditOpen(true)}
      />
      <DashboardLive
        houseId={houseId}
        initialHouse={initialHouse}
        lifecycleOutlookSlot={lifecycleOutlookSlot}
        editOpen={editOpen}
        onEditOpenChange={setEditOpen}
        onOpenHelp={() => setHelpOpen(true)}
      />
    </>
  );
}
