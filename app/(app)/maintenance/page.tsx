import type { Metadata } from "next";
import { SectionHeader } from "@/components/ui";

// Standalone "all your maintenance" surface. The dashboard's "On your
// plate" panel caps at the next 30 days so it stays a quick-glance
// reminder; this is where the user lands when they tap View all and
// want the broader view (everything past 30 days, time-window controls,
// per-item filters). Today it's a TBD placeholder — the destination is
// real (the link in the panel header points here) so the navigation
// flow is in place, but the content surface ships in a later issue.

export const metadata: Metadata = {
  title: "Maintenance",
  description: "Everything Hearth is tracking across your house's maintenance plan.",
};

export default function MaintenancePage() {
  return (
    <div className="flex flex-col gap-6">
      <SectionHeader
        eyebrow="On your plate"
        title="Maintenance"
      />
      <div className="surface p-6 sm:p-8 flex flex-col gap-3">
        <p
          style={{
            fontFamily: "var(--font-serif)",
            fontSize: 22,
            fontWeight: 500,
            color: "var(--color-text-primary)",
          }}
        >
          TBD
        </p>
        <p
          className="text-small"
          style={{ color: "var(--color-text-secondary)", maxWidth: 560 }}
        >
          The dashboard panel surfaces the next 30 days. This page is where
          the full timeline will live — every open task across the house
          with controls for the time window you want to look across and
          filters by item. Ships in a later issue.
        </p>
      </div>
    </div>
  );
}
