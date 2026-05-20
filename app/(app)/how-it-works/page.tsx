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

const PAGE_MAX_WIDTH = 760;

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
            a reason to be remembered. Each item lives in a room (rooms are
            seeded for every house and can be renamed, added, or removed).
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
            The fastest path is a photo. Hearth's Smart Uploader accepts a
            photo of a nameplate, label, or appliance and uses AI to figure
            out what it's looking at, pull structured facts off the label
            (manufacturer, model, serial, install date when visible, plus
            other useful facts like capacity or fuel type), and pre-fill an
            inventory entry that you confirm or edit before saving. Items
            can also be created manually. Additional photos, manuals,
            receipts, and other documents attach to an item over time.
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
            Each item has a detail page that surfaces the captured facts as
            visual pills, the photos that document it, and an on-demand
            "Research this model" panel that uses an AI search to look up
            what's generally known about appliances and systems like yours —
            typical service life, common maintenance, things to watch for —
            with source links so you can verify.
          </p>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <h3 className="h3" style={{ margin: 0 }}>
            What it's for
          </h3>
          <p
            style={{
              margin: 0,
              color: "var(--color-text-secondary)",
            }}
          >
            The inventory is the foundation Hearth's other surfaces lean on.
            Maintenance tasks (coming soon — see below) attach to inventory
            items. Future surfaces like a pre-listing export, warranty
            tracking, and service history all expect a real inventory
            underneath them.
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
              label: "xAI Grok — nameplate analysis",
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
        Last updated: May 20, 2026
      </div>
    </section>
  );
}

/**
 * Maintenance "coming soon" teaser. Sits between the active Inventory
 * section and the habitat modules. Deliberately lighter than a full
 * `ModuleSection` — no thumbnail box, no sources, no last-updated — so
 * a reader can tell at a glance that this is a preview, not a
 * documented module. Will be promoted to a real section when the
 * maintenance module ships.
 */
function MaintenanceTeaser() {
  return (
    <section
      id="maintenance"
      style={{
        ...sectionStyle,
        display: "flex",
        flexDirection: "column",
        gap: "var(--space-3)",
        padding: "var(--space-4)",
        borderRadius: "var(--radius-md)",
        border: "1px dashed var(--color-border-subtle)",
        backgroundColor:
          "color-mix(in oklab, var(--color-bg-surface-raised) 30%, transparent)",
      }}
    >
      <div
        style={{
          display: "flex",
          gap: "var(--space-3)",
          alignItems: "flex-start",
        }}
      >
        <span
          style={{
            color: "var(--color-text-tertiary)",
            marginTop: 4,
            flexShrink: 0,
          }}
          aria-hidden
        >
          <Icon name="tool" size={22} />
        </span>
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: "var(--space-2)",
            minWidth: 0,
            maxWidth: "62ch",
          }}
        >
          <div className="eyebrow">Coming soon</div>
          <h2
            style={{
              fontFamily: "var(--font-serif)",
              fontSize: 22,
              fontWeight: 500,
              lineHeight: 1.2,
              letterSpacing: "-0.01em",
              color: "var(--color-text-primary)",
              margin: 0,
            }}
          >
            Maintenance is coming
          </h2>
          <p
            style={{
              margin: 0,
              color: "var(--color-text-secondary)",
            }}
          >
            Hearth's maintenance system will surface the recurring tasks
            every home needs — seasonal work, replacement schedules, things
            that need attention before they fail — tied to the specific
            items in your inventory rather than a generic checklist. A water
            heater Hearth knows the age of can tell you when to flush it; a
            furnace Hearth knows the install date of can tell you when its
            next service is due. We'll update this page when the module
            ships.
          </p>
        </div>
      </div>
    </section>
  );
}

const PILLARS: { title: string; body: string }[] = [
  {
    title: "Emergency procedures",
    body:
      "Where to shut off water, gas, and electrical in an emergency. Hearth keeps this accessible the moment you need it.",
  },
  {
    title: "Inventory",
    body:
      "A record of your home's systems and major items — appliances, fixtures, structural details — with manuals, warranties, and service history.",
  },
  {
    title: "Maintenance",
    body:
      "Seasonal tasks, replacement schedules, and reminders for the things that need attention before they fail.",
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
        maxWidth: PAGE_MAX_WIDTH,
        margin: "0 auto",
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

        <MaintenanceTeaser />

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
            lastUpdated="May 18, 2026"
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
                How Hearth's model relates to EPA's guidance
              </h3>
              <p style={{ margin: 0 }}>
                EPA uses 1-mile and 3-mile rings in its community-involvement
                work near Superfund sites. Hearth's 0.5 / 2 / 5 mile tiers
                are not EPA's published rings — they're our own synthesis
                informed by EPA's community-involvement practice, calibrated
                to surface meaningful proximity at the homeowner level. We
                use three tiers instead of two because the homeowner
                experience of being half a mile from an active cleanup is
                meaningfully different from being two miles away.
              </p>
              <p style={{ margin: 0 }}>
                EPA does not publish a "community-impact rings" standard; if
                you see a Hearth Superfund finding citing tier
                classifications, those are Hearth's, not EPA's.
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
                EPA publishes a single representative point per Superfund
                site, even for sites that span miles (rivers, multi-location
                complexes). Some sites are large enough that the "distance
                to your home" we compute could be off by miles from the
                actual site footprint. When this is the case, the finding's
                detail pane shows a precision note. The Allied Paper /
                Portage Creek / Kalamazoo River site is the canonical
                example.
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
