"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Icon } from "./icon";
import { ThemeToggle } from "./theme-toggle";

export type TopNavHouse = {
  address_line1: string;
  city: string;
  state: string;
} | null;

export function TopNav({ house }: { house: TopNavHouse }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!menuOpen) return;
    function onClick(e: MouseEvent) {
      if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setMenuOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [menuOpen]);

  return (
    <header
      className="sticky top-0 z-30 backdrop-blur-md"
      style={{
        height: "var(--nav-top-h)",
        backgroundColor: "color-mix(in oklab, var(--color-bg-base) 80%, transparent)",
        borderBottom: "1px solid var(--color-border-subtle)",
      }}
    >
      <div className="mx-auto flex h-full items-center gap-3 px-4 md:px-6">
        <Link
          href="/dashboard"
          className="flex items-center gap-2 text-[color:var(--color-text-primary)]"
        >
          <span
            style={{ color: "var(--color-accent)" }}
            className="inline-flex items-center justify-center"
          >
            <Icon name="flame" size={16} aria-label="Hearth" />
          </span>
          <span
            style={{
              fontFamily: "var(--font-serif)",
              fontSize: 16,
              fontWeight: 500,
              letterSpacing: "-0.005em",
            }}
          >
            Hearth
          </span>
        </Link>

        {house ? (
          <div
            className="hidden md:flex items-center gap-1 text-[color:var(--color-text-tertiary)] truncate"
            style={{ fontSize: 13 }}
          >
            <span style={{ color: "var(--color-border-emphasis)" }}>·</span>
            <Icon name="map-pin" size={14} />
            <span className="truncate">
              {house.address_line1}, {house.city} {house.state}
            </span>
          </div>
        ) : null}

        <div className="ml-auto flex items-center gap-2">
          <button
            type="button"
            className="btn btn-primary hidden md:inline-flex"
            aria-label="Add to Hearth"
          >
            <Icon name="plus" size={16} />
            <span>Add</span>
          </button>
          <button
            type="button"
            className="btn btn-primary btn-icon md:hidden"
            aria-label="Add to Hearth"
          >
            <Icon name="plus" size={18} />
          </button>

          <ThemeToggle className="hidden sm:inline-flex" />

          <div className="relative" ref={menuRef}>
            <button
              type="button"
              className="flex items-center gap-2 rounded-full p-0.5 pr-2"
              style={{ border: "1px solid var(--color-border-subtle)" }}
              onClick={() => setMenuOpen((v) => !v)}
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              aria-label="Account menu"
            >
              <span
                className="flex h-7 w-7 items-center justify-center rounded-full"
                style={{
                  backgroundColor: "var(--color-bg-surface-raised)",
                  color: "var(--color-text-secondary)",
                }}
              >
                <Icon name="user" size={14} />
              </span>
              <Icon name="chevron-down" size={14} />
            </button>

            {menuOpen ? (
              <div
                role="menu"
                className="absolute right-0 mt-2 w-56 surface-raised p-1 shadow-lg"
                style={{ borderRadius: "var(--radius-md)", zIndex: 50 }}
              >
                <Link
                  href="/home-details"
                  role="menuitem"
                  className="flex items-center gap-2 rounded px-3 py-2 hover:bg-[color:var(--color-bg-surface)]"
                  onClick={() => setMenuOpen(false)}
                >
                  <Icon name="home" size={16} />
                  <span>Home details</span>
                </Link>
                <div className="sm:hidden">
                  <ThemeToggleMenuItem onClick={() => setMenuOpen(false)} />
                </div>
                <button
                  type="button"
                  role="menuitem"
                  className="flex w-full items-center gap-2 rounded px-3 py-2 text-left hover:bg-[color:var(--color-bg-surface)]"
                >
                  <Icon name="settings" size={16} />
                  <span>Settings</span>
                </button>
                <div className="divider my-1" />
                <form action="/auth/signout" method="post">
                  <button
                    type="submit"
                    role="menuitem"
                    className="flex w-full items-center gap-2 rounded px-3 py-2 text-left hover:bg-[color:var(--color-bg-surface)]"
                  >
                    <Icon name="logout" size={16} />
                    <span>Sign out</span>
                  </button>
                </form>
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </header>
  );
}

function ThemeToggleMenuItem({ onClick }: { onClick: () => void }) {
  return (
    <div
      className="flex items-center justify-between rounded px-3 py-2"
      role="menuitem"
    >
      <span className="text-[color:var(--color-text-secondary)] text-sm">
        Theme
      </span>
      <span onClick={onClick} className="contents">
        <ThemeToggle />
      </span>
    </div>
  );
}
