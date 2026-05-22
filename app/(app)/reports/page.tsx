import type { Metadata } from "next";
import type { CSSProperties, ReactNode } from "react";
import { Icon, type IconName } from "@/components/icon";
import { SectionHeader } from "@/components/ui";

/**
 * Hearth Reporting — the central hub for synthesis reports generated
 * from a homeowner's ingested data.
 *
 * This is a UI-only mockup (issue #96). The page lists the reports we
 * intend to ship, describes what each contains, and surfaces a disabled
 * "Generate" affordance with a "Coming soon" indicator on every card.
 * No generation logic, no PDF rendering, no tier gating.
 *
 * The taxonomy is locked in here before the maintenance module ships
 * because several reports depend on maintenance data to deliver the
 * intelligence layer that differentiates them from competitor offerings.
 */

export const metadata: Metadata = {
  title: "Reports",
  description:
    "Synthesis reports generated from your home's systems, history, and habitat — built on the intelligence layer that surfaces what you didn't know to ask.",
};

type ReportCard = {
  id: string;
  title: string;
  description: string;
  icon: IconName;
  previewLabel: string;
  previewIcon?: IconName;
  /**
   * Optional honest framing line rendered beneath the description in a
   * lighter tone. Used today only on the underwriting packet, where it
   * matters that copy doesn't imply the document is verified by an
   * inspector.
   */
  caveat?: string;
};

type ReportGroup = {
  id: string;
  eyebrow: string;
  title: string;
  blurb: string;
  reports: ReportCard[];
};

/**
 * Three groups, ordered Forward-looking → Retrospective → External.
 * Forward-looking leads because it's the most novel surface and the
 * one that does the most marketing work for the maintenance module's
 * intelligence layer.
 */
const GROUPS: ReportGroup[] = [
  {
    id: "forward-looking",
    eyebrow: "Forecast of what's coming",
    title: "Forward-looking",
    blurb:
      "Projections tuned to your specific home — its systems, its history, the habitat around it — not generic averages.",
    reports: [
      {
        id: "ten-year-forecast",
        title: "10-Year Home Improvement Forecast",
        description:
          "A projection of major repairs and replacements expected over the next decade, adjusted for your home's specific conditions and actual maintenance history. Surfaces clustering risk where multiple systems land in the same year.",
        icon: "calendar",
        previewLabel: "Year-by-year forecast",
        previewIcon: "calendar",
      },
      {
        id: "maintenance-cost-forecast",
        title: "Forecasted Maintenance Cost Report",
        description:
          "A quarterly and annual breakdown of expected maintenance costs based on your home's systems, age, and schedule. Useful for budgeting, sinking-fund planning, and HELOC or refinance conversations.",
        icon: "tool",
        previewLabel: "Annual cost breakdown",
        previewIcon: "tool",
      },
      {
        id: "capital-planning-timeline",
        title: "Capital Planning Timeline",
        description:
          "A visual companion to the 10-year forecast — major upcoming replacements grouped by system track (roof, HVAC, plumbing, exteriors), shown across time so the cluster years are obvious at a glance.",
        icon: "history",
        previewLabel: "Stacked replacement timeline",
        previewIcon: "history",
      },
    ],
  },
  {
    id: "retrospective",
    eyebrow: "Proof of what is",
    title: "Retrospective",
    blurb:
      "Comprehensive documents that prove the state of your home — for renewals, claims, and the handoff at sale time.",
    reports: [
      {
        id: "insurance-inventory",
        title: "Insurance Inventory & Annual Refresh Packet",
        description:
          "A comprehensive PDF documenting major systems, capital improvements, contents inventory, and notable changes since last year. Designed to send to your insurance agent at policy renewal time.",
        icon: "shield",
        previewLabel: "Renewal-ready PDF packet",
        previewIcon: "file-text",
      },
      {
        id: "claim-packet",
        title: "On-Demand Claim Packet",
        description:
          "A scoped packet for a specific damaged system or area of the home — appliances, install dates, model and serial, recent receipts, contractor of record, and before-condition photos. Designed to hand to an adjuster on day one of a claim.",
        icon: "alert-triangle",
        previewLabel: "Adjuster-ready scoped packet",
        previewIcon: "file-text",
      },
      {
        id: "pre-listing",
        title: "Pre-Listing Export Package",
        description:
          "Everything a buyer's agent or buyer would want to know about the home: improvements with dates and costs, system ages, maintenance history, manuals, warranty status, contractor directory. The handoff document at sale time.",
        icon: "key",
        previewLabel: "Buyer-ready handoff bundle",
        previewIcon: "file-text",
      },
    ],
  },
  {
    id: "external-stakeholder",
    eyebrow: "For someone else to consume",
    title: "External stakeholder",
    blurb:
      "Documents shaped for an audience outside your household — carriers, contractors, family members — each tuned to what that reader actually needs.",
    reports: [
      {
        id: "underwriting-packet",
        title: "Underwriting / Binding Packet",
        description:
          "A structured disclosure document for new policy binding or renewal: roof age and material, plumbing material, electrical service, HVAC age, environmental risk factors, recent improvements. Helps carriers price the policy accurately and may unlock preferred-risk tiers.",
        caveat:
          "Homeowner-generated input to the carrier process — not a substitute for inspection.",
        icon: "file-text",
        previewLabel: "Carrier disclosure document",
        previewIcon: "shield",
      },
      {
        id: "contractor-briefing",
        title: "Contractor Briefing Packet",
        description:
          "A one-page brief for a tradesperson visiting your home: the system they're servicing, install date, model and serial, manual link, service history, warranty status, homeowner notes. Generated alongside or embedded in the contractor magic-link view.",
        icon: "note",
        previewLabel: "One-page service brief",
        previewIcon: "note",
      },
      {
        id: "family-summary",
        title: "Family / Co-Owner Summary",
        description:
          "A digest for a spouse or co-owner who isn't in Hearth daily: what's been done, what's upcoming, what they should know about the house. The catch-up brief, written for someone who lives there but doesn't track it.",
        icon: "user",
        previewLabel: "Catch-up digest",
        previewIcon: "user",
      },
    ],
  },
];

const sectionStyle: CSSProperties = {
  scrollMarginTop: "var(--space-6)",
};

export default function ReportsPage() {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "var(--space-7)",
      }}
    >
      <header
        style={{
          display: "flex",
          flexDirection: "column",
          gap: "var(--space-3)",
        }}
      >
        <div className="eyebrow">Hearth Reporting</div>
        <h1 className="h1" style={{ margin: 0 }}>
          Reports
        </h1>
        <p
          style={{
            margin: 0,
            color: "var(--color-text-secondary)",
            maxWidth: "62ch",
          }}
        >
          Synthesis documents built from your home&rsquo;s systems, history,
          and the habitat around it. Each report is tuned to what its reader
          actually needs &mdash; a carrier, an adjuster, a buyer&rsquo;s agent,
          a contractor, or you. We&rsquo;re building the engines now; you can
          preview the taxonomy below.
        </p>
      </header>

      {GROUPS.map((group) => (
        <section
          key={group.id}
          id={group.id}
          style={{
            ...sectionStyle,
            display: "flex",
            flexDirection: "column",
            gap: "var(--space-4)",
          }}
        >
          <SectionHeader eyebrow={group.eyebrow} title={group.title} />
          <p
            style={{
              margin: 0,
              marginTop: "calc(var(--space-3) * -1)",
              color: "var(--color-text-secondary)",
              maxWidth: "62ch",
            }}
          >
            {group.blurb}
          </p>
          <div
            className="grid gap-4 sm:gap-5"
            style={{
              gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))",
            }}
          >
            {group.reports.map((report) => (
              <ReportCardView key={report.id} report={report} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

/**
 * Single report card. Five stacked regions, top to bottom:
 *   1. Icon medallion + title row
 *   2. Description
 *   3. Optional honest-framing caveat (underwriting packet only today)
 *   4. Preview placeholder (static stand-in for the eventual real preview)
 *   5. Footer row with "Coming soon" chip and disabled Generate button
 *
 * The card uses the project's `surface` base so it sits in the same
 * visual register as inventory list rows and dashboard tiles.
 */
function ReportCardView({ report }: { report: ReportCard }) {
  return (
    <article
      className="surface"
      style={{
        padding: "var(--space-4)",
        display: "flex",
        flexDirection: "column",
        gap: "var(--space-3)",
      }}
    >
      <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
        <span
          aria-hidden
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md"
          style={{
            backgroundColor:
              "color-mix(in oklab, var(--color-accent) 14%, var(--color-bg-surface-raised))",
            color: "var(--color-accent)",
            border:
              "1px solid color-mix(in oklab, var(--color-accent) 26%, transparent)",
          }}
        >
          <Icon name={report.icon} size={18} />
        </span>
        <h3
          className="h3"
          style={{
            margin: 0,
            paddingTop: 4,
            lineHeight: 1.3,
            color: "var(--color-text-primary)",
          }}
        >
          {report.title}
        </h3>
      </div>

      <p
        className="text-small"
        style={{
          margin: 0,
          color: "var(--color-text-secondary)",
        }}
      >
        {report.description}
      </p>

      {report.caveat ? (
        <p
          className="text-small"
          style={{
            margin: 0,
            color: "var(--color-text-tertiary)",
            fontStyle: "italic",
          }}
        >
          {report.caveat}
        </p>
      ) : null}

      <ReportPreviewPlaceholder
        label={report.previewLabel}
        icon={report.previewIcon ?? report.icon}
      />

      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "var(--space-3)",
          marginTop: "auto",
        }}
      >
        <ComingSoonChip />
        <button
          type="button"
          className="btn btn-ghost"
          disabled
          aria-disabled
          title="Coming soon"
          style={{
            opacity: 0.55,
            cursor: "not-allowed",
          }}
        >
          Generate
          <Icon name="arrow-right" size={14} />
        </button>
      </div>
    </article>
  );
}

/**
 * Preview stand-in for the eventual real report preview. Borrows the
 * decorative-gradient + icon treatment from the project's
 * `PlaceholderImage`, but lays out wide rather than 1:1 so it reads as
 * "a document preview" rather than "a missing photo". A horizontal
 * separator line and two stub paragraph blocks below the heading hint at
 * "this is a paginated document" without committing to a specific layout
 * the real generator may not produce.
 */
function ReportPreviewPlaceholder({
  label,
  icon,
}: {
  label: string;
  icon: IconName;
}) {
  return (
    <div
      className="surface-raised relative overflow-hidden"
      style={{
        aspectRatio: "16 / 9",
        display: "flex",
        flexDirection: "column",
        padding: "var(--space-3) var(--space-4)",
        gap: 10,
      }}
    >
      <div
        aria-hidden
        className="absolute inset-0"
        style={{
          background:
            "radial-gradient(circle at 18% 25%, color-mix(in oklab, var(--color-accent) 12%, transparent), transparent 55%), radial-gradient(circle at 78% 80%, color-mix(in oklab, var(--color-info) 8%, transparent), transparent 60%)",
          pointerEvents: "none",
        }}
      />
      <div
        className="relative flex items-center gap-2"
        style={{ color: "var(--color-text-secondary)" }}
      >
        <Icon name={icon} size={14} />
        <span
          className="text-small"
          style={{
            color: "var(--color-text-secondary)",
            fontWeight: 500,
          }}
        >
          {label}
        </span>
      </div>
      <div
        aria-hidden
        className="relative"
        style={{
          height: 1,
          background: "var(--color-border-subtle)",
          opacity: 0.7,
        }}
      />
      <div
        aria-hidden
        className="relative flex flex-col gap-1.5"
        style={{ marginTop: 2 }}
      >
        <StubLine width="92%" />
        <StubLine width="78%" />
        <StubLine width="84%" />
        <StubLine width="56%" />
      </div>
    </div>
  );
}

function StubLine({ width }: { width: string }) {
  return (
    <span
      aria-hidden
      style={{
        display: "block",
        height: 6,
        width,
        borderRadius: 3,
        backgroundColor:
          "color-mix(in oklab, var(--color-text-tertiary) 22%, transparent)",
      }}
    />
  );
}

function ComingSoonChip(): ReactNode {
  return (
    <span
      className="chip"
      style={{
        backgroundColor:
          "color-mix(in oklab, var(--color-info) 14%, var(--color-bg-surface-raised))",
        borderColor:
          "color-mix(in oklab, var(--color-info) 26%, transparent)",
        color: "var(--color-info)",
      }}
    >
      <Icon name="clock" size={11} />
      Coming soon
    </span>
  );
}
