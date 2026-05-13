import { Icon, type IconName } from "@/components/icon";
import { EntityRow, SectionHeader } from "@/components/ui";

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
    meta: "Filter due Aug 2026 · MFI2570FEZ",
    href: "/entities/maytag-fridge",
  },
  {
    icon: "device-tv-old",
    name: "Maytag dishwasher",
    type: "Kitchen",
    meta: "Pump replaced Dec 2024 · MDB4949SHZ0",
    href: "/entities/maytag-dishwasher",
  },
  {
    icon: "flame-burner",
    name: "GE gas range",
    type: "Kitchen",
    meta: "Installed Mar 2020 · JGB735SPSS",
    href: "/entities/ge-range",
  },
  {
    icon: "wind",
    name: "Trane central AC",
    type: "Side yard",
    meta: "Serviced Apr 2025 · 4TTR4030L",
    href: "/entities/trane-ac",
  },
  {
    icon: "flame-burner",
    name: "Carrier furnace",
    type: "Basement",
    meta: "Tune-up due Oct 2026 · 59TN6",
    href: "/entities/carrier-furnace",
  },
  {
    icon: "droplet",
    name: "Rheem water heater",
    type: "Basement",
    meta: "Installed Sep 2021 · XE50T06",
    href: "/entities/rheem-water-heater",
  },
  {
    icon: "tool",
    name: "Whirlpool washer",
    type: "Laundry",
    meta: "Belt replaced Feb 2024 · WTW5000DW",
    href: "/entities/whirlpool-washer",
  },
  {
    icon: "tool",
    name: "Whirlpool dryer",
    type: "Laundry",
    meta: "Vent cleaned Jan 2025 · WED5000DW",
    href: "/entities/whirlpool-dryer",
  },
  {
    icon: "shield",
    name: "Nest Protect (kitchen)",
    type: "Kitchen ceiling",
    meta: "Battery good · Installed May 2023",
    href: "/entities/nest-protect-kitchen",
  },
  {
    icon: "shield",
    name: "Nest Protect (hallway)",
    type: "Upstairs hallway",
    meta: "Battery good · Installed May 2023",
    href: "/entities/nest-protect-hallway",
  },
];

export default function AppliancesPage() {
  return (
    <div className="flex flex-col gap-5">
      <SectionHeader
        eyebrow="Everything you own that matters"
        title="Appliances"
        trailing={
          <span
            className="text-small"
            style={{ color: "var(--color-text-tertiary)" }}
          >
            {APPLIANCES.length} entities
          </span>
        }
      />

      <div className="flex flex-wrap items-center gap-2">
        <div
          className="relative flex items-center"
          style={{ minWidth: 220 }}
        >
          <span
            aria-hidden
            className="absolute left-3"
            style={{ color: "var(--color-text-tertiary)" }}
          >
            <Icon name="search" size={16} />
          </span>
          <input
            type="search"
            placeholder="Search appliances…"
            className="input"
            style={{ paddingLeft: 36 }}
          />
        </div>
        <button type="button" className="btn btn-ghost">
          <Icon name="filter" size={16} />
          Filter
        </button>
        <button type="button" className="btn btn-ghost">
          <Icon name="chevron-down" size={16} />
          Sort: by room
        </button>
        <div className="ml-auto">
          <button type="button" className="btn btn-primary">
            <Icon name="plus" size={16} />
            Add appliance
          </button>
        </div>
      </div>

      <div className="grid gap-2 sm:grid-cols-2">
        {APPLIANCES.map((a) => (
          <EntityRow key={a.name} {...a} />
        ))}
      </div>
    </div>
  );
}
