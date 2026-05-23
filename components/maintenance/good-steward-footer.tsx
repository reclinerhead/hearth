// Footer strip that surfaces beneath the "On your plate" panel when
// the user has completed at least one maintenance task this calendar
// year (issue #133). Quiet green confirmation rather than a CTA — the
// daily-positive moment that keeps the panel rewarding to open even
// when there's nothing overdue.

import { Icon } from "@/components/icon";

export function GoodStewardFooter({
  completedThisYear,
  mostRecent,
}: {
  completedThisYear: number;
  mostRecent: { title: string; completed_at: string } | null;
}) {
  if (completedThisYear === 0) return null;

  const recentLine = mostRecent
    ? ` · Last: ${mostRecent.title} ${formatMonthDay(mostRecent.completed_at)}`
    : "";

  return (
    <div
      className="flex items-center gap-3 p-3 rounded-[var(--radius-md)]"
      style={{
        backgroundColor:
          "color-mix(in oklab, var(--color-success) 14%, transparent)",
        border:
          "1px solid color-mix(in oklab, var(--color-success) 22%, transparent)",
      }}
    >
      <span
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full"
        style={{
          backgroundColor: "var(--color-success)",
          color: "white",
        }}
      >
        <Icon name="circle-check" size={16} />
      </span>
      <div className="flex flex-col min-w-0">
        <span
          style={{
            fontSize: 14,
            fontWeight: 500,
            color: "var(--color-text-primary)",
          }}
        >
          You&rsquo;re a good steward.
        </span>
        <span
          className="text-small"
          style={{ color: "var(--color-text-secondary)" }}
        >
          {completedThisYear} task{completedThisYear === 1 ? "" : "s"} completed
          this year{recentLine}
        </span>
      </div>
    </div>
  );
}

function formatMonthDay(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}
