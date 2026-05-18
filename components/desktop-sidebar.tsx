"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Icon, type IconName } from "./icon";

type Item = { href: string; label: string; icon: IconName };

const ITEMS: Item[] = [
  { href: "/dashboard", label: "Dashboard", icon: "layout-dashboard" },
  { href: "/home-details", label: "Home details", icon: "home" },
  { href: "/appliances", label: "Home inventory", icon: "device-tv-old" },
];

function isActive(pathname: string, href: string) {
  if (href === "/dashboard") return pathname === "/dashboard";
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function DesktopSidebar() {
  const pathname = usePathname() ?? "";

  return (
    <aside
      aria-label="Primary"
      className="hidden md:flex flex-col shrink-0 sticky"
      style={{
        top: "var(--nav-top-h)",
        height: "calc(100dvh - var(--nav-top-h))",
        width: "var(--sidebar-w)",
        borderRight: "1px solid var(--color-border-subtle)",
        padding: "var(--space-5) var(--space-3)",
        gap: "var(--space-1)",
      }}
    >
      <nav>
        <ul className="flex flex-col gap-1">
          {ITEMS.map((item) => {
            const active = isActive(pathname, item.href);
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  className="flex items-center gap-3 rounded-md px-3 py-2"
                  style={{
                    color: active
                      ? "var(--color-text-primary)"
                      : "var(--color-text-secondary)",
                    backgroundColor: active
                      ? "var(--color-bg-surface-raised)"
                      : "transparent",
                    border: active
                      ? "1px solid var(--color-border-subtle)"
                      : "1px solid transparent",
                    fontSize: 14,
                    fontWeight: active ? 500 : 400,
                  }}
                >
                  <Icon name={item.icon} size={18} />
                  <span>{item.label}</span>
                  {active ? (
                    <span
                      aria-hidden
                      className="ml-auto h-1.5 w-1.5 rounded-full"
                      style={{ backgroundColor: "var(--color-accent)" }}
                    />
                  ) : null}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      <div className="mt-auto">
        <div
          className="surface p-3"
          style={{
            backgroundColor: "var(--color-bg-surface-ai)",
            borderColor:
              "color-mix(in oklab, var(--color-accent) 22%, var(--color-border-subtle))",
          }}
        >
          <div className="flex items-center gap-2 mb-1">
            <span style={{ color: "var(--color-accent)" }}>
              <Icon name="sparkles" size={14} />
            </span>
            <span className="eyebrow">Day One Briefing</span>
          </div>
          <p
            className="text-small"
            style={{ color: "var(--color-text-secondary)" }}
          >
            We&apos;ll surface what we know about your house as soon as
            you&apos;ve added a few details.
          </p>
        </div>
      </div>
    </aside>
  );
}
