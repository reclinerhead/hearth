/**
 * Per-site profile rendered inside the habitat finding modal's detail
 * pane. Mounted via the Superfund module's `renderDetail` slot — see
 * `lib/habitat/modules/epa-superfund-proximity/index.ts`.
 *
 * Layout (top to bottom, after the shell's back affordance):
 *   1. Site header — name + metadata pills
 *   2. Address card
 *   3. Precision caveat (when EPA's single point is a poor proxy)
 *   4. Contaminants list (enriched against contaminants/data.ts)
 *   5. "Why this severity" expandable disclosure
 *
 * No client hooks — the optional disclosure uses a native `<details>`
 * element so this component stays purely presentational and works
 * inside the modal (which is itself the "use client" boundary).
 */

import { Icon } from "@/components/icon";
import { SEVERITY_COLOR, SEVERITY_WORD } from "@/components/habitat-severity";
import { Tooltip } from "@/components/tooltip";
import {
  findContaminantByAlias,
} from "@/lib/habitat/contaminants/lookup";
import type {
  ConcernLevel,
  Contaminant,
} from "@/lib/habitat/contaminants/data";
import type { HabitatFindingRow } from "@/lib/hooks/use-habitat-findings";
import { formatArchivedDate, formatEpaRegion } from "../format";
import type { NplCode, Tier } from "../severity";
import type { SiteEntry, SuperfundFindings } from "../types";
import type { HabitatSeverity } from "@/lib/habitat/types";

/**
 * Lift findings off the loosely-typed row. Returns null for any shape
 * the modal shouldn't try to render (no findings JSON, no sites array,
 * cardId doesn't match a site).
 */
function findSite(row: HabitatFindingRow, cardId: string): SiteEntry | null {
  const findings = (row.findings ?? null) as SuperfundFindings | null;
  if (!findings || !Array.isArray(findings.sites)) return null;
  return findings.sites.find((s) => s.site.epa_id === cardId) ?? null;
}

/**
 * One contaminant row in the rendered list. `enrichment` is the
 * canonical entry when we found one; null indicates an unmatched
 * EPA string the caller should render as a fallback.
 */
type ContaminantRow = {
  raw: string;
  enrichment: Contaminant | null;
};

/**
 * Partition + sort contaminants for display. Matched entries land in
 * concern-tier groups (high → moderate → low), each sorted by their
 * canonical name. Unmatched entries are returned separately so the
 * caller can render them under their own "Other contaminants detected"
 * heading. Pure given the input array.
 */
function partitionContaminants(raw: string[]): {
  matched: { high: ContaminantRow[]; moderate: ContaminantRow[]; low: ContaminantRow[] };
  unmatched: ContaminantRow[];
} {
  const matched = {
    high: [] as ContaminantRow[],
    moderate: [] as ContaminantRow[],
    low: [] as ContaminantRow[],
  };
  const unmatched: ContaminantRow[] = [];

  for (const r of raw) {
    if (!r) continue;
    const enrichment = findContaminantByAlias(r);
    if (enrichment) {
      matched[enrichment.concern_level].push({ raw: r, enrichment });
    } else {
      unmatched.push({ raw: r, enrichment: null });
    }
  }

  const byCanonical = (a: ContaminantRow, b: ContaminantRow) =>
    (a.enrichment?.canonical_name ?? "").localeCompare(
      b.enrichment?.canonical_name ?? "",
    );
  matched.high.sort(byCanonical);
  matched.moderate.sort(byCanonical);
  matched.low.sort(byCanonical);
  unmatched.sort((a, b) => a.raw.localeCompare(b.raw));

  return { matched, unmatched };
}

export function SiteDetail({
  row,
  cardId,
}: {
  row: HabitatFindingRow;
  cardId: string;
}) {
  const entry = findSite(row, cardId);
  if (!entry) return null;

  return (
    <div className="space-y-5">
      <SiteHeader entry={entry} />
      <AddressCard entry={entry} />
      {entry.context.precision_note ? (
        <PrecisionCaveat note={entry.context.precision_note} />
      ) : null}
      <ContaminantsSection entry={entry} />
      <WhyThisSeverity entry={entry} />
    </div>
  );
}

function Pill({
  children,
  emphasizeColor,
}: {
  children: React.ReactNode;
  emphasizeColor?: string;
}) {
  return (
    <span
      className="inline-flex items-center rounded-full px-2 py-0.5 text-small"
      style={{
        backgroundColor: "var(--color-bg-surface-raised)",
        border: "1px solid var(--color-border-subtle)",
        color: emphasizeColor ?? "var(--color-text-secondary)",
        fontSize: 12,
      }}
    >
      {children}
    </span>
  );
}

/**
 * Plain-English explanation of an EPA NPL status code, surfaced as the
 * tooltip text on the NPL listing pill. Kept here (not in severity.ts)
 * because this is display copy, not severity logic.
 */
function nplStatusExplanation(code: NplCode): string {
  switch (code) {
    case "F":
      return "Final NPL — EPA has formally listed this site on the National Priorities List for federally funded long-term cleanup.";
    case "P":
      return "Proposed NPL — EPA has proposed adding this site to the National Priorities List; it is not yet a final listing.";
    case "A":
      return "Part of NPL site — this location is rolled up under a larger NPL listing nearby; it is not separately listed.";
    case "D":
      return "Deleted from NPL — cleanup is complete and EPA has removed this site from the National Priorities List.";
  }
}

/**
 * Plain-English explanation of Hearth's three-tier proximity model,
 * surfaced as the tooltip text on the Tier pill.
 */
function tierExplanation(tier: Tier): string {
  switch (tier) {
    case 1:
      return "Tier 1 — within 0.5 miles of your home (Hearth's closest community-impact ring). All NPL statuses qualify.";
    case 2:
      return "Tier 2 — between 0.5 and 2 miles of your home. Only active (Final) or Proposed NPL sites qualify at this distance.";
    case 3:
      return "Tier 3 — between 2 and 5 miles of your home. Only Final NPL sites qualify at this distance.";
  }
}

/**
 * Plain-English explanation of Hearth's severity classification for the
 * three severities the Superfund module can land on. The "favorable" /
 * "beneficial" / "critical" stops don't apply to per-site pills — those
 * are the module-level top-line severities, never per-site.
 */
function severityExplanation(severity: HabitatSeverity): string {
  switch (severity) {
    case "concern":
      return "Concern — Hearth surfaces this finding near the top of your dashboard; it represents an active environmental issue close to your home.";
    case "caution":
      return "Caution — Hearth flags this finding for attention without surfacing it at the top of your dashboard.";
    case "neutral":
      return "Neutral — Hearth notes this finding on the record but does not surface it as a concern.";
    case "favorable":
      return "Favorable — Hearth surfaces this finding as a positive signal: no qualifying issues nearby.";
    case "beneficial":
      return "Beneficial — Hearth surfaces this finding as an active positive for the area.";
    case "critical":
      return "Critical — Hearth's top severity; immediate awareness recommended.";
  }
}

function SiteHeader({ entry }: { entry: SiteEntry }) {
  const { site, context } = entry;
  const distance = `${context.distance_miles} mi ${context.bearing}`;
  return (
    <div>
      <h2 className="h2" style={{ marginTop: 0, marginBottom: "var(--space-2)" }}>
        {site.name_display}
      </h2>
      <div className="flex flex-wrap items-center gap-1.5">
        <Tooltip content={nplStatusExplanation(site.npl_status.code)} side="bottom">
          <Pill>{site.npl_status.label}</Pill>
        </Tooltip>
        <Pill>{distance}</Pill>
        <Tooltip content={tierExplanation(context.tier)} side="bottom">
          <Pill>Tier {context.tier}</Pill>
        </Tooltip>
        <Tooltip content={severityExplanation(context.severity)} side="bottom">
          <Pill emphasizeColor={SEVERITY_COLOR[context.severity]}>
            {SEVERITY_WORD[context.severity]}
          </Pill>
        </Tooltip>
      </div>
    </div>
  );
}

/**
 * One label/value row inside the quick-facts column. Label uses the
 * `eyebrow` class (uppercase, tracked, tertiary text); value is body-small
 * so it sits visually next to the address text in the left column.
 */
function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="eyebrow">{label}</div>
      <div
        className="text-small"
        style={{ color: "var(--color-text-secondary)", marginTop: 2 }}
      >
        {value}
      </div>
    </div>
  );
}

/**
 * Build the quick-facts list for the right column of the address card.
 * Returns one entry per fact actually worth showing — see the issue
 * spec for the conditional rules:
 *   - NPL listing: always present (npl_status is required on the row)
 *   - Site status: always present; date appended when archived AND a
 *     valid archive date is on the row
 *   - EPA Region: omitted when the code is missing or unparseable
 *   - Federal facility: omitted unless `federal_facility === true`
 *
 * Exported for the test suite — pure given the input.
 */
export function buildQuickFacts(site: SiteEntry["site"]): Array<{
  label: string;
  value: string;
}> {
  const facts: Array<{ label: string; value: string }> = [];

  facts.push({
    label: "NPL listing",
    value: site.npl_status.label,
  });

  if (site.archived) {
    const formattedDate = formatArchivedDate(site.archived_date ?? null);
    facts.push({
      label: "Site status",
      value: formattedDate ? `Archived ${formattedDate}` : "Archived",
    });
  } else {
    facts.push({
      label: "Site status",
      value: "Active in EPA system",
    });
  }

  const region = formatEpaRegion(site.epa_region_code ?? null);
  if (region) {
    facts.push({ label: "EPA Region", value: region });
  }

  if (site.federal_facility) {
    facts.push({ label: "Federal facility", value: "Yes" });
  }

  return facts;
}

function AddressCard({ entry }: { entry: SiteEntry }) {
  const { site } = entry;
  const { address } = site;
  const cityState = [address.city, address.state].filter(Boolean).join(", ");
  const cityStateZip = [cityState, address.zip].filter(Boolean).join(" ");
  const facts = buildQuickFacts(site);
  return (
    <div
      className="rounded-md grid grid-cols-1 sm:grid-cols-2 gap-3"
      style={{
        border: "1px solid var(--color-border-subtle)",
        padding: "var(--space-3)",
      }}
    >
      <div>
        {address.street ? (
          <div style={{ color: "var(--color-text-primary)" }}>{address.street}</div>
        ) : null}
        {cityStateZip ? (
          <div className="text-small" style={{ color: "var(--color-text-secondary)" }}>
            {cityStateZip}
          </div>
        ) : null}
        {address.county ? (
          <div className="text-small" style={{ color: "var(--color-text-tertiary)" }}>
            {address.county} County
          </div>
        ) : null}
        {site.profile_url ? (
          <div className="text-small mt-2">
            <a
              href={site.profile_url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1"
              style={{ color: "var(--color-text-secondary)" }}
            >
              <span>View on EPA&rsquo;s site</span>
              <Icon name="external-link" size={14} />
            </a>
          </div>
        ) : null}
      </div>
      <div className="flex flex-col gap-3 sm:pl-4 sm:border-l sm:border-(--color-border-subtle)">
        {facts.map((f) => (
          <Fact key={f.label} label={f.label} value={f.value} />
        ))}
      </div>
    </div>
  );
}

function PrecisionCaveat({ note }: { note: string }) {
  return (
    <div
      className="flex items-start gap-2 rounded-md"
      style={{
        backgroundColor: "var(--color-bg-surface-raised)",
        padding: "var(--space-3)",
        border: "1px solid var(--color-border-subtle)",
      }}
    >
      <span
        aria-hidden
        style={{ color: "var(--color-text-secondary)", lineHeight: 0, marginTop: 2 }}
      >
        <Icon name="info" size={16} />
      </span>
      <p
        className="text-small"
        style={{ color: "var(--color-text-secondary)", margin: 0 }}
      >
        {note}
      </p>
    </div>
  );
}

function ContaminantsSection({ entry }: { entry: SiteEntry }) {
  const { site } = entry;
  const list = site.contaminants ?? [];
  const hasAny = list.length > 0;

  return (
    <section>
      <div className="eyebrow mb-2">Contaminants</div>
      {hasAny ? (
        <ContaminantsList list={list} />
      ) : (
        <p
          className="text-small"
          style={{ color: "var(--color-text-secondary)", margin: 0 }}
        >
          EPA hasn&rsquo;t published a contaminant inventory for this site.
          Contamination details may be rolled up under the parent NPL listing
          &mdash; see the EPA profile link above.
        </p>
      )}
    </section>
  );
}

function ContaminantsList({ list }: { list: string[] }) {
  const { matched, unmatched } = partitionContaminants(list);
  const tiers: Array<{ key: ConcernLevel; rows: ContaminantRow[] }> = [
    { key: "high", rows: matched.high },
    { key: "moderate", rows: matched.moderate },
    { key: "low", rows: matched.low },
  ];
  const hasMatched = tiers.some((t) => t.rows.length > 0);
  return (
    <div className="space-y-3">
      {hasMatched
        ? tiers.map((t) =>
            t.rows.length > 0 ? (
              <ul key={t.key} className="flex flex-col gap-2">
                {t.rows.map((r) => (
                  <ContaminantItem key={r.raw} row={r} />
                ))}
              </ul>
            ) : null,
          )
        : null}
      {unmatched.length > 0 ? (
        <div>
          <div
            className="text-small mb-1"
            style={{ color: "var(--color-text-tertiary)", fontWeight: 500 }}
          >
            Other contaminants detected
          </div>
          <ul className="flex flex-col gap-1">
            {unmatched.map((r) => (
              <ContaminantItem key={r.raw} row={r} />
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

function ContaminantItem({ row }: { row: ContaminantRow }) {
  const { raw, enrichment } = row;

  if (!enrichment) {
    return (
      <li
        className="text-small"
        style={{ color: "var(--color-text-secondary)" }}
      >
        {raw}
      </li>
    );
  }

  const isHigh = enrichment.concern_level === "high";
  const isLow = enrichment.concern_level === "low";
  return (
    <li>
      <div className="flex items-baseline gap-2">
        <span
          style={{
            fontWeight: isHigh ? 500 : 400,
            color: isLow
              ? "var(--color-text-tertiary)"
              : "var(--color-text-primary)",
          }}
        >
          {enrichment.canonical_name}
        </span>
        {enrichment.common_name &&
        enrichment.common_name !== enrichment.canonical_name ? (
          <span
            className="text-small"
            style={{ color: "var(--color-text-tertiary)" }}
          >
            ({enrichment.common_name})
          </span>
        ) : null}
      </div>
      <p
        className="text-small"
        style={{ color: "var(--color-text-secondary)", margin: 0, marginTop: 2 }}
      >
        {enrichment.description}
      </p>
      <div className="text-small" style={{ marginTop: 4 }}>
        <a
          href={enrichment.epa_url}
          target="_blank"
          rel="noopener noreferrer"
          style={{ color: "var(--color-text-secondary)" }}
        >
          Learn more
        </a>
      </div>
    </li>
  );
}

function rangeLabel(tier: SiteEntry["context"]["tier"]): string {
  if (tier === 1) return "0.5";
  if (tier === 2) return "2";
  return "5";
}

function WhyThisSeverity({ entry }: { entry: SiteEntry }) {
  const { context, site } = entry;
  const range = rangeLabel(context.tier);
  const severityWord = SEVERITY_WORD[context.severity];
  return (
    <details
      className="rounded-md"
      style={{
        border: "1px solid var(--color-border-subtle)",
        padding: "var(--space-3)",
      }}
    >
      <summary
        className="text-small"
        style={{
          color: "var(--color-text-secondary)",
          fontWeight: 500,
          listStyle: "none",
        }}
      >
        Why this severity
      </summary>
      <div className="text-small mt-2" style={{ color: "var(--color-text-secondary)" }}>
        <p style={{ margin: 0 }}>
          This site qualified as Tier {context.tier} (within {range} mi of your
          home). Combined with an NPL status of {site.npl_status.label}, that
          maps to a {severityWord.toLowerCase()} finding.
        </p>
        <p style={{ margin: 0, marginTop: 8 }}>
          <a
            href="/about/classification#superfund"
            style={{ color: "var(--color-text-secondary)" }}
          >
            More about Hearth&rsquo;s classification
          </a>
        </p>
      </div>
    </details>
  );
}
