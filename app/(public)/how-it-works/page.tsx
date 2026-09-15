import type { Metadata } from "next";
import type { CSSProperties, ReactNode } from "react";
import Image from "next/image";
import { Icon, type IconName } from "@/components/icon";
import {
  SEVERITY_COLOR,
  SEVERITY_WORD,
  SeverityDot,
} from "@/components/habitat-severity";
import type { HabitatSeverity } from "@/lib/habitat/types";

export const metadata: Metadata = {
  title: "How Hearth works",
  description:
    "Hearth's living methodology — what we cover, where our data comes from, and how each habitat finding gets its severity.",
};

const sectionStyle: CSSProperties = {
  scrollMarginTop: "var(--space-6)",
};

/**
 * Inline severity badge used inside the classification tables. Mirrors the
 * dot + colored word treatment used elsewhere in the product so a reader
 * recognizes the verdict at a glance. `label` lets callers override the
 * default word (e.g. "Neutral (with note)").
 */
function Severity({
  kind,
  label,
}: {
  kind: HabitatSeverity;
  label?: string;
}) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        whiteSpace: "nowrap",
      }}
    >
      <SeverityDot severity={kind} />
      <span style={{ color: SEVERITY_COLOR[kind], fontWeight: 500 }}>
        {label ?? SEVERITY_WORD[kind]}
      </span>
    </span>
  );
}

/**
 * Classification table primitive. Tables wrap in an overflow-x container
 * so narrow viewports get a horizontal scroll rather than a broken
 * layout. Header row uses surface-raised; body rows alternate via
 * nth-child styling inlined here.
 */
function ClassificationTable({
  headers,
  rows,
}: {
  headers: string[];
  rows: ReactNode[][];
}) {
  return (
    <div
      style={{
        overflowX: "auto",
        border: "1px solid var(--color-border-subtle)",
        borderRadius: "var(--radius-md)",
      }}
    >
      <table
        style={{
          width: "100%",
          borderCollapse: "collapse",
          fontSize: "var(--text-small)",
        }}
      >
        <thead>
          <tr style={{ backgroundColor: "var(--color-bg-surface-raised)" }}>
            {headers.map((h) => (
              <th
                key={h}
                scope="col"
                style={{
                  textAlign: "left",
                  padding: "10px 14px",
                  fontWeight: 500,
                  color: "var(--color-text-secondary)",
                  borderBottom: "1px solid var(--color-border-subtle)",
                }}
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, ri) => (
            <tr
              key={ri}
              style={{
                backgroundColor:
                  ri % 2 === 0
                    ? "transparent"
                    : "color-mix(in oklab, var(--color-bg-surface-raised) 40%, transparent)",
              }}
            >
              {row.map((cell, ci) => (
                <td
                  key={ci}
                  style={{
                    padding: "10px 14px",
                    verticalAlign: "top",
                    color: "var(--color-text-primary)",
                    borderTop:
                      ri === 0
                        ? "none"
                        : "1px solid var(--color-border-subtle)",
                  }}
                >
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SourcesList({
  items,
}: {
  items: { label: string; href: string }[];
}) {
  return (
    <ul
      style={{
        listStyle: "none",
        margin: 0,
        padding: 0,
        display: "flex",
        flexDirection: "column",
        gap: 4,
      }}
    >
      {items.map((item) => (
        <li key={item.href}>
          <a
            href={item.href}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              color: "var(--color-text-secondary)",
              textDecoration: "underline",
              textDecorationColor: "var(--color-border-emphasis)",
              textUnderlineOffset: 3,
            }}
          >
            {item.label}
          </a>
        </li>
      ))}
    </ul>
  );
}

/**
 * One habitat module's methodology section. Composes the thumbnail,
 * heading + overview pair, classification table(s), optional
 * model-vs-authority note, source links, and the "Last updated" line.
 *
 * `children` is where modules drop in any extra prose between the table
 * and the sources — Superfund's precision-caveat note and the FEMA
 * model-vs-FEMA note both live there.
 */
function ModuleSection({
  id,
  title,
  thumbnail,
  thumbnailAlt,
  overview,
  table,
  sources,
  lastUpdated,
  children,
}: {
  id: string;
  title: string;
  thumbnail: string;
  thumbnailAlt: string;
  overview: ReactNode;
  table?: ReactNode;
  sources: { label: string; href: string }[];
  lastUpdated: string;
  children?: ReactNode;
}) {
  return (
    <section
      id={id}
      style={{
        ...sectionStyle,
        display: "flex",
        flexDirection: "column",
        gap: "var(--space-4)",
      }}
    >
      <div
        style={{
          display: "flex",
          gap: "var(--space-4)",
          alignItems: "flex-start",
          flexWrap: "wrap",
        }}
      >
        <div
          style={{
            flexShrink: 0,
            width: 96,
            height: 96,
            position: "relative",
            borderRadius: "var(--radius-md)",
            overflow: "hidden",
            border: "1px solid var(--color-border-subtle)",
            backgroundColor: "var(--color-bg-surface-raised)",
          }}
        >
          <Image
            src={thumbnail}
            alt={thumbnailAlt}
            fill
            sizes="96px"
            style={{ objectFit: "cover" }}
          />
        </div>
        <div style={{ flex: "1 1 280px", minWidth: 0 }}>
          <h2
            style={{
              fontFamily: "var(--font-serif)",
              fontSize: 24,
              fontWeight: 500,
              lineHeight: 1.2,
              letterSpacing: "-0.01em",
              color: "var(--color-text-primary)",
              margin: 0,
              marginBottom: "var(--space-2)",
            }}
          >
            {title}
          </h2>
          <p
            style={{
              margin: 0,
              color: "var(--color-text-secondary)",
            }}
          >
            {overview}
          </p>
        </div>
      </div>

      {table ? table : null}

      {children}

      <div>
        <div
          className="eyebrow"
          style={{ marginBottom: 6 }}
        >
          Sources
        </div>
        <SourcesList items={sources} />
      </div>

      <div
        className="text-small"
        style={{ color: "var(--color-text-tertiary)" }}
      >
        Last updated: {lastUpdated}
      </div>
    </section>
  );
}

/**
 * Icon-on-tinted-surface stand-in for the photographic thumbnails the
 * habitat modules use. Sized and framed identically to the habitat
 * `Image` containers so non-habitat sections (Inventory) read at the
 * same visual weight on the page.
 */
function IconThumbnail({ icon }: { icon: IconName }) {
  return (
    <div
      style={{
        flexShrink: 0,
        width: 96,
        height: 96,
        borderRadius: "var(--radius-md)",
        border: "1px solid var(--color-border-subtle)",
        backgroundColor: "var(--color-bg-surface-raised)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        color: "var(--color-text-secondary)",
      }}
    >
      <Icon name={icon} size={44} />
    </div>
  );
}

/**
 * Inventory section. Same outer layout as `ModuleSection` (heading row
 * with thumbnail + overview, supporting prose, sources, last-updated)
 * but without a classification table — inventory isn't a habitat
 * finding, so there's nothing to map raw data to a severity. Inlined
 * rather than going through `ModuleSection` because `ModuleSection`'s
 * thumbnail prop is a photo URL and the broader visual shape is the
 * thing we're matching, not the prop signature.
 */
function InventorySection() {
  return (
    <section
      id="inventory"
      style={{
        ...sectionStyle,
        display: "flex",
        flexDirection: "column",
        gap: "var(--space-4)",
      }}
    >
      <div
        style={{
          display: "flex",
          gap: "var(--space-4)",
          alignItems: "flex-start",
          flexWrap: "wrap",
        }}
      >
        <IconThumbnail icon="device-tv-old" />
        <div style={{ flex: "1 1 280px", minWidth: 0 }}>
          <h2
            style={{
              fontFamily: "var(--font-serif)",
              fontSize: 24,
              fontWeight: 500,
              lineHeight: 1.2,
              letterSpacing: "-0.01em",
              color: "var(--color-text-primary)",
              margin: 0,
              marginBottom: "var(--space-2)",
            }}
          >
            Inventory
          </h2>
          <p
            style={{
              margin: 0,
              color: "var(--color-text-secondary)",
            }}
          >
            A record of the major systems, appliances, and notable items in
            your home — the things that have a model, a service history, or
            a reason to be remembered — plus property like vehicles and
            pets. Each item lives in a room (rooms are seeded for every house
            and can be renamed, added, or removed), and the full inventory
            is browsable in one place, grouped by type.
          </p>
        </div>
      </div>

      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: "var(--space-4)",
          maxWidth: "62ch",
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <h3 className="h3" style={{ margin: 0 }}>
            How items get in
          </h3>
          <p
            style={{
              margin: 0,
              color: "var(--color-text-secondary)",
            }}
          >
            The fastest path is a photo. Hearth&rsquo;s Smart Uploader takes
            a picture of a nameplate or label, uses AI to work out what
            it&rsquo;s looking at, pulls the printed facts off it
            (manufacturer, model, serial, plus specs like capacity or fuel
            type), and pre-fills an entry you confirm or edit before saving.
            If the photo looks like something you already have — a second
            shot of the same furnace — Hearth offers to add it to the
            existing item rather than create a duplicate, and an identical
            re-upload is caught before anything is stored. Items can also be
            entered by hand. Vehicles work the same way from a registration
            or insurance card: Hearth reads the VIN, decodes the year, make,
            and model automatically, and notes the expiration date.
          </p>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <h3 className="h3" style={{ margin: 0 }}>
            What attaches to an item
          </h3>
          <p
            style={{
              margin: 0,
              color: "var(--color-text-secondary)",
            }}
          >
            More photos, and documents: service receipts and invoices (up to
            five pages), registration and insurance cards, and similar
            paperwork. Hearth reads each receipt — vendor, date, line items,
            total, any serial numbers it mentions — and uses those serials
            to suggest which item it belongs to. On the item&rsquo;s page,
            every document shows both the original pages and a
            &ldquo;what we found&rdquo; summary of what Hearth read off it.
          </p>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <h3 className="h3" style={{ margin: 0 }}>
            What Hearth does with it
          </h3>
          <p
            style={{
              margin: 0,
              color: "var(--color-text-secondary)",
            }}
          >
            Each item has a detail page with the captured facts as pills, its
            photos, and an on-demand &ldquo;Research this model&rdquo; panel
            that uses an AI web lookup for what&rsquo;s generally known about
            equipment like yours — typical service life, common maintenance,
            things to watch for — with source links so you can verify.
            Alongside research, a separate reasoning model tries to decode
            the manufacture date from the serial number; Hearth records that
            date only when the decode is high-confidence, so an uncertain
            guess never lands on your page. A History section lists
            completed maintenance alongside install and purchase milestones.
          </p>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <h3 className="h3" style={{ margin: 0 }}>
            What it&rsquo;s for
          </h3>
          <p
            style={{
              margin: 0,
              color: "var(--color-text-secondary)",
            }}
          >
            The inventory is the foundation the rest of Hearth leans on.
            Research feeds the maintenance plan (see below), renewal
            documents create renewal reminders, and reports draw on it — the
            Water Quality Report is live today; a pre-listing export, a
            contractor brief, and warranty tracking are planned.
          </p>
        </div>
      </div>

      <div>
        <div className="eyebrow" style={{ marginBottom: 6 }}>
          Sources
        </div>
        <SourcesList
          items={[
            {
              label: "Vercel AI Gateway (model routing)",
              href: "https://vercel.com/docs/ai-gateway",
            },
            {
              label: "xAI Grok — nameplate, receipt, and document reading",
              href: "https://x.ai",
            },
            {
              label: "Perplexity Sonar — \"Research this model\" lookups",
              href: "https://docs.perplexity.ai",
            },
          ]}
        />
      </div>

      <div
        className="text-small"
        style={{ color: "var(--color-text-tertiary)" }}
      >
        Last updated: September 15, 2026
      </div>
    </section>
  );
}

/**
 * Maintenance section. Same shape as `InventorySection` — heading row
 * with icon thumbnail + overview, sub-headed prose, sources,
 * last-updated — and no classification table, because a maintenance
 * task has no severity to map. Describes the two task pipelines
 * (AI synthesis from research, deterministic renewals from documents),
 * how cadence is anchored and modulated by habitat findings, and where
 * tasks surface. Governance: the same rule that binds the habitat
 * sections applies here — a PR that changes what the synthesis prompt
 * includes or excludes updates this prose and its date.
 */
function MaintenanceSection() {
  return (
    <section
      id="maintenance"
      style={{
        ...sectionStyle,
        display: "flex",
        flexDirection: "column",
        gap: "var(--space-4)",
      }}
    >
      <div
        style={{
          display: "flex",
          gap: "var(--space-4)",
          alignItems: "flex-start",
          flexWrap: "wrap",
        }}
      >
        <IconThumbnail icon="tool" />
        <div style={{ flex: "1 1 280px", minWidth: 0 }}>
          <h2
            style={{
              fontFamily: "var(--font-serif)",
              fontSize: 24,
              fontWeight: 500,
              lineHeight: 1.2,
              letterSpacing: "-0.01em",
              color: "var(--color-text-primary)",
              margin: 0,
              marginBottom: "var(--space-2)",
            }}
          >
            Maintenance
          </h2>
          <p
            style={{
              margin: 0,
              color: "var(--color-text-secondary)",
            }}
          >
            Hearth builds a maintenance plan from the specific items in your
            inventory rather than a generic checklist, and explains every
            task it schedules. Tasks arrive two ways: an AI pass that turns
            what Hearth has researched about an item into a schedule, and
            renewal reminders created directly from documents that carry an
            expiration date.
          </p>
        </div>
      </div>

      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: "var(--space-4)",
          maxWidth: "62ch",
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <h3 className="h3" style={{ margin: 0 }}>
            Where tasks come from
          </h3>
          <p
            style={{
              margin: 0,
              color: "var(--color-text-secondary)",
            }}
          >
            When you research an item, Hearth hands what it learned — the
            expected service life, the manufacturer&rsquo;s maintenance
            guidance — together with the item&rsquo;s install date, any
            service receipts on file, and the habitat findings for your home
            to a reasoning model, which returns a structured set of recurring
            tasks: what to do, how often, and why. Most items land between
            four and eight tasks. The plan builds automatically after a
            successful research run and can be rebuilt any time; rebuilding
            replaces the AI-generated tasks but never touches reminders that
            came from your documents.
          </p>
          <p
            style={{
              margin: 0,
              color: "var(--color-text-secondary)",
            }}
          >
            The second path involves no AI at all. When a document with an
            expiration date is attached to an item — a vehicle registration,
            an insurance card — Hearth writes a renewal task due on that
            date. Upload next year&rsquo;s card and the old task is marked
            done with a new one chained after it.
          </p>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <h3 className="h3" style={{ margin: 0 }}>
            How the schedule is anchored
          </h3>
          <p
            style={{
              margin: 0,
              color: "var(--color-text-secondary)",
            }}
          >
            Each task&rsquo;s first due date is grounded in something real
            when possible: last year&rsquo;s furnace-service receipt anchors
            next year&rsquo;s, an install date anchors the first filter
            change, and only when neither exists does the schedule start
            from today. Tasks tied to using the appliance rather than the
            calendar — checking rinse aid, clearing the lint screen — are
            kept as &ldquo;every time you use it&rdquo; practices instead of
            being forced onto a monthly interval.
          </p>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <h3 className="h3" style={{ margin: 0 }}>
            How your home&rsquo;s conditions change the cadence
          </h3>
          <p
            style={{
              margin: 0,
              color: "var(--color-text-secondary)",
            }}
          >
            Habitat findings don&rsquo;t create tasks; they adjust ones the
            item already needs, and the adjustment is recorded on the task.
            Water is the clearest example. When your utility&rsquo;s annual
            water quality report lists hardness, iron, or manganese, Hearth
            classifies the water (soft, moderate, hard, very hard) and the
            plan shortens the intervals for water-touching equipment — the
            water heater&rsquo;s anode rod, softener resin, dishwasher rinse
            aid, faucet aerators. A flood-zone finding makes a sump pump
            test more pressing. A unit near the end of its expected service
            life gets tighter intervals too. Every adjustment appears under
            &ldquo;Why this task&rdquo; with the finding it came from.
          </p>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <h3 className="h3" style={{ margin: 0 }}>
            What Hearth leaves out
          </h3>
          <p
            style={{
              margin: 0,
              color: "var(--color-text-secondary)",
            }}
          >
            Not everything a manual mentions is a recurring task. Installer
            setup steps — leveling, anti-tip brackets, initial clearances —
            are one-time work the installer did and are left out entirely.
            &ldquo;Call a technician if the igniter is slow&rdquo; has no
            honest interval, so it becomes something to notice while you use
            the appliance rather than a date on a calendar. Work you&rsquo;d
            realistically do in one session is merged into a single task
            instead of one per sentence of guidance. Gas, propane, and oil
            appliances always get an annual clearance-and-combustibles check
            even when their guidance omits it.
          </p>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <h3 className="h3" style={{ margin: 0 }}>
            Where tasks show up
          </h3>
          <p
            style={{
              margin: 0,
              color: "var(--color-text-secondary)",
            }}
          >
            The dashboard&rsquo;s &ldquo;On your plate&rdquo; panel shows
            anything overdue plus the next handful of upcoming tasks, each
            labeled with its appliance; the full list for an item lives on
            that item&rsquo;s page. Opening a task shows the instruction,
            the due date, the reasoning — where the task came from, why this
            cadence, what adjusted it — and its history. Marking a task done
            or renewed closes it and schedules the next occurrence from the
            date you completed it; renewal tasks offer the issuer&rsquo;s
            term lengths (one or two years for a Michigan registration, six
            or twelve months for insurance) or let you enter the exact new
            expiration.
          </p>
        </div>
      </div>

      <div>
        <div className="eyebrow" style={{ marginBottom: 6 }}>
          Sources
        </div>
        <SourcesList
          items={[
            {
              label: "Vercel AI Gateway (model routing)",
              href: "https://vercel.com/docs/ai-gateway",
            },
            {
              label: "xAI Grok (reasoning) — maintenance synthesis",
              href: "https://x.ai",
            },
            {
              label: "USGS — water hardness classification",
              href: "https://www.usgs.gov/special-topics/water-science-school/science/hardness-water",
            },
          ]}
        />
      </div>

      <div
        className="text-small"
        style={{ color: "var(--color-text-tertiary)" }}
      >
        Last updated: September 15, 2026
      </div>
    </section>
  );
}

const PILLARS: { title: string; body: string }[] = [
  {
    title: "Emergency procedures",
    body:
      "Where to shut off water, gas, and electrical in an emergency — short videos you record once, kept one tap away on your dashboard for the moment you need them.",
  },
  {
    title: "Inventory",
    body:
      "A record of your home's systems and major items — appliances, mechanical systems, exterior assets, and property like vehicles — with photos, receipts, registrations, and service history attached.",
  },
  {
    title: "Maintenance",
    body:
      "A maintenance plan built from what's actually in your inventory: recurring tasks, renewal reminders, and the reasoning behind each one, adjusted for the conditions around your home.",
  },
  {
    title: "Habitat",
    body:
      "What's around your home — environmental conditions, public records, things in your area you should know about. This is where the habitat modules live.",
  },
];

export default function HowItWorksPage() {
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
          <div className="eyebrow">Methodology</div>
          <h1
            className="h1"
            style={{ margin: 0 }}
          >
            How Hearth works
          </h1>
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: "var(--space-3)",
              color: "var(--color-text-secondary)",
              maxWidth: "62ch",
            }}
          >
            <p style={{ margin: 0 }}>
              Hearth helps homeowners understand their home — its systems, its
              history, the area around it, and the things that need attention
              but rarely make it onto a to-do list. We do this by combining
              what you give us (documents, photos, records of your home's
              systems) with public data sources you might not have known to
              check.
            </p>
            <p style={{ margin: 0 }}>
              This page is where we show our work. It explains what Hearth
              does, how we organize information about your home, and how we
              arrive at the findings you see on your dashboard. Everything
              Hearth tells you about your home comes from somewhere, and you
              should be able to see exactly where.
            </p>
          </div>
        </header>

        <section
          style={{
            ...sectionStyle,
            display: "flex",
            flexDirection: "column",
            gap: "var(--space-4)",
          }}
        >
          <h2
            style={{
              fontFamily: "var(--font-serif)",
              fontSize: 24,
              fontWeight: 500,
              lineHeight: 1.2,
              letterSpacing: "-0.01em",
              color: "var(--color-text-primary)",
              margin: 0,
            }}
          >
            What Hearth covers
          </h2>
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: "var(--space-4)",
            }}
          >
            {PILLARS.map((pillar) => (
              <div
                key={pillar.title}
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: 4,
                }}
              >
                <h3
                  className="h3"
                  style={{ margin: 0 }}
                >
                  {pillar.title}
                </h3>
                <p
                  style={{
                    margin: 0,
                    color: "var(--color-text-secondary)",
                    maxWidth: "62ch",
                  }}
                >
                  {pillar.body}
                </p>
              </div>
            ))}
          </div>
        </section>

        <InventorySection />

        <MaintenanceSection />

        <section
          style={{
            ...sectionStyle,
            display: "flex",
            flexDirection: "column",
            gap: "var(--space-6)",
          }}
        >
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: "var(--space-2)",
            }}
          >
            <h2
              style={{
                fontFamily: "var(--font-serif)",
                fontSize: 24,
                fontWeight: 500,
                lineHeight: 1.2,
                letterSpacing: "-0.01em",
                color: "var(--color-text-primary)",
                margin: 0,
              }}
            >
              Habitat module methodology
            </h2>
            <p
              style={{
                margin: 0,
                color: "var(--color-text-secondary)",
                maxWidth: "62ch",
              }}
            >
              One section per habitat module Hearth runs against your home.
              Each section names the data source, lays out exactly how a
              finding gets its severity, and links back to the upstream
              authority so you can verify.
            </p>
          </div>

          <ModuleSection
            id="radon"
            title="Radon zones"
            thumbnail="/habitat_module_images/radon.jpg"
            thumbnailAlt="EPA radon zones map detail"
            overview={
              <>
                Hearth checks the EPA Map of Radon Zones for your county. The
                EPA published this map in 1993 and republished it most
                recently in June 2024. It groups every U.S. county into one
                of three zones based on predicted average indoor radon
                concentrations, before mitigation.
              </>
            }
            table={
              <ClassificationTable
                headers={["EPA Zone", "EPA's predicted indoor radon", "Hearth severity"]}
                rows={[
                  [
                    "Zone 1",
                    "Greater than 4 pCi/L (above EPA action level)",
                    <Severity kind="concern" key="s" />,
                  ],
                  [
                    "Zone 2",
                    "Between 2 and 4 pCi/L",
                    <Severity kind="caution" key="s" />,
                  ],
                  [
                    "Zone 3",
                    "Less than 2 pCi/L",
                    <Severity kind="favorable" key="s" />,
                  ],
                ]}
              />
            }
            sources={[
              {
                label: "EPA Map of Radon Zones",
                href: "https://www.epa.gov/radon/epa-map-radon-zones",
              },
              {
                label: "EPA — Radon zones and action levels",
                href: "https://www.epa.gov/radon",
              },
            ]}
            lastUpdated="May 15, 2026"
          >
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: "var(--space-2)",
                color: "var(--color-text-secondary)",
                maxWidth: "62ch",
              }}
            >
              <h3 className="h3" style={{ margin: 0 }}>
                Important caveat
              </h3>
              <p style={{ margin: 0 }}>
                The EPA zone is a county-level <em>predicted average</em>. An
                individual home in a Zone 3 county can still test high; a
                home in a Zone 1 county can still test low. EPA recommends
                testing every home regardless of zone. Hearth surfaces the
                zone as a starting point — your actual radon level can only
                be known by testing your specific home.
              </p>
            </div>
          </ModuleSection>

          <ModuleSection
            id="superfund"
            title="Superfund proximity"
            thumbnail="/habitat_module_images/epa_superfund.jpg"
            thumbnailAlt="EPA Superfund site detail"
            overview={
              <>
                Hearth checks EPA's Superfund Enterprise Management System
                (SEMS) for every NPL-relevant Superfund site in your state,
                measures the straight-line distance from your home to each
                one, and surfaces the closest sites that fall within Hearth's
                proximity model. The data is live — every check pulls
                current EPA records.
              </>
            }
            sources={[
              {
                label: "EPA Envirofacts SEMS",
                href: "https://www.epa.gov/enviro/sems-search-user-guide",
              },
              {
                label: "EPA Superfund program",
                href: "https://www.epa.gov/superfund",
              },
              {
                label: "EPA National Priorities List",
                href: "https://www.epa.gov/superfund/superfund-national-priorities-list-npl",
              },
            ]}
            lastUpdated="September 15, 2026"
          >
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: "var(--space-2)",
                maxWidth: "62ch",
              }}
            >
              <h3 className="h3" style={{ margin: 0 }}>
                How we classify — proximity tiers
              </h3>
              <p
                style={{
                  margin: 0,
                  color: "var(--color-text-secondary)",
                }}
              >
                Each Superfund site in your state is sorted into a tier based
                on distance and listing status:
              </p>
            </div>
            <ClassificationTable
              headers={["Distance from home", "NPL statuses included"]}
              rows={[
                ["Tier 1: 0 – 0.5 miles", "Any (Final, Proposed, Part of NPL, Deleted)"],
                ["Tier 2: 0.5 – 2 miles", "Final or Proposed only"],
                ["Tier 3: 2 – 5 miles", "Final only"],
                ["Beyond 5 miles", "Not surfaced"],
              ]}
            />

            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: "var(--space-2)",
                maxWidth: "62ch",
              }}
            >
              <h3 className="h3" style={{ margin: 0 }}>
                How we map tier and NPL status to severity
              </h3>
            </div>
            <ClassificationTable
              headers={["Tier", "NPL status", "Hearth severity"]}
              rows={[
                ["Tier 1", "Final or Proposed", <Severity kind="concern" key="s" />],
                ["Tier 1", "Part of NPL or Deleted", <Severity kind="caution" key="s" />],
                ["Tier 2", "Final or Proposed", <Severity kind="caution" key="s" />],
                ["Tier 3", "Final", <Severity kind="neutral" key="s" />],
                [
                  "No qualifying sites within 5 miles",
                  "—",
                  <Severity kind="favorable" key="s" />,
                ],
              ]}
            />

            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: "var(--space-2)",
                color: "var(--color-text-secondary)",
                maxWidth: "62ch",
              }}
            >
              <h3 className="h3" style={{ margin: 0 }}>
                How we label each site for your situation
              </h3>
              <p style={{ margin: 0 }}>
                Severity grades a site&rsquo;s distance and listing status
                on the dashboard. Separately, Hearth gives each site — and
                the finding as a whole — a <strong>label</strong> that says
                how relevant it is to someone deciding whether to act:
                {" "}<em>Worth acting on</em>, <em>Worth knowing</em>, or
                {" "}<em>Informational</em>. When EPA hasn&rsquo;t published
                enough for a confident read, the label is suppressed rather
                than shown as false reassurance.
              </p>
              <p style={{ margin: 0 }}>
                The label weighs distance, NPL status, the most serious
                contaminant EPA lists at the site, and — if you shared them
                during onboarding — your water source and whether you have a
                basement. A groundwater contaminant two miles away is
                {" "}<em>Worth knowing</em> for most homes but <em>Worth
                acting on</em> for a well user; a vapor-forming contaminant
                within half a mile escalates the same way for a home with a
                basement. Unknown answers keep the label at its conservative
                value — skipping onboarding never inflates it.
              </p>
            </div>

            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: "var(--space-2)",
                color: "var(--color-text-secondary)",
                maxWidth: "62ch",
              }}
            >
              <h3 className="h3" style={{ margin: 0 }}>
                Portfolio summary
              </h3>
              <p style={{ margin: 0 }}>
                When nearby sites exist, a language model writes a two-to-four
                sentence summary from the structured facts (names, distances,
                statuses, contaminants, labels): what&rsquo;s there, what
                stands out, any pattern across sites. It is forbidden from
                claiming your property is or isn&rsquo;t contaminated —
                that&rsquo;s for EPA, your utility, and licensed testers.
                The summary is generated once per check and stored; if the
                model call fails, the finding ships without it.
              </p>
            </div>

            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: "var(--space-2)",
                color: "var(--color-text-secondary)",
                maxWidth: "62ch",
              }}
            >
              <h3 className="h3" style={{ margin: 0 }}>
                How Hearth's model relates to EPA's guidance
              </h3>
              <p style={{ margin: 0 }}>
                EPA uses 1-mile and 3-mile rings in its community-involvement
                work. Hearth&rsquo;s 0.5 / 2 / 5-mile tiers are our own
                synthesis, informed by that practice, because living half a
                mile from an active cleanup is a different experience from
                living two miles away. Tier classifications in a Hearth
                finding are Hearth&rsquo;s, not EPA&rsquo;s.
              </p>
            </div>

            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: "var(--space-2)",
                color: "var(--color-text-secondary)",
                maxWidth: "62ch",
              }}
            >
              <h3 className="h3" style={{ margin: 0 }}>
                A note on precision
              </h3>
              <p style={{ margin: 0 }}>
                EPA publishes one representative point per site, even for
                sites that stretch for miles along a river or across several
                parcels. For those, the distance Hearth computes can be off
                by miles, and the finding says so. The Allied Paper / Portage
                Creek / Kalamazoo River site is the local example.
              </p>
            </div>

            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: "var(--space-2)",
                color: "var(--color-text-secondary)",
                maxWidth: "62ch",
              }}
            >
              <h3 className="h3" style={{ margin: 0 }}>
                Site contact and documents
              </h3>
              <p style={{ margin: 0 }}>
                Each nearby site links straight to its document library on
                EPA&rsquo;s site profile. When EPA has assigned a
                {" "}<strong>Community Involvement Coordinator</strong>{" "}— the
                contact for public questions, as opposed to the technical
                project manager — Hearth shows their name, email, and phone;
                when there isn&rsquo;t one, it says so.
              </p>
            </div>

            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: "var(--space-2)",
                color: "var(--color-text-secondary)",
                maxWidth: "62ch",
              }}
            >
              <h3 className="h3" style={{ margin: 0 }}>
                Recommended actions for your situation
              </h3>
              <p style={{ margin: 0 }}>
                Beneath the summary, Hearth lists concrete next steps matched
                to your setup. Well users see a prompt to test for the
                relevant contaminants; city-water customers see a prompt to
                read their utility&rsquo;s water quality report; a basement
                near a site with volatile chemicals within half a mile
                prompts a vapor-intrusion check. When your water source or
                basement is unknown, Hearth withholds these rather than
                guess — you can fill them in any time from Home details.
              </p>
            </div>

            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: "var(--space-2)",
                color: "var(--color-text-secondary)",
                maxWidth: "62ch",
              }}
            >
              <h3 className="h3" style={{ margin: 0 }}>
                Contaminant summaries on each site card
              </h3>
              <p style={{ margin: 0 }}>
                Each site card carries a plain-English line —
                &ldquo;Heavy metals,&rdquo; &ldquo;PCBs and dioxins, heavy
                metals&rdquo; — grouping EPA&rsquo;s listed chemicals into a
                few consistent categories so you can triage without opening
                the site. Sites with no published contaminants show no line.
              </p>
            </div>

            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: "var(--space-2)",
                color: "var(--color-text-secondary)",
                maxWidth: "62ch",
              }}
            >
              <h3 className="h3" style={{ margin: 0 }}>
                Sites we filter out
              </h3>
              <p style={{ margin: 0 }}>
                Hearth only shows sites where EPA has published a contaminant
                inventory. Some database entries are sub-records of a parent
                listing with no details of their own; those are dropped, and
                the finding&rsquo;s activity log names what was filtered.
              </p>
            </div>

            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: "var(--space-2)",
                color: "var(--color-text-secondary)",
                maxWidth: "62ch",
              }}
            >
              <h3 className="h3" style={{ margin: 0 }}>
                Inside a single site
              </h3>
              <p style={{ margin: 0 }}>
                Opening a site shows its name and address, the precision
                caveat when relevant, what makes it distinct within your
                nearby set (closest, only active cleanup, and so on), how its
                contaminants typically spread (groundwater, vapor, and so
                on), the EPA contact and documents, the full contaminant
                list, and a note on where the data came from and when it was
                last checked. The pathway explanations are fixed text
                written once per pathway, not generated per site, so the
                framing stays consistent.
              </p>
            </div>
          </ModuleSection>

          <ModuleSection
            id="flood-zones"
            title="FEMA flood zones"
            thumbnail="/habitat_module_images/fema_flood_zones.jpg"
            thumbnailAlt="FEMA flood map detail"
            overview={
              <>
                Hearth checks FEMA's National Flood Hazard Layer for your
                home's coordinates and returns the official FEMA flood zone
                designation for your property. FEMA's flood zones come from
                local flood studies and are the basis for federal flood
                insurance requirements and floodplain management
                regulations.
              </>
            }
            table={
              <ClassificationTable
                headers={["FEMA zone", "What it means", "Hearth severity"]}
                rows={[
                  [
                    "Zone X (minimal hazard)",
                    "Outside both the 100-year and 500-year floodplains",
                    <Severity kind="favorable" key="s" />,
                  ],
                  [
                    "Zone X (shaded — 0.2% annual chance)",
                    "In the 500-year floodplain; flood insurance not required but recommended",
                    <Severity kind="neutral" key="s" />,
                  ],
                  [
                    "Zone D",
                    "Possible but undetermined flood hazard — FEMA hasn't formally studied this area",
                    <Severity kind="caution" key="s" />,
                  ],
                  [
                    "Zones A, AE, AH, AO, AR",
                    "100-year floodplain — Special Flood Hazard Area; federal flood insurance required for federally-backed mortgages",
                    <Severity kind="concern" key="s" />,
                  ],
                  [
                    "Zone AE with FLOODWAY subtype",
                    "Regulatory floodway — the active channel that carries flood flows",
                    <Severity kind="critical" key="s" />,
                  ],
                  [
                    "Zones V, VE",
                    "Coastal high-hazard zone — flooding plus wave action",
                    <Severity kind="critical" key="s" />,
                  ],
                  [
                    "No FEMA flood map data for the area",
                    "FEMA's digital coverage doesn't include this location (about 10% of U.S. addresses, mostly rural)",
                    <Severity kind="neutral" label="Neutral (with note)" key="s" />,
                  ],
                ]}
              />
            }
            sources={[
              {
                label: "FEMA National Flood Hazard Layer",
                href: "https://www.fema.gov/flood-maps/national-flood-hazard-layer",
              },
              {
                label: "FEMA flood zone definitions",
                href: "https://www.fema.gov/glossary/flood-zones",
              },
              {
                label: "FEMA Flood Map Service Center",
                href: "https://msc.fema.gov",
              },
            ]}
            lastUpdated="May 18, 2026"
          >
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: "var(--space-2)",
                color: "var(--color-text-secondary)",
                maxWidth: "62ch",
              }}
            >
              <h3 className="h3" style={{ margin: 0 }}>
                About base flood elevation (BFE)
              </h3>
              <p style={{ margin: 0 }}>
                For homes in detailed AE-zone studies, FEMA publishes a Base
                Flood Elevation — the elevation that floodwater is expected
                to reach during a 100-year flood. When we have this number,
                Hearth surfaces it. This is the elevation reference used in
                flood insurance pricing and elevation certificates.
              </p>
            </div>

            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: "var(--space-2)",
                color: "var(--color-text-secondary)",
                maxWidth: "62ch",
              }}
            >
              <h3 className="h3" style={{ margin: 0 }}>
                How Hearth's model relates to FEMA's classifications
              </h3>
              <p style={{ margin: 0 }}>
                The flood zone codes (X, AE, V, etc.) are FEMA's. The
                severity mapping is Hearth's interpretation — most of it is
                straightforward (an AE-zone home is in a Special Flood
                Hazard Area, period), but the X-shaded-versus-unshaded
                distinction is one we surface intentionally because most
                consumer-facing flood lookups collapse both into "Zone X"
                without explaining the difference.
              </p>
            </div>
          </ModuleSection>

          <ModuleSection
            id="water-quality-awareness"
            title="Water Quality Awareness"
            thumbnail="/habitat_module_images/WQA.jpg"
            thumbnailAlt="Glass of tap water"
            overview={
              <>
                Hearth turns the drinking-water data your utility already
                reports — EPA&rsquo;s record of the system serving your
                address, its compliance history, lead and copper results,
                and the utility&rsquo;s annual water quality report — into a
                plain-language picture of what&rsquo;s in your tap water,
                what it means, and which treatment addresses it.
              </>
            }
            table={
              <ClassificationTable
                headers={["Situation", "What it means", "Hearth severity"]}
                rows={[
                  [
                    "private_well (you told us)",
                    "Your home is on a private well or shared private system. EPA doesn't monitor these — testing is on you.",
                    <Severity kind="neutral" key="s" />,
                  ],
                  [
                    "cws_unmapped",
                    "You said you're on city water, but EPA's map doesn't pinpoint a utility at your address (about 1 in 7 U.S. addresses). Without knowing the utility, Hearth can't read its compliance data.",
                    <Severity kind="neutral" key="s" />,
                  ],
                  [
                    "City water — nothing detected",
                    "No active health-based violations, every lead and copper sample on file is below the detection limit, and — when a report is on file — nothing in it reaches a caution level.",
                    <Severity kind="favorable" key="s" />,
                  ],
                  [
                    "City water — something detected",
                    "Any detected lead or copper, even well below the federal action level; any PFAS detection; or a contaminant at 80% or more of its federal limit.",
                    <Severity kind="caution" key="s" />,
                  ],
                  [
                    "City water — over a limit",
                    "An active health-based violation, lead or copper at or above the federal action level, or a reported contaminant at or above its federal limit.",
                    <Severity kind="concern" key="s" />,
                  ],
                  [
                    "City water — can't tell",
                    "EPA's compliance feed couldn't be read, or no lead and copper samples are on file — no positive signal either way.",
                    <Severity kind="neutral" key="s" />,
                  ],
                  [
                    "non_community",
                    "Served by a non-community system (school, campground, small business). No annual report is required; we lean on the compliance feed.",
                    <Severity kind="neutral" key="s" />,
                  ],
                  [
                    "stale",
                    "EPA returned an unexpected or inactive record for your utility. We'll retry on the next refresh.",
                    <Severity kind="neutral" key="s" />,
                  ],
                ]}
              />
            }
            sources={[
              {
                label: "EPA Community Water System Service Areas",
                href: "https://www.epa.gov/ground-water-and-drinking-water/public-water-system-service-areas",
              },
              {
                label: "EPA Envirofacts (WATER_SYSTEM / VIOLATION / LCR_SAMPLE_RESULT)",
                href: "https://www.epa.gov/enviro/envirofacts-data-service-api",
              },
              {
                label: "EPA Lead and Copper Rule",
                href: "https://www.epa.gov/dwreginfo/lead-and-copper-rule",
              },
              {
                label: "EPA Consumer Confidence Reports",
                href: "https://www.epa.gov/ccr",
              },
            ]}
            lastUpdated="September 15, 2026"
          >
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: "var(--space-2)",
                color: "var(--color-text-secondary)",
                maxWidth: "62ch",
              }}
            >
              <h3 className="h3" style={{ margin: 0 }}>
                Where the data comes from
              </h3>
              <p style={{ margin: 0 }}>
                Four EPA sources plus one from you. EPA&rsquo;s service-area
                map identifies the utility at your address; EPA&rsquo;s
                inventory record describes it; the SDWIS compliance feed
                lists violations; Lead and Copper Rule sampling gives the
                90th-percentile lead and copper results. The fifth source is
                your utility&rsquo;s annual Consumer Confidence Report, which
                a homeowner uploads once and Hearth reads into structured
                data shared with every household on that utility. If an EPA
                feed is unavailable, the finding says it couldn&rsquo;t
                check rather than implying a clean record.
              </p>
            </div>

            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: "var(--space-2)",
                color: "var(--color-text-secondary)",
                maxWidth: "62ch",
              }}
            >
              <h3 className="h3" style={{ margin: 0 }}>
                Why we trust your onboarding answer over EPA&rsquo;s map
              </h3>
              <p style={{ margin: 0 }}>
                EPA&rsquo;s map covers about six of every seven addresses;
                the gaps are mostly rural fringes, recent annexations, and
                parcels served by a city utility but mapped just outside its
                boundary. If you told us you&rsquo;re on city water, we
                believe you even when the map comes up empty — calling a
                known city-water customer a private well would be the wrong
                answer.
              </p>
            </div>

            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: "var(--space-2)",
                color: "var(--color-text-secondary)",
                maxWidth: "62ch",
              }}
            >
              <h3 className="h3" style={{ margin: 0 }}>
                When the map misses
              </h3>
              <p style={{ margin: 0 }}>
                If your exact point isn&rsquo;t inside any utility&rsquo;s
                boundary, Hearth checks a 500-meter circle around it. When
                every utility nearby is the same one, we use it and mark the
                match as inferred; you can confirm it or enter your
                utility&rsquo;s ID to correct it. When several utilities are
                nearby, we don&rsquo;t pick one.
              </p>
            </div>

            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: "var(--space-2)",
                color: "var(--color-text-secondary)",
                maxWidth: "62ch",
              }}
            >
              <h3 className="h3" style={{ margin: 0 }}>
                How severity is decided
              </h3>
              <p style={{ margin: 0 }}>
                Two axes from EPA — compliance and lead/copper — plus a
                third from your utility&rsquo;s report when one is on file.
                Concern wins immediately: an active health-based violation,
                lead or copper at or above the action level, or a reported
                contaminant at or above its limit. Otherwise any detected
                lead or copper, any PFAS, or a contaminant at 80% or more of
                its limit is caution — federal limits are regulatory
                thresholds, not health-safety ones, so a detection is worth
                knowing about at any level. Favorable requires all three axes
                clean, and a clean record with no samples on file stays
                neutral. Monitoring and reporting violations are paperwork
                between EPA and the utility and don&rsquo;t move the
                severity.
              </p>
            </div>

            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: "var(--space-2)",
                color: "var(--color-text-secondary)",
                maxWidth: "62ch",
              }}
            >
              <h3 className="h3" style={{ margin: 0 }}>
                Your utility&rsquo;s annual report
              </h3>
              <p style={{ margin: 0 }}>
                Upload the Consumer Confidence Report once and Hearth
                extracts the measured data — every detected contaminant with
                its level and limit, the lead and copper distribution, PFAS
                monitoring, and any free-testing offer — and ignores the
                brochure content. Each contaminant is matched to
                Hearth&rsquo;s reference for a plain-language description
                and an EPA link. From the detected list, a remediation
                matrix shows which filter technologies address which
                contaminants and recommends the combination with the best
                coverage. When the report lists hardness, iron, or
                manganese, that feeds your maintenance plan (see the
                Maintenance section above).
              </p>
            </div>

            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: "var(--space-2)",
                color: "var(--color-text-secondary)",
                maxWidth: "62ch",
              }}
            >
              <h3 className="h3" style={{ margin: 0 }}>
                Year-over-year trends
              </h3>
              <p style={{ margin: 0 }}>
                With more than one year&rsquo;s report on file, Hearth lines
                each contaminant up across years and shows which way
                it&rsquo;s moving — an arrow next to the number, a sparkline
                at three or more readings, and a hover chart of every reading
                against the limit the report stated <em>that</em>{" "}year. We
                compare the two most recent years with a measured value; a
                change within about 10% reads as stable so ordinary
                measurement noise doesn&rsquo;t look like a trend.
              </p>
              <p style={{ margin: 0 }}>
                Every trend states how many readings it rests on and which
                years. A year that doesn&rsquo;t list a contaminant leaves a
                gap, never a guessed value — a missing row could mean not
                detected <em>or</em>{" "}simply not printed, so Hearth never
                claims a new or cleared detection it can&rsquo;t prove. A
                contaminant still under its limit but at half the limit and
                rising is escalated to &ldquo;worth knowing&rdquo; so it
                surfaces on your dashboard; it never escalates further while
                it stays under the limit.
              </p>
            </div>
          </ModuleSection>
        </section>

        <section
          style={{
            ...sectionStyle,
            display: "flex",
            flexDirection: "column",
            gap: "var(--space-3)",
          }}
        >
          <h2
            style={{
              fontFamily: "var(--font-serif)",
              fontSize: 24,
              fontWeight: 500,
              lineHeight: 1.2,
              letterSpacing: "-0.01em",
              color: "var(--color-text-primary)",
              margin: 0,
            }}
          >
            About the data and our limitations
          </h2>
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: "var(--space-3)",
              color: "var(--color-text-secondary)",
              maxWidth: "62ch",
            }}
          >
            <p style={{ margin: 0 }}>
              Hearth's findings are interpretations of public data, not
              authoritative determinations. We pull from EPA, FEMA, Mapbox,
              and other public sources, and we apply our own classification
              logic to turn raw data into something useful. If you're making
              a decision that has legal or financial weight — buying flood
              insurance, contesting a property assessment, filing an
              environmental claim — please use Hearth as a starting point,
              not a substitute for talking to a professional in that field.
            </p>
            <p style={{ margin: 0 }}>
              When the underlying data updates, we update with it. When our
              classification logic changes, this page changes too. Anything
              Hearth tells you about your home, you can trace back to its
              source through the activity log on each finding.
            </p>
          </div>
        </section>
    </div>
  );
}
