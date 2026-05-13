import {
  AICard,
  AskAboutStrip,
  Breadcrumb,
  MetricCard,
  PlaceholderImage,
  SectionHeader,
  TimelineItem,
} from "@/components/ui";
import { Icon } from "@/components/icon";
import { DocumentTrigger, SAMPLE_DOCUMENT } from "@/components/document-modal";

export default async function EntityPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await params; // Reserved for real lookups; the page is currently hardcoded.

  return (
    <div className="flex flex-col gap-6">
      <Breadcrumb
        items={[
          { label: "Appliances", href: "/appliances" },
          { label: "Kitchen" },
          { label: "Maytag dishwasher" },
        ]}
      />

      {/* Hero */}
      <section className="grid gap-5 md:grid-cols-[260px_1fr]">
        <div>
          <PlaceholderImage ratio="1 / 1" label="Add photo" icon="camera" />
          <button type="button" className="btn btn-ghost w-full mt-2">
            <Icon name="camera" size={16} />
            Add photo
          </button>
        </div>
        <div className="flex flex-col gap-3 min-w-0">
          <div>
            <div className="eyebrow">Built-in dishwasher · Kitchen</div>
            <h1 className="h1" style={{ marginTop: 4 }}>
              Maytag MDB4949SHZ0
            </h1>
            <p
              className="text-small mt-1"
              style={{ color: "var(--color-text-secondary)" }}
            >
              Made by Whirlpool · Benton Harbor, MI
            </p>
          </div>
          <div className="grid grid-cols-3 gap-2 sm:gap-3">
            <MetricCard
              eyebrow="Installed"
              value="Mar 2018"
              meta="7 years ago"
              icon="calendar"
            />
            <MetricCard
              eyebrow="Last serviced"
              value="Dec 2024"
              meta="Drain pump"
              icon="tool"
            />
            <MetricCard
              eyebrow="Next due"
              value="Aug 2026"
              meta="Filter clean"
              icon="clock"
            />
          </div>
          <div className="flex flex-wrap gap-2 pt-1">
            <span className="chip chip-mono">SN F40231548A</span>
            <span className="chip chip-mono">Type J4DW</span>
            <span className="chip chip-mono">120 V / 6.5 A / 60 Hz</span>
          </div>
        </div>
      </section>

      <AskAboutStrip
        scopeLabel="this dishwasher"
        placeholder="When is the next service? How do I clean the filter?"
      />

      <AICard
        eyebrow="What we know about dishwashers like yours"
        title="Built-in residential dishwashers, mid-2010s Maytag"
      >
        <p>
          The MDB49xx line uses a single-stage filtration system with a
          manually removable cup filter. Expected service life for the drain
          pump is around 6&ndash;8 years, which lines up with your December
          2024 replacement.
        </p>
        <p className="mt-2">
          Recommended monthly upkeep: clear the filter, run a hot cycle with a
          citric-acid tablet, and check the spray-arm jets for hard-water
          buildup. The control board is the most common late-life failure
          point.
        </p>
      </AICard>

      {/* Two-column panel row */}
      <section className="grid gap-4 md:grid-cols-2">
        <Panel
          title="Documents"
          eyebrow="What we have on file"
          action={
            <a
              href="#"
              className="text-small inline-flex items-center gap-1"
              style={{ color: "var(--color-text-secondary)" }}
            >
              Add
              <Icon name="plus" size={14} />
            </a>
          }
        >
          <DocumentTrigger
            document={SAMPLE_DOCUMENT}
            className="panel-row"
          >
            <PanelRowContent
              icon="file-text"
              title="Drain pump receipt"
              meta="Dec 14, 2024 · 2 pages · PDF"
            />
          </DocumentTrigger>
          <DocumentTrigger
            document={{
              ...SAMPLE_DOCUMENT,
              id: "doc-owners-manual",
              kind: "Manual",
              title: "Owner’s manual",
              description:
                "Use and care guide for the MDB49 series. Includes cycle reference, error codes, and maintenance schedule.",
            }}
            className="panel-row"
          >
            <PanelRowContent
              icon="file-text"
              title="Owner's manual"
              meta="48 pages · PDF · From Whirlpool"
            />
          </DocumentTrigger>
          <DocumentTrigger
            document={{
              ...SAMPLE_DOCUMENT,
              id: "doc-installation",
              kind: "Receipt",
              title: "Original installation invoice",
              description:
                "Lowe’s home installation from March 2018 — labor, parts, and haul-away.",
            }}
            className="panel-row"
          >
            <PanelRowContent
              icon="file-text"
              title="Installation invoice"
              meta="Mar 22, 2018 · 1 page · PDF"
            />
          </DocumentTrigger>
        </Panel>

        <Panel
          title="Notes & photos"
          eyebrow="Things you've captured"
          action={
            <a
              href="#"
              className="text-small inline-flex items-center gap-1"
              style={{ color: "var(--color-text-secondary)" }}
            >
              Add
              <Icon name="plus" size={14} />
            </a>
          }
        >
          <PanelRow
            icon="note"
            title="Filter is the bottom-left cup"
            meta="Jul 8, 2024 · Note"
          />
          <PanelRow
            icon="photo"
            title="Serial plate (inside door)"
            meta="Mar 22, 2018 · Photo"
          />
          <PanelRow
            icon="note"
            title="Soap dispenser tab broke off; tape works"
            meta="Feb 19, 2025 · Note"
          />
        </Panel>
      </section>

      {/* Maintenance timeline */}
      <section>
        <SectionHeader
          eyebrow="Everything that's happened"
          title="Maintenance & history"
          trailing={
            <button type="button" className="btn btn-primary">
              <Icon name="plus" size={16} />
              Log maintenance
            </button>
          }
        />
        <ol className="surface p-4 sm:p-5">
          <TimelineItem
            icon="clock"
            title="Filter cleaning due"
            meta="Aug 2026"
            detail="Monthly filter rinse — under the lower spray arm."
            state="upcoming"
          />
          <TimelineItem
            icon="tool"
            title="Drain pump replaced"
            meta="Dec 14, 2024"
            detail="Riverbend Appliance Repair — part W10348269, $284 incl. labor."
          />
          <TimelineItem
            icon="circle-check"
            title="Filter cleaned (DIY)"
            meta="Jul 2024"
          />
          <TimelineItem
            icon="circle-dot"
            title="Installed"
            meta="Mar 22, 2018"
            detail="Lowe's home installation — replaced original 1994 unit."
          />
        </ol>
      </section>

      <PanelRowStyles />
    </div>
  );
}

function Panel({
  title,
  eyebrow,
  action,
  children,
}: {
  title: string;
  eyebrow: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="surface p-4 sm:p-5">
      <div className="flex items-end justify-between mb-3">
        <div>
          <div className="eyebrow">{eyebrow}</div>
          <div className="h3 mt-0.5">{title}</div>
        </div>
        {action}
      </div>
      <div className="flex flex-col gap-1">{children}</div>
    </section>
  );
}

function PanelRow({
  icon,
  title,
  meta,
}: {
  icon: React.ComponentProps<typeof PanelRowContent>["icon"];
  title: string;
  meta: string;
}) {
  return (
    <div className="panel-row">
      <PanelRowContent icon={icon} title={title} meta={meta} />
    </div>
  );
}

function PanelRowContent({
  icon,
  title,
  meta,
}: {
  icon: Parameters<typeof Icon>[0]["name"];
  title: string;
  meta: string;
}) {
  return (
    <>
      <span
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md"
        style={{
          backgroundColor: "var(--color-bg-surface-raised)",
          color: "var(--color-text-secondary)",
        }}
      >
        <Icon name={icon} size={16} />
      </span>
      <span className="min-w-0 flex-1 text-left">
        <span
          className="block truncate"
          style={{ fontSize: 14, fontWeight: 500 }}
        >
          {title}
        </span>
        <span
          className="block truncate text-small"
          style={{ color: "var(--color-text-tertiary)" }}
        >
          {meta}
        </span>
      </span>
      <span aria-hidden style={{ color: "var(--color-text-tertiary)" }}>
        <Icon name="chevron-right" size={14} />
      </span>
    </>
  );
}

// Co-located styles keep the panel-row pattern consistent without leaking
// new global classes outside this page.
function PanelRowStyles() {
  return (
    <style>{`
      .panel-row {
        display: flex;
        width: 100%;
        align-items: center;
        gap: 12px;
        padding: 10px 12px;
        border-radius: var(--radius-md);
        background-color: transparent;
        border: 1px solid transparent;
        text-align: left;
        cursor: pointer;
      }
      .panel-row:hover {
        background-color: var(--color-bg-surface-raised);
        border-color: var(--color-border-subtle);
      }
      .panel-row:focus-visible {
        outline: 2px solid var(--color-accent);
        outline-offset: 2px;
      }
    `}</style>
  );
}
