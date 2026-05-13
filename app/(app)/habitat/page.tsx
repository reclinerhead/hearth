import { AICard, AskAboutStrip, SectionHeader } from "@/components/ui";

export default function HabitatPage() {
  return (
    <div className="flex flex-col gap-5">
      <SectionHeader
        eyebrow="The world around your house"
        title="Habitat"
        trailing={
          <span
            className="text-small"
            style={{ color: "var(--color-text-tertiary)" }}
          >
            Updated Apr 14
          </span>
        }
      />

      <AskAboutStrip
        scopeLabel="this location"
        placeholder="Is my neighborhood in a high-radon zone? What about flood risk?"
      />

      <div className="grid gap-4 md:grid-cols-2">
        <AICard eyebrow="EPA radon zone" title="Zone 1 — high">
          Washtenaw County is in EPA Zone 1, the highest of three radon
          potential tiers. The EPA recommends testing every 2 years; a
          short-term kit costs around $15 and pairs with mail-in lab analysis.
        </AICard>

        <AICard eyebrow="Lead disclosure" title="Pre-1978 — assume present">
          Your house pre-dates the 1978 federal ban on lead-based paint.
          Disclosure is required at sale; if you renovate, follow EPA RRP
          rules. A simple wipe test can confirm presence on suspect surfaces.
        </AICard>

        <AICard eyebrow="FEMA flood zone" title="Zone X — minimal">
          The parcel sits outside the 500-year floodplain. NFIP insurance
          isn&apos;t federally required, though private add-on coverage may be
          worth considering given basement utilities.
        </AICard>

        <AICard eyebrow="Soil & drainage" title="Loam over clay">
          USDA web soil survey shows Miami loam transitioning to clay around
          24&quot; deep. That tracks with the slow basement drying you&apos;d
          expect in spring — keep gutters extended at least 4 ft from the
          foundation.
        </AICard>
      </div>

      <AICard
        eyebrow="What we know about your location"
        title="Ann Arbor, Washtenaw County, MI"
      >
        <p>
          The lot is on the southern slope of a wooded ridge in the Burns Park
          neighborhood. Average winter low is 16&deg;F and the heating season
          runs roughly Oct&nbsp;15&nbsp;–&nbsp;Apr&nbsp;10. The 2024 average
          electricity rate from DTE was about 18.3&cent;/kWh, with summer peak
          pricing in effect Jun&nbsp;–&nbsp;Sep.
        </p>
        <p className="mt-2">
          The closest fire station is Station&nbsp;3 on Stadium Boulevard,
          roughly 1.1&nbsp;miles north. Trash and recycling pick up
          Wednesdays; yard waste runs Apr&nbsp;–&nbsp;Nov.
        </p>
      </AICard>
    </div>
  );
}
