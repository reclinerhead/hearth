import {
  AICard,
  EmergencyTile,
  EntityRow,
  MetricCard,
  PlaceholderImage,
  SectionHeader,
} from "@/components/ui";
import { Icon, type IconName } from "@/components/icon";
import { DocumentTrigger, SAMPLE_DOCUMENT } from "@/components/document-modal";

const HOUSE_FACTS: { eyebrow: string; value: string; meta?: string; icon: IconName }[] = [
  { eyebrow: "Built", value: "1934", meta: "91 years old", icon: "calendar" },
  { eyebrow: "Living area", value: "1,840 sf", meta: "2 floors + finished attic", icon: "ruler" },
  { eyebrow: "Lot", value: "0.18 ac", meta: "7,840 sf", icon: "map-pin" },
  { eyebrow: "Bedrooms", value: "3", meta: "+ office nook", icon: "bed" },
  { eyebrow: "Bathrooms", value: "1.5", meta: "Original 1934 + 1972 half", icon: "bath" },
  { eyebrow: "Owned since", value: "Aug 2019", meta: "6 years", icon: "key" },
];

const APPLIANCES: {
  icon: IconName;
  name: string;
  type: string;
  meta: string;
  href: string;
}[] = [
  {
    icon: "fridge",
    name: "Maytag refrigerator",
    type: "Kitchen",
    meta: "Filter due in 3 mo",
    href: "/entities/maytag-fridge",
  },
  {
    icon: "droplet",
    name: "Rheem water heater",
    type: "Basement",
    meta: "Installed Sep 2021",
    href: "/entities/rheem-water-heater",
  },
  {
    icon: "flame-burner",
    name: "Carrier furnace",
    type: "Basement",
    meta: "Tune-up due Oct 2026",
    href: "/entities/carrier-furnace",
  },
  {
    icon: "wind",
    name: "Trane central AC",
    type: "Side yard",
    meta: "Last serviced Apr 2025",
    href: "/entities/trane-ac",
  },
  {
    icon: "device-tv-old",
    name: "Maytag dishwasher",
    type: "Kitchen",
    meta: "Pump replaced Dec 2024",
    href: "/entities/maytag-dishwasher",
  },
];

const EMERGENCIES: { icon: IconName; label: string; hint: string }[] = [
  { icon: "droplet", label: "Water shutoff", hint: "Basement, NE corner" },
  { icon: "flame-burner", label: "Gas shutoff", hint: "Meter, side yard" },
  { icon: "bolt", label: "Electrical panel", hint: "Basement, by stairs" },
];

export default function DashboardPage() {
  return (
    <div className="flex flex-col gap-6">
      {/* Hero */}
      <section className="grid gap-4 md:grid-cols-2">
        <div className="surface overflow-hidden">
          <PlaceholderImage
            ratio="4 / 3"
            label="604 Norton Drive"
            icon="home"
          />
        </div>
        <div className="flex flex-col gap-3">
          <div>
            <div className="eyebrow">Your house</div>
            <h1 className="h1" style={{ marginTop: 4 }}>
              604 Norton Drive
            </h1>
            <p
              className="text-small mt-1"
              style={{ color: "var(--color-text-secondary)" }}
            >
              Ann Arbor, Michigan
            </p>
          </div>
          <div className="grid gap-2 sm:gap-3 grid-cols-2 sm:grid-cols-3">
            {HOUSE_FACTS.map((f) => (
              <MetricCard key={f.eyebrow} {...f} />
            ))}
          </div>
        </div>
      </section>

      {/* Bottom two columns */}
      <section className="grid gap-4 md:grid-cols-2">
        {/* Left column */}
        <div className="flex flex-col gap-4">
          {/* Emergencies */}
          <div>
            <SectionHeader
              eyebrow="If something goes wrong"
              title="Emergencies"
              trailing={
                <span
                  className="text-small"
                  style={{ color: "var(--color-text-tertiary)" }}
                >
                  3 saved
                </span>
              }
            />
            <div className="grid grid-cols-2 gap-3">
              {EMERGENCIES.map((e) => (
                <EmergencyTile key={e.label} {...e} />
              ))}
              <EmergencyTile
                icon="plus"
                label="Add an emergency"
                hint="Pin a shutoff or hazard"
                variant="add"
              />
            </div>
          </div>

          {/* Habitat */}
          <div>
            <SectionHeader
              eyebrow="The world around your house"
              title="Habitat"
            />
            <div className="flex flex-col gap-2">
              <HabitatRow
                label="EPA radon zone"
                value="Zone 1 (high)"
                detail="Testing recommended within first year of occupancy."
              />
              <HabitatRow
                label="Lead disclosure"
                value="Pre-1978 structure"
                detail="Federal disclosure required at sale; assume lead paint."
              />
              <HabitatRow
                label="FEMA flood zone"
                value="Zone X (minimal)"
                detail="Outside the 500-year floodplain; no NFIP required."
              />
            </div>
          </div>
        </div>

        {/* Right column — Appliances */}
        <div>
          <SectionHeader
            eyebrow="Things that need a little attention"
            title="Appliances"
            trailing={
              <a
                href="/appliances"
                className="text-small inline-flex items-center gap-1"
                style={{ color: "var(--color-text-secondary)" }}
              >
                See all
                <Icon name="chevron-right" size={14} />
              </a>
            }
          />
          <div className="flex flex-col gap-2">
            {APPLIANCES.map((a) => (
              <EntityRow key={a.name} {...a} />
            ))}
          </div>

          <div className="mt-4">
            <DocumentTrigger
              document={SAMPLE_DOCUMENT}
              className="btn btn-ghost w-full justify-start"
            >
              <Icon name="file-text" size={16} />
              <span className="truncate">
                View latest document — drain pump receipt
              </span>
              <span
                aria-hidden
                className="ml-auto"
                style={{ color: "var(--color-text-tertiary)" }}
              >
                <Icon name="chevron-right" size={14} />
              </span>
            </DocumentTrigger>
          </div>
        </div>
      </section>
    </div>
  );
}

function HabitatRow({
  label,
  value,
  detail,
}: {
  label: string;
  value: string;
  detail: string;
}) {
  return (
    <AICard
      eyebrow={label}
      title={
        <span
          style={{
            fontFamily: "var(--font-serif)",
            fontSize: 18,
            fontWeight: 500,
          }}
        >
          {value}
        </span>
      }
    >
      {detail}
    </AICard>
  );
}
