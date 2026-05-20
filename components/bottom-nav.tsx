"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Icon, type IconName } from "./icon";

type Tab = { href: string; label: string; icon: IconName };

// Home details is edited from the top-nav account menu (modal), not a
// bottom-nav destination. Three equal tabs: Dashboard | Inventory |
// How it Works. The earlier floating "+" Add button was a non-functional
// placeholder and was removed when the bar gained a third real destination.
const TABS: Tab[] = [
  { href: "/dashboard", label: "Dashboard", icon: "layout-dashboard" },
  { href: "/inventory", label: "Inventory", icon: "device-tv-old" },
  { href: "/how-it-works", label: "How it Works", icon: "info" },
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
        style={{ gridTemplateColumns: "1fr 1fr 1fr" }}
      >
        {TABS.map((t) => (
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
