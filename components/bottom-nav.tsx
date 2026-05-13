"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Icon, type IconName } from "./icon";

type Tab = { href: string; label: string; icon: IconName };

const TABS: Tab[] = [
  { href: "/dashboard", label: "Dashboard", icon: "layout-dashboard" },
  { href: "/home-details", label: "Home", icon: "home" },
  { href: "/appliances", label: "Appliances", icon: "device-tv-old" },
  { href: "/habitat", label: "Habitat", icon: "leaf" },
];

function isActive(pathname: string, href: string) {
  if (href === "/dashboard") return pathname === "/dashboard";
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function BottomNav() {
  const pathname = usePathname() ?? "";

  return (
    <nav
      aria-label="Primary"
      className="md:hidden fixed inset-x-0 bottom-0 z-30"
      style={{
        height: "calc(var(--nav-bottom-h) + env(safe-area-inset-bottom, 0px))",
        paddingBottom: "env(safe-area-inset-bottom, 0px)",
        backgroundColor:
          "color-mix(in oklab, var(--color-bg-base) 88%, transparent)",
        borderTop: "1px solid var(--color-border-subtle)",
        backdropFilter: "blur(12px)",
      }}
    >
      <ul
        className="grid h-[var(--nav-bottom-h)] items-stretch"
        style={{ gridTemplateColumns: "1fr 1fr 1fr 1fr 1fr" }}
      >
        {/* Left two tabs */}
        {TABS.slice(0, 2).map((t) => (
          <TabLink key={t.href} tab={t} active={isActive(pathname, t.href)} />
        ))}

        {/* Center Add button */}
        <li className="relative flex items-center justify-center">
          <button
            type="button"
            aria-label="Add"
            className="absolute -top-5 flex h-14 w-14 items-center justify-center rounded-full"
            style={{
              backgroundColor: "var(--color-accent)",
              color: "var(--color-bg-base)",
              boxShadow:
                "0 8px 24px -8px color-mix(in oklab, var(--color-accent) 60%, transparent)",
            }}
          >
            <Icon name="plus" size={22} />
          </button>
        </li>

        {/* Right two tabs */}
        {TABS.slice(2).map((t) => (
          <TabLink key={t.href} tab={t} active={isActive(pathname, t.href)} />
        ))}
      </ul>
    </nav>
  );
}

function TabLink({ tab, active }: { tab: Tab; active: boolean }) {
  return (
    <li>
      <Link
        href={tab.href}
        className="flex h-full flex-col items-center justify-center gap-1"
        style={{
          color: active
            ? "var(--color-text-primary)"
            : "var(--color-text-tertiary)",
        }}
      >
        <Icon name={tab.icon} size={20} />
        <span style={{ fontSize: 10, fontWeight: 500, letterSpacing: 0.2 }}>
          {tab.label}
        </span>
        {active ? (
          <span
            aria-hidden
            className="mt-0.5 h-[2px] w-5 rounded-full"
            style={{ backgroundColor: "var(--color-accent)" }}
          />
        ) : (
          <span aria-hidden className="mt-0.5 h-[2px] w-5" />
        )}
      </Link>
    </li>
  );
}
