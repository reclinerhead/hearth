import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Icon } from "@/components/icon";
import { SectionHeader } from "@/components/ui";
import { SEVERITY_COLOR } from "@/components/habitat-severity";
import {
  allWaterSystemSlugs,
  resolveWaterSystemSlug,
  type PublicWaterSystemEntry,
} from "@/lib/public-pages/slugs";
import { loadPublicWaterSystem } from "@/lib/public-pages/water-data";
import {
  buildPublicWaterSummary,
  type PublicDetectedItem,
  type PublicDetectedRow,
  type PublicMetalReading,
  type PublicTrend,
  type PublicWaterSummary,
} from "@/lib/public-pages/water-summary";
import {
  sparklineGeometry,
  trendArrowPath,
} from "@/lib/habitat/water-quality/contaminants/trends";

/**
 * Public, place-keyed water quality page (epic #298, Phase 1).
 *
 * Fully static with ISR: the slug set is the hardcoded allowlist in
 * lib/public-pages/slugs.ts, `dynamicParams = false` 404s everything
 * else at the router before any data access runs, and the page
 * regenerates at most once a day. Data comes from the shared-cache
 * tables + EPA via the service-role cache wrappers (see
 * lib/public-pages/water-data.ts for the access-posture rationale);
 * the render reads only the derived PublicWaterSummary view model —
 * no admin contact, no machine identifiers, no user-contributed
 * free text (hard rules 2-4, 7 on the epic).
 */

export const revalidate = 86400; // 24h — "hours-stale is fine" per the epic
export const dynamicParams = false;

export function generateStaticParams(): Array<{ systemSlug: string }> {
  return allWaterSystemSlugs().map((systemSlug) => ({ systemSlug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ systemSlug: string }>;
}): Promise<Metadata> {
  const { systemSlug } = await params;
  const entry = resolveWaterSystemSlug(systemSlug);
  if (!entry) return {};
  const title = `${entry.shortPlace} Water Quality — What Public Records Show`;
  const description =
    `Drinking water in ${entry.placeName}: EPA's compliance record, ` +
    `lead and copper sampling, PFAS monitoring status, and the utility's ` +
    `annual water quality report — in plain language, fully cited.`;
  return {
    title: `${title} | Hearth`,
    description,
    alternates: { canonical: `/water/${entry.slug}` },
    openGraph: {
      title,
      description,
      url: `/water/${entry.slug}`,
      siteName: "Hearth",
      type: "website",
    },
    twitter: { card: "summary", title, description },
  };
}

export default async function PublicWaterSystemPage({
  params,
}: {
  params: Promise<{ systemSlug: string }>;
}) {
  const { systemSlug } = await params;
  const entry = resolveWaterSystemSlug(systemSlug);
  if (!entry) notFound();

  const data = await loadPublicWaterSystem(entry.pwsid);
  if (!data) {
    // EPA's inventory record wasn't reachable at generation time. Render
    // an honest placeholder rather than a permanent 404 — the next ISR
    // pass retries. Surfacing the miss beats a silent empty page.
    return (
      <article className="flex flex-col" style={{ gap: "var(--space-6)" }}>
        <PageHeader entry={entry} />
        <div className="surface" style={{ padding: "var(--space-5)" }}>
          <p style={{ margin: 0, color: "var(--color-text-secondary)" }}>
            EPA&apos;s record for this water system wasn&apos;t reachable when
            this page was last generated. The page refreshes automatically —
            check back soon.
          </p>
        </div>
        <SourcesSection summary={null} />
      </article>
    );
  }

  const summary = buildPublicWaterSummary(data);

  return (
    <article className="flex flex-col" style={{ gap: "var(--space-7)" }}>
      <PageHeader entry={entry} name={summary.identity.name} />
      <IdentitySection summary={summary} />
      <ComplianceSection summary={summary} entry={entry} />
      <PfasSection summary={summary} />
      <DetectedSection summary={summary} />
      <CcrSection summary={summary} entry={entry} />
      <FloodTeaser />
      <SignupBand entry={entry} />
      <SourcesSection summary={summary} />
    </article>
  );
}

/* ---------------------------------------------------------------
 * Sections
 * ------------------------------------------------------------- */

function PageHeader({
  entry,
  name,
}: {
  entry: PublicWaterSystemEntry;
  name?: string;
}) {
  return (
    <header className="flex flex-col" style={{ gap: "var(--space-3)" }}>
      <div className="eyebrow">Public water quality profile</div>
      <h1 className="h1" style={{ margin: 0 }}>
        {name ?? `${entry.shortPlace} drinking water`}
      </h1>
      <p
        style={{
          margin: 0,
          maxWidth: "62ch",
          color: "var(--color-text-secondary)",
        }}
      >
        What public records show about the drinking water serving{" "}
        {entry.placeName} — EPA&apos;s own databases plus the utility&apos;s
        annual reporting, read the way Hearth reads them for the households it
        watches over. Awareness, not alarm: this is the same report your
        utility already sends you, made easier to understand.
      </p>
    </header>
  );
}

function IdentitySection({ summary }: { summary: PublicWaterSummary }) {
  const { identity } = summary;
  const stats: Array<{ label: string; value: string }> = [
    { label: "Water source", value: identity.sourceLabel },
    {
      label: "People served",
      value:
        identity.populationServed !== null
          ? `About ${identity.populationServed.toLocaleString()}`
          : "Not on file",
    },
    {
      label: "Service connections",
      value:
        identity.serviceConnections !== null
          ? identity.serviceConnections.toLocaleString()
          : "Not on file",
    },
  ];
  return (
    <section>
      <SectionHeader eyebrow="The system" title="At a glance" />
      <div className="surface" style={{ padding: "var(--space-5)" }}>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          {stats.map((s) => (
            <div key={s.label}>
              <div className="eyebrow" style={{ marginBottom: 4 }}>
                {s.label}
              </div>
              <div
                style={{
                  fontFamily: "var(--font-serif)",
                  fontSize: 20,
                  fontWeight: 500,
                  color: "var(--color-text-primary)",
                }}
              >
                {s.value}
              </div>
            </div>
          ))}
        </div>
        {identity.sourceProtectionSinceYear !== null ? (
          <p
            className="text-small"
            style={{
              margin: "var(--space-4) 0 0",
              color: "var(--color-text-secondary)",
            }}
          >
            EPA-recognized source water protection program since{" "}
            {identity.sourceProtectionSinceYear} — a positive signal that the
            utility actively manages where its water comes from.
          </p>
        ) : null}
      </div>
    </section>
  );
}

function ComplianceSection({
  summary,
  entry,
}: {
  summary: PublicWaterSummary;
  entry: PublicWaterSystemEntry;
}) {
  const { compliance, leadCopper } = summary;
  return (
    <section>
      <SectionHeader eyebrow="EPA compliance record" title="Violations and lead & copper sampling" />
      <div
        className="surface flex flex-col"
        style={{ padding: "var(--space-5)", gap: "var(--space-4)" }}
      >
        <p style={{ margin: 0, color: "var(--color-text-secondary)" }}>
          {complianceCopy(compliance, entry)}
        </p>
        {compliance.kind === "known" && compliance.recentTotal > 0 ? (
          <p
            className="text-small"
            style={{ margin: 0, color: "var(--color-text-tertiary)" }}
          >
            EPA&apos;s violation records count paperwork and monitoring lapses
            alongside health-based issues —{" "}
            {compliance.recentHealthBased === 0
              ? "none of the recent items were health-based."
              : `${compliance.recentHealthBased} of the recent items ${
                  compliance.recentHealthBased === 1 ? "was" : "were"
                } health-based.`}
          </p>
        ) : null}
        <div className="divider" />
        <LeadCopperBlock leadCopper={leadCopper} />
      </div>
    </section>
  );
}

function complianceCopy(
  compliance: PublicWaterSummary["compliance"],
  entry: PublicWaterSystemEntry,
): string {
  if (compliance.kind === "unknown") {
    return (
      `We couldn't read EPA's compliance record for this system when the ` +
      `page was last updated — that's a data hiccup, not a statement about ` +
      `the water. The page refreshes automatically.`
    );
  }
  if (compliance.status === "active_violations") {
    return (
      `EPA currently shows at least one active health-based violation for ` +
      `the system serving ${entry.shortPlace}. The utility is required to ` +
      `notify its customers directly about violations like this; the notice ` +
      `explains what happened and what's being done.`
    );
  }
  if (compliance.recentTotal === 0) {
    return `EPA shows no violations of any kind for this system in the last five years.`;
  }
  return (
    `EPA shows no active health-based violations for this system. ` +
    `${compliance.recentTotal} item${compliance.recentTotal === 1 ? "" : "s"} ` +
    `appear${compliance.recentTotal === 1 ? "s" : ""} in EPA's records for ` +
    `the last five years, all resolved or administrative.`
  );
}

const METAL_STATE_COPY: Record<
  PublicMetalReading["state"],
  { phrase: string; color: string }
> = {
  above: {
    phrase: "at or above the federal action level",
    color: SEVERITY_COLOR.concern,
  },
  approaching: {
    phrase: "below but approaching the federal action level",
    color: SEVERITY_COLOR.caution,
  },
  detected: {
    phrase: "detected below the federal action level",
    color: SEVERITY_COLOR.caution,
  },
  below: {
    phrase: "below detection",
    color: SEVERITY_COLOR.favorable,
  },
  absent: {
    phrase: "no result on file",
    color: SEVERITY_COLOR.neutral,
  },
};

function LeadCopperBlock({
  leadCopper,
}: {
  leadCopper: PublicWaterSummary["leadCopper"];
}) {
  if (leadCopper.kind === "no_samples") {
    return (
      <p style={{ margin: 0, color: "var(--color-text-secondary)" }}>
        EPA doesn&apos;t have lead-and-copper sampling results on file for
        this system yet — sampling schedules rotate between systems, so
        that&apos;s not unusual.
      </p>
    );
  }
  if (leadCopper.kind === "unknown") {
    return (
      <p style={{ margin: 0, color: "var(--color-text-secondary)" }}>
        Lead-and-copper sampling data wasn&apos;t readable when this page was
        last updated.
      </p>
    );
  }
  const rows: Array<{ label: string; reading: PublicMetalReading | null }> = [
    { label: "Lead", reading: leadCopper.lead },
    { label: "Copper", reading: leadCopper.copper },
  ];
  return (
    <div className="flex flex-col" style={{ gap: "var(--space-3)" }}>
      <div className="eyebrow">Most recent 90th-percentile samples</div>
      {rows.map(({ label, reading }) => (
        <div
          key={label}
          className="flex flex-col sm:flex-row sm:items-baseline sm:justify-between"
          style={{ gap: "var(--space-1)" }}
        >
          <span>
            <span style={{ fontWeight: 500 }}>{label}</span>{" "}
            <span
              style={{
                color: reading
                  ? METAL_STATE_COPY[reading.state].color
                  : "var(--color-text-tertiary)",
              }}
            >
              {reading
                ? METAL_STATE_COPY[reading.state].phrase
                : "no result on file"}
            </span>
          </span>
          {reading ? (
            <span
              className="text-small"
              style={{ color: "var(--color-text-tertiary)" }}
            >
              {reading.value} {reading.unit.toLowerCase()} · action level{" "}
              {reading.actionLevelMgL} mg/l
            </span>
          ) : null}
        </div>
      ))}
      <p
        className="text-small"
        style={{ margin: 0, color: "var(--color-text-tertiary)" }}
      >
        Hearth surfaces any detection, even below EPA&apos;s action level —
        action levels are regulatory thresholds, not health-safety ones.
      </p>
    </div>
  );
}

function PfasSection({ summary }: { summary: PublicWaterSummary }) {
  const { pfas, detected } = summary;
  const statusCopy = (() => {
    if (pfas.kind === "no_data") {
      return (
        `PFAS results for this system will appear here once a recent annual ` +
        `Water Quality Report is contributed — utilities publish their PFAS ` +
        `monitoring results in that report.`
      );
    }
    if (pfas.kind === "none_reported") {
      return `The most recent report on file for this system doesn't report PFAS detections.`;
    }
    return (
      `${pfas.count} PFAS compound${pfas.count === 1 ? "" : "s"} appear${
        pfas.count === 1 ? "s" : ""
      } in the most recent report's monitoring data — ` +
      (pfas.anyAtOrAboveLimit
        ? `including at least one at or above a federal limit.`
        : `all below current federal limits. Detections at any level are worth knowing about, which is why every one is listed below rather than rounded away.`)
    );
  })();

  // The year-over-year fragment, derived — never hand-written (issue #303).
  // Only rendered when there's more than one report to compare across.
  const trendCopy = (() => {
    if (pfas.kind !== "detected") return null;
    if (detected.kind !== "available" || detected.reportsOnFile.count < 2) {
      return null;
    }
    const parts: string[] = [];
    if (pfas.falling > 0) parts.push(`${pfas.falling} trending down`);
    if (pfas.rising > 0) parts.push(`${pfas.rising} trending up`);
    if (pfas.stable > 0) parts.push(`${pfas.stable} holding stable`);
    if (pfas.inconclusive > 0) {
      parts.push(
        `${pfas.inconclusive} without enough readings to compare`,
      );
    }
    if (parts.length === 0) return null;
    const span = `${detected.reportsOnFile.firstYear}–${detected.reportsOnFile.lastYear}`;
    return `Across the ${detected.reportsOnFile.count} annual reports on file (${span}): ${parts.join(" · ")}. The per-compound readings are in the detected list below.`;
  })();

  return (
    <section>
      <SectionHeader eyebrow="In the news" title="PFAS monitoring" />
      <div
        className="surface flex flex-col"
        style={{ padding: "var(--space-5)", gap: "var(--space-3)" }}
      >
        <p style={{ margin: 0, color: "var(--color-text-secondary)" }}>
          PFAS — per- and polyfluoroalkyl substances, often called
          &ldquo;forever chemicals&rdquo; — are the contaminant family
          regulators are watching most closely right now. Utilities test for
          them under EPA&apos;s Unregulated Contaminant Monitoring Rule and
          report results in their annual water quality reports.
        </p>
        <p style={{ margin: 0 }}>{statusCopy}</p>
        {trendCopy ? (
          <p style={{ margin: 0, color: "var(--color-text-secondary)" }}>
            {trendCopy}
          </p>
        ) : null}
      </div>
    </section>
  );
}

/* ---------------------------------------------------------------
 * Detected in the water (issue #303 — full per-contaminant detail)
 *
 * Mirrors the in-app finding modal's register: serif contaminant
 * name, tier badge, mono level-vs-limit line, year-over-year trend
 * with a static SVG sparkline, editorial description, EPA link.
 * Everything rendered here comes from the PublicWaterSummary view
 * model, which only carries canonical-reference text and validated
 * numbers — no extraction free-text (epic #298 hard rule 4, as
 * amended by #303).
 * ------------------------------------------------------------- */

function DetectedSection({ summary }: { summary: PublicWaterSummary }) {
  const { detected } = summary;
  if (detected.kind !== "available") return null;
  if (detected.items.length === 0 && detected.omittedCount === 0) return null;

  const span =
    detected.reportsOnFile.count > 1
      ? `${detected.reportsOnFile.firstYear}–${detected.reportsOnFile.lastYear}`
      : `${detected.reportYear}`;

  return (
    <section>
      <SectionHeader
        eyebrow="From the annual reports"
        title="Detected in the water"
      />
      <p
        className="text-small"
        style={{
          margin: "0 0 var(--space-4)",
          color: "var(--color-text-secondary)",
          maxWidth: "62ch",
        }}
      >
        Everything the utility&apos;s {detected.reportYear} Water Quality
        Report lists as detected, each level shown against the limit the
        report measures it by
        {detected.reportsOnFile.count > 1 ? (
          <>
            {" "}
            — with the year-over-year trend across the{" "}
            {detected.reportsOnFile.count} reports on file ({span})
          </>
        ) : null}
        . Detected doesn&apos;t mean dangerous: most readings sit well below
        their limits, and the tier on each row says how Hearth reads it.
      </p>
      <ul
        className="flex flex-col"
        style={{
          listStyle: "none",
          margin: 0,
          padding: 0,
          gap: "var(--space-3)",
        }}
      >
        {detected.items.map((item, i) => (
          <DetectedItem key={i} item={item} />
        ))}
      </ul>
      {detected.omittedCount > 0 ? (
        <p
          className="text-small"
          style={{
            margin: "var(--space-3) 0 0",
            color: "var(--color-text-tertiary)",
          }}
        >
          {detected.omittedCount} more measured parameter
          {detected.omittedCount === 1 ? "" : "s"} appear
          {detected.omittedCount === 1 ? "s" : ""} in the report
          {detected.omittedAnyConcern
            ? " — including at least one at or above a federal limit"
            : ""}
          . Hearth lists a contaminant by name only once it&apos;s in our
          reviewed reference, so nothing here depends on how an uploaded
          document happens to be worded.
        </p>
      ) : null}
    </section>
  );
}

function DetectedItem({ item }: { item: PublicDetectedItem }) {
  if (item.kind === "single") {
    return (
      <li className="surface" style={{ padding: "var(--space-4)" }}>
        <DetectedRowHeader name={item.row.name} tier={item.row.tier} />
        <MeasureLine row={item.row} />
        <TrendLine trend={item.row.trend} unit={item.row.unit} />
        <p
          className="text-small"
          style={{
            margin: "var(--space-2) 0 0",
            color: "var(--color-text-secondary)",
            lineHeight: 1.55,
          }}
        >
          {item.row.description}
        </p>
        <EpaReferenceLink url={item.row.learnMoreUrl} />
      </li>
    );
  }
  return (
    <li className="surface" style={{ padding: "var(--space-4)" }}>
      <DetectedRowHeader name={item.heading} tier="caution" />
      <p
        className="text-small"
        style={{
          margin: "var(--space-2) 0 0",
          color: "var(--color-text-secondary)",
          lineHeight: 1.55,
        }}
      >
        {item.description}
      </p>
      <ul
        className="flex flex-col"
        style={{
          listStyle: "none",
          margin: "var(--space-3) 0 0",
          padding: "var(--space-3) 0 0",
          gap: "var(--space-2)",
          borderTop:
            "1px solid color-mix(in oklab, var(--color-text-tertiary) 28%, transparent)",
        }}
      >
        {item.analytes.map((a) => (
          <li key={a.name}>
            <div
              className="flex flex-col sm:flex-row sm:items-baseline sm:justify-between"
              style={{ gap: "var(--space-1)" }}
            >
              <span style={{ fontWeight: 500 }}>{a.name}</span>
              <MeasureLine row={a} inline />
            </div>
            <TrendLine trend={a.trend} unit={a.unit} />
          </li>
        ))}
      </ul>
      <EpaReferenceLink url={item.learnMoreUrl} />
    </li>
  );
}

function DetectedRowHeader({
  name,
  tier,
}: {
  name: string;
  tier: PublicDetectedRow["tier"];
}) {
  return (
    <div className="flex items-start justify-between gap-2">
      <span
        style={{
          fontFamily: "var(--font-serif)",
          fontSize: 17,
          lineHeight: 1.25,
          color: "var(--color-text-primary)",
        }}
      >
        {name}
      </span>
      <TierBadge tier={tier} />
    </div>
  );
}

/**
 * Same verbal tiers and amber/gray treatment as the in-app modal's
 * CcrTierBadge — the public page must not invent a new severity
 * language (epic hard rule 5).
 */
function TierBadge({ tier }: { tier: PublicDetectedRow["tier"] }) {
  const label =
    tier === "concern"
      ? "Worth acting on"
      : tier === "caution"
        ? "Worth knowing"
        : "Context";
  const tone =
    tier === "context"
      ? { bg: "var(--color-bg-base)", color: "var(--color-text-tertiary)" }
      : {
          bg: "color-mix(in oklab, #d97706 18%, transparent)",
          color: "#d97706",
        };
  return (
    <span
      className="rounded-full px-2 py-0.5 eyebrow shrink-0"
      style={{ backgroundColor: tone.bg, color: tone.color, fontSize: 10 }}
    >
      {label}
    </span>
  );
}

/** "3.7 ppt / 8 ppt limit" — the modal's level-vs-limit treatment. */
function MeasureLine({
  row,
  inline = false,
}: {
  row: PublicDetectedRow;
  inline?: boolean;
}) {
  const level =
    row.level === null
      ? "Detection level not reported"
      : row.unit
        ? `${row.level} ${row.unit}`
        : `${row.level}`;
  const limit =
    row.level !== null && row.limit !== null
      ? row.unit
        ? ` / ${row.limit} ${row.unit} limit`
        : ` / ${row.limit} limit`
      : "";
  return (
    <div
      className="mono text-small"
      style={{
        color: "var(--color-text-secondary)",
        marginTop: inline ? 0 : 2,
        whiteSpace: inline ? "nowrap" : undefined,
      }}
    >
      {level}
      {limit ? (
        <span style={{ color: "var(--color-text-tertiary)" }}>{limit}</span>
      ) : null}
    </div>
  );
}

/** Trend tone → page color, matching the modal's mapping. */
function trendColor(tone: PublicTrend["tone"]): string {
  if (tone === "attention") return "var(--color-accent)";
  if (tone === "positive") return "var(--color-success)";
  return "var(--color-text-tertiary)";
}

/**
 * The trend row beneath a measure line: direction arrow + word, a
 * static SVG sparkline once there are 3+ readings, the prior reading,
 * and the honest data-span caption. Server-rendered — the pure
 * geometry helpers do the math, so no client JS ships for this.
 */
function TrendLine({
  trend,
  unit,
}: {
  trend: PublicTrend | null;
  unit: string | null;
}) {
  if (!trend) return null;
  const color = trendColor(trend.tone);
  const geo =
    trend.points.length >= 3
      ? sparklineGeometry(
          trend.points.map((p) => ({ year: p.year, level: p.level, unit: null })),
          { width: 56, height: 16, padding: 2 },
        )
      : null;
  const prev = trend.previous
    ? `was ${trend.previous.level}${unit ? ` ${unit}` : ""} in ${trend.previous.year}`
    : null;
  return (
    <div
      className="flex items-center gap-2 flex-wrap"
      style={{ marginTop: 6 }}
    >
      <span className="inline-flex items-center gap-1" style={{ color }}>
        <svg viewBox="0 0 12 12" width={12} height={12} aria-hidden>
          <path
            d={trendArrowPath(trend.direction)}
            fill="none"
            stroke="currentColor"
            strokeWidth={1.4}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        <span className="text-small" style={{ fontWeight: 500 }}>
          {trend.word}
        </span>
      </span>
      {geo ? (
        <svg
          viewBox={`0 0 ${geo.width} ${geo.height}`}
          width={geo.width}
          height={geo.height}
          aria-hidden
        >
          <polyline
            points={geo.polyline}
            fill="none"
            stroke={color}
            strokeWidth={1.4}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <circle
            cx={geo.dots[geo.dots.length - 1].x}
            cy={geo.dots[geo.dots.length - 1].y}
            r={1.8}
            fill={color}
          />
        </svg>
      ) : null}
      <span
        className="text-small"
        style={{ color: "var(--color-text-tertiary)" }}
      >
        {prev ? `${prev} · ` : ""}
        {trend.spanLabel}
      </span>
    </div>
  );
}

function EpaReferenceLink({ url }: { url: string }) {
  return (
    <a
      href={url}
      rel="noopener noreferrer"
      className="mono inline-block"
      style={{
        marginTop: 8,
        fontSize: 11,
        letterSpacing: "0.02em",
        color: "var(--color-accent)",
      }}
    >
      EPA reference &rarr;
    </a>
  );
}

function CcrSection({
  summary,
  entry,
}: {
  summary: PublicWaterSummary;
  entry: PublicWaterSystemEntry;
}) {
  const { ccr } = summary;
  return (
    <section>
      <SectionHeader
        eyebrow="Annual water quality report"
        title="The utility's own reporting"
      />
      <div
        className="surface-raised flex flex-col"
        style={{ padding: "var(--space-5)", gap: "var(--space-3)" }}
      >
        {ccr.kind === "on_file" ? (
          <>
            <div className="flex items-center gap-2">
              <span style={{ color: "var(--color-accent)" }}>
                <Icon name="check" size={18} />
              </span>
              <span style={{ fontWeight: 500 }}>
                {ccr.year} Water Quality Report on file
                {summary.detected.kind === "available" &&
                summary.detected.reportsOnFile.count > 1
                  ? ` — one of ${summary.detected.reportsOnFile.count} years (${summary.detected.reportsOnFile.firstYear}–${summary.detected.reportsOnFile.lastYear})`
                  : ""}
              </span>
            </div>
            <p style={{ margin: 0, color: "var(--color-text-secondary)" }}>
              {ccr.detectedContaminantCount === 0
                ? "No measurable detections reported."
                : `${ccr.detectedContaminantCount} contaminant${
                    ccr.detectedContaminantCount === 1 ? "" : "s"
                  } tracked · ${
                    ccr.status === "at_or_above_limit"
                      ? "at least one detection at or above a federal limit"
                      : "all detections below federal limits"
                  } — the full list is above.`}
            </p>
            <p
              className="text-small"
              style={{ margin: 0, color: "var(--color-text-tertiary)" }}
            >
              Every report shared through Hearth deepens the trend history on
              this page for everyone on the system. Have a year that&apos;s
              missing?{" "}
              <Link href="/login" style={{ color: "var(--color-accent)" }}>
                Add it
              </Link>
              .
            </p>
          </>
        ) : (
          <>
            <p style={{ margin: 0 }}>
              No annual Water Quality Report has been contributed for this
              system yet. Every utility mails or posts one each year — if you
              have a copy from the utility serving {entry.shortPlace}, be the
              first to add it. Every report shared through Hearth improves this
              page for every household on the same system.
            </p>
            <div>
              <Link href="/login" className="btn btn-primary">
                Add your utility&apos;s report
                <Icon name="arrow-right" size={16} />
              </Link>
            </div>
          </>
        )}
      </div>
    </section>
  );
}

function FloodTeaser() {
  return (
    <section>
      <SectionHeader eyebrow="Beyond water" title="Flood risk is address-specific" />
      <div
        className="surface flex flex-col"
        style={{ padding: "var(--space-5)", gap: "var(--space-3)" }}
      >
        <p style={{ margin: 0, color: "var(--color-text-secondary)" }}>
          Water systems serve whole communities, but FEMA flood zones change
          parcel by parcel — a place-level page can&apos;t tell you where your
          house stands. Hearth checks your exact address against FEMA&apos;s
          flood maps, alongside radon, Superfund proximity, and the water
          profile you&apos;re reading now.
        </p>
        <div>
          <Link href="/login" className="btn btn-ghost">
            Check your exact address
            <Icon name="arrow-right" size={16} />
          </Link>
        </div>
      </div>
    </section>
  );
}

function SignupBand({ entry }: { entry: PublicWaterSystemEntry }) {
  return (
    <section
      className="surface flex flex-col items-start gap-4 sm:flex-row sm:items-center sm:justify-between"
      style={{
        padding: "var(--space-5)",
        borderColor:
          "color-mix(in oklab, var(--color-accent) 30%, var(--color-border-subtle))",
      }}
    >
      <div>
        <div className="h3" style={{ marginBottom: 4 }}>
          See this for your own house
        </div>
        <p
          className="text-small"
          style={{ margin: 0, color: "var(--color-text-secondary)" }}
        >
          {`Hearth reads the ${entry.shortPlace} data against your exact address — flood zone, radon, Superfund proximity — and adapts your home's maintenance to the water coming out of your tap.`}
        </p>
      </div>
      <Link href="/login" className="btn btn-primary" style={{ flexShrink: 0 }}>
        Get started
        <Icon name="arrow-right" size={16} />
      </Link>
    </section>
  );
}

function SourcesSection({
  summary,
}: {
  summary: PublicWaterSummary | null;
}) {
  const sources: Array<{ label: string; href: string | null }> = [
    {
      label: "EPA SDWIS / Envirofacts — water system inventory and violations",
      href: "https://www.epa.gov/enviro/sdwis-search",
    },
    {
      label: "EPA Lead and Copper Rule sampling (90th-percentile results)",
      href: "https://www.epa.gov/dwreginfo/lead-and-copper-rule",
    },
    {
      label: "EPA Unregulated Contaminant Monitoring Rule (PFAS monitoring)",
      href: "https://www.epa.gov/dwucmr",
    },
  ];
  if (summary?.ccr.kind === "on_file") {
    sources.push({
      label: `The utility's ${summary.ccr.year} Consumer Confidence Report (annual water quality report)`,
      href: null,
    });
  }
  return (
    <section>
      <SectionHeader eyebrow="Sources" title="Where this data comes from" />
      <div
        className="surface flex flex-col"
        style={{ padding: "var(--space-5)", gap: "var(--space-3)" }}
      >
        <ul
          style={{
            margin: 0,
            paddingLeft: "1.2em",
            color: "var(--color-text-secondary)",
            display: "flex",
            flexDirection: "column",
            gap: "var(--space-1)",
          }}
        >
          {sources.map((s) => (
            <li key={s.label}>
              {s.href ? (
                <a
                  href={s.href}
                  rel="noopener noreferrer"
                  style={{
                    color: "var(--color-text-secondary)",
                    textDecoration: "underline",
                  }}
                >
                  {s.label}
                </a>
              ) : (
                s.label
              )}
            </li>
          ))}
        </ul>
        <p
          className="text-small"
          style={{ margin: 0, color: "var(--color-text-tertiary)" }}
        >
          About this data: compiled from public EPA records and utility
          reporting; this page regenerates at most once a day, so recent
          changes can take a day to appear. Hearth is not affiliated with EPA
          or with this utility, and this page is not a substitute for the
          utility&apos;s own notices.{" "}
          <Link
            href="/how-it-works"
            style={{ color: "var(--color-text-secondary)", textDecoration: "underline" }}
          >
            How Hearth reads these sources
          </Link>
          .
        </p>
      </div>
    </section>
  );
}
