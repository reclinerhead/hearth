"use client";

import Link from "next/link";
import { useEffect, useRef, useState, useTransition } from "react";
import { setActiveHouseAction } from "@/app/actions/houses/set-active-house";
import type { UserCapabilities } from "@/lib/houses/capabilities";
import { Icon } from "./icon";

/**
 * Shape consumed by both the header PropertySwitcher and the account-menu
 * Switch-property submenu. The (app) layout queries `hearth.houses` for
 * just these four columns so the per-request cost stays small.
 */
export type HouseSummary = {
  id: string;
  address_line1: string | null;
  city: string | null;
  state: string | null;
};

/**
 * Header property switcher. Replaces the static address chip when the
 * user can either switch between properties (>=2 houses) or add another
 * one. Static, non-interactive chip for everyone else — matches the
 * pre-multi-house visual exactly. Hidden on small viewports; the
 * account-menu submenu provides mobile parity (see TopNav).
 *
 * Render states:
 *   - canSwitch=false AND canCreate=false → static chip (legacy visual)
 *   - canSwitch=true OR  canCreate=true  → button trigger + dropdown
 */
export function PropertySwitcher({
  activeHouse,
  houses,
  capabilities,
}: {
  activeHouse: HouseSummary;
  houses: HouseSummary[];
  capabilities: UserCapabilities;
}) {
  const [open, setOpen] = useState(false);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const wrapperRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    function onClick(e: MouseEvent) {
      if (!wrapperRef.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const isInteractive =
    capabilities.canSwitchHouses || capabilities.canCreateAdditionalHouse;

  if (!isInteractive) {
    return <AddressChip house={activeHouse} interactive={false} />;
  }

  function handleSelect(houseId: string) {
    if (houseId === activeHouse.id) {
      setOpen(false);
      return;
    }
    setPendingId(houseId);
    // The server action redirects to /dashboard on success; on
    // navigation the component unmounts and the pending state clears
    // with it. If the action returns an error result (rare — RLS
    // ownership check failed or a network blip), the spinner persists
    // until the user closes the dropdown. A toast surface for that
    // failure mode is deferred to a follow-up.
    startTransition(async () => {
      const res = await setActiveHouseAction(houseId);
      if (res && !res.ok) {
        console.error("setActiveHouseAction failed", res.error);
        setPendingId(null);
      }
    });
  }

  return (
    <div ref={wrapperRef} className="relative hidden md:block">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="flex items-center gap-1 rounded-full px-2 py-1 text-[color:var(--color-text-tertiary)] truncate transition-colors"
        style={{
          fontSize: 13,
          border: "1px solid var(--color-border-subtle)",
          backgroundColor: open
            ? "var(--color-bg-surface)"
            : "transparent",
        }}
      >
        <span style={{ color: "var(--color-border-emphasis)" }}>·</span>
        <Icon name="map-pin" size={14} />
        <span className="truncate max-w-[280px]">
          {formatAddress(activeHouse)}
        </span>
        <Icon name="chevron-down" size={12} />
      </button>

      {open ? (
        <div
          role="menu"
          className="absolute left-0 mt-2 w-72 surface-raised p-1 shadow-lg"
          style={{ borderRadius: "var(--radius-md)", zIndex: 50 }}
        >
          <div
            className="eyebrow px-3 pt-2 pb-1"
            style={{ color: "var(--color-text-tertiary)" }}
          >
            Your properties
          </div>
          {houses.map((h) => (
            <PropertyMenuItem
              key={h.id}
              house={h}
              isActive={h.id === activeHouse.id}
              isPending={isPending && pendingId === h.id}
              disabled={isPending}
              onSelect={() => handleSelect(h.id)}
            />
          ))}
          {capabilities.canCreateAdditionalHouse ? (
            <>
              <div className="divider my-1" />
              <Link
                href="/houses/new"
                role="menuitem"
                onClick={() => setOpen(false)}
                className="flex w-full items-center gap-2 rounded px-3 py-2 text-left hover:bg-[color:var(--color-bg-surface)]"
                style={{ color: "var(--color-text-primary)" }}
              >
                <Icon name="plus" size={16} />
                <span>Add a property</span>
              </Link>
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function PropertyMenuItem({
  house,
  isActive,
  isPending,
  disabled,
  onSelect,
}: {
  house: HouseSummary;
  isActive: boolean;
  isPending: boolean;
  disabled: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onSelect}
      disabled={disabled && !isPending}
      className="flex w-full items-center gap-2 rounded px-3 py-2 text-left hover:bg-[color:var(--color-bg-surface)] disabled:opacity-60"
      style={{ color: "var(--color-text-primary)" }}
    >
      <span
        aria-hidden
        className="flex h-5 w-5 shrink-0 items-center justify-center"
        style={{ color: "var(--color-accent)" }}
      >
        {isPending ? (
          <Spinner size={14} />
        ) : isActive ? (
          <Icon name="circle-check" size={16} />
        ) : null}
      </span>
      <span className="min-w-0 flex-1">
        <span
          className="block truncate"
          style={{ fontSize: 14, fontWeight: isActive ? 500 : 400 }}
        >
          {house.address_line1 ?? "Untitled property"}
        </span>
        <span
          className="block truncate text-small"
          style={{ color: "var(--color-text-tertiary)" }}
        >
          {[house.city, house.state].filter(Boolean).join(", ")}
        </span>
      </span>
    </button>
  );
}

/**
 * The legacy single-house static chip. Rendered for users who can
 * neither switch nor add — kept visually identical to the pre-#100
 * top-nav address chip so free-tier accounts don't suddenly grow a
 * dropdown affordance.
 */
function AddressChip({
  house,
  interactive,
}: {
  house: HouseSummary;
  interactive: boolean;
}) {
  if (interactive) return null;
  return (
    <div
      className="hidden md:flex items-center gap-1 text-[color:var(--color-text-tertiary)] truncate"
      style={{ fontSize: 13 }}
    >
      <span style={{ color: "var(--color-border-emphasis)" }}>·</span>
      <Icon name="map-pin" size={14} />
      <span className="truncate">{formatAddress(house)}</span>
    </div>
  );
}

function formatAddress(house: HouseSummary): string {
  const parts = [
    house.address_line1,
    [house.city, house.state].filter(Boolean).join(" "),
  ].filter(Boolean);
  return parts.join(", ");
}

function Spinner({ size = 14 }: { size?: number }) {
  return (
    <span
      aria-label="Switching"
      role="status"
      className="inline-block animate-spin"
      style={{
        width: size,
        height: size,
        border: "2px solid color-mix(in oklab, var(--color-accent) 30%, transparent)",
        borderTopColor: "var(--color-accent)",
        borderRadius: "50%",
      }}
    />
  );
}
