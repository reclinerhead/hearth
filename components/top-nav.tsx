"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { setActiveHouseAction } from "@/app/actions/houses/set-active-house";
import type { UserCapabilities } from "@/lib/houses/capabilities";
import type { EditableHouseRow } from "./edit-home-details-modal";
import { Icon } from "./icon";
import { PropertySwitcher, type HouseSummary } from "./property-switcher";
import { SmartUploader } from "./smart-uploader/SmartUploader";
import { ThemeToggle } from "./theme-toggle";

// The top nav reads the address-chip subset of the house row for its
// PropertySwitcher chip + the account-menu property submenu. The shape
// is currently wider than strictly needed because the (app) layout
// also passes the same row to surfaces that mount the Property Details
// edit modal — which now lives on the dashboard rather than here, per
// issue #110. Trimming the layout's query and narrowing this type is
// follow-up cleanup; the over-fetch is one row of column data and
// costs effectively nothing.
export type TopNavHouse = EditableHouseRow;

// The account menu's "Switch property" entry swaps the menu contents
// for an inline property list with a back affordance. This keeps mobile
// switching usable when the PropertySwitcher dropdown is hidden by the
// md breakpoint; desktop users get the same affordance redundantly,
// which is fine for a single-touch interaction.
type MenuView = "root" | "properties";

export function TopNav({
  house,
  houses,
  capabilities,
}: {
  house: TopNavHouse | null;
  houses: HouseSummary[];
  capabilities: UserCapabilities;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuView, setMenuView] = useState<MenuView>("root");
  const [uploaderOpen, setUploaderOpen] = useState(false);
  const [pendingHouseId, setPendingHouseId] = useState<string | null>(null);
  const [isSwitchPending, startSwitchTransition] = useTransition();
  const menuRef = useRef<HTMLDivElement | null>(null);
  const router = useRouter();

  // Closing the menu always resets the submenu view so the next open
  // starts at root rather than the last-viewed pane. Routing the reset
  // through a single `closeMenu` callback (rather than a state-watching
  // effect) avoids the cascading-render warning that fires when you
  // setState in an effect body.
  const closeMenu = useCallback(() => {
    setMenuOpen(false);
    setMenuView("root");
  }, []);

  useEffect(() => {
    if (!menuOpen) return;
    function onClick(e: MouseEvent) {
      if (!menuRef.current?.contains(e.target as Node)) {
        closeMenu();
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") closeMenu();
    }
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [menuOpen, closeMenu]);

  function handleMenuSwitch(houseId: string) {
    if (houseId === house?.id) {
      closeMenu();
      return;
    }
    setPendingHouseId(houseId);
    startSwitchTransition(async () => {
      const res = await setActiveHouseAction(houseId);
      if (res && !res.ok) {
        console.error("setActiveHouseAction (menu) failed", res.error);
        setPendingHouseId(null);
      }
    });
  }

  const activeChipHouse: HouseSummary | null = house
    ? {
        id: house.id,
        address_line1: house.address_line1,
        city: house.city,
        state: house.state,
      }
    : null;

  return (
    <>
      <header
        className="sticky top-0 z-30 backdrop-blur-md"
        style={{
          height: "var(--nav-top-h)",
          backgroundColor:
            "color-mix(in oklab, var(--color-bg-base) 80%, transparent)",
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
              Hearth - Awareness
            </span>
          </Link>

          {activeChipHouse ? (
            <PropertySwitcher
              activeHouse={activeChipHouse}
              houses={houses}
              capabilities={capabilities}
            />
          ) : null}

          <div className="ml-auto flex items-center gap-2">
            <button
              type="button"
              className="btn btn-primary hidden md:inline-flex"
              aria-label="Add to Hearth"
              onClick={() => house && setUploaderOpen(true)}
              disabled={!house}
            >
              <Icon name="plus" size={16} />
              <span>Add</span>
            </button>

            <ThemeToggle className="hidden sm:inline-flex" />

            <div className="relative" ref={menuRef}>
              <button
                type="button"
                className="flex items-center gap-2 rounded-full p-0.5 pr-2"
                style={{ border: "1px solid var(--color-border-subtle)" }}
                onClick={() => (menuOpen ? closeMenu() : setMenuOpen(true))}
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
                  className="absolute right-0 mt-2 w-64 surface-raised p-1 shadow-lg"
                  style={{ borderRadius: "var(--radius-md)", zIndex: 50 }}
                >
                  {menuView === "root" ? (
                    <RootMenu
                      houses={houses}
                      capabilities={capabilities}
                      onOpenProperties={() => setMenuView("properties")}
                      onClose={closeMenu}
                    />
                  ) : (
                    <PropertiesSubmenu
                      activeHouseId={house?.id ?? null}
                      houses={houses}
                      pendingHouseId={pendingHouseId}
                      isPending={isSwitchPending}
                      onBack={() => setMenuView("root")}
                      onSelect={handleMenuSwitch}
                    />
                  )}
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </header>

      {house ? (
        <SmartUploader
          open={uploaderOpen}
          onOpenChange={setUploaderOpen}
          houseId={house.id}
          onSaved={(result) => {
            // The top-nav uploader is always a discovery-mode mount (no
            // targetInventoryId), so a save here always means the user just
            // created — or matched into — an inventory item from the global
            // "+ Add" flow. Land them on that item's detail page rather than
            // only refreshing in place (issue #262). router.push to the
            // detail route is a fresh server-rendered load, so it replaces
            // the old router.refresh() outright — no separate refresh needed.
            // The attach-to-existing path returns the matched item's id, so
            // this correctly lands on "where your photo went" too.
            router.push(`/inventory/${result.inventoryId}`);
          }}
        />
      ) : null}
    </>
  );
}

function RootMenu({
  houses,
  capabilities,
  onOpenProperties,
  onClose,
}: {
  houses: HouseSummary[];
  capabilities: UserCapabilities;
  onOpenProperties: () => void;
  onClose: () => void;
}) {
  return (
    <>
      {/* Edit property details lives on the property page itself now
          (pencil icon next to the address) per issue #110, so it no
          longer occupies a slot in this account-scoped menu.          */}

      {/* Switch + add entries — mobile parity for the PropertySwitcher in
          the header, which is hidden below md. Visible on desktop too
          so the menu reads the same regardless of viewport.            */}
      {capabilities.canSwitchHouses && houses.length >= 2 ? (
        <button
          type="button"
          role="menuitem"
          onClick={onOpenProperties}
          className="flex w-full items-center gap-2 rounded px-3 py-2 text-left hover:bg-[color:var(--color-bg-surface)]"
        >
          <Icon name="map-pin" size={16} />
          <span className="flex-1">Switch property</span>
          <Icon name="chevron-right" size={14} />
        </button>
      ) : null}

      {capabilities.canCreateAdditionalHouse ? (
        <Link
          href="/houses/new"
          role="menuitem"
          onClick={onClose}
          className="flex w-full items-center gap-2 rounded px-3 py-2 text-left hover:bg-[color:var(--color-bg-surface)]"
          style={{ color: "var(--color-text-primary)" }}
        >
          <Icon name="plus" size={16} />
          <span>Add a property</span>
        </Link>
      ) : null}

      <div className="sm:hidden">
        <ThemeToggleMenuItem onClick={onClose} />
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
    </>
  );
}

function PropertiesSubmenu({
  activeHouseId,
  houses,
  pendingHouseId,
  isPending,
  onBack,
  onSelect,
}: {
  activeHouseId: string | null;
  houses: HouseSummary[];
  pendingHouseId: string | null;
  isPending: boolean;
  onBack: () => void;
  onSelect: (houseId: string) => void;
}) {
  return (
    <>
      <button
        type="button"
        onClick={onBack}
        className="flex w-full items-center gap-2 rounded px-3 py-2 text-left hover:bg-[color:var(--color-bg-surface)]"
        style={{ color: "var(--color-text-secondary)" }}
      >
        <Icon name="chevron-left" size={14} />
        <span className="text-small">Account menu</span>
      </button>
      <div
        className="eyebrow px-3 pt-2 pb-1"
        style={{ color: "var(--color-text-tertiary)" }}
      >
        Your properties
      </div>
      {houses.map((h) => {
        const isActive = h.id === activeHouseId;
        const itemPending = isPending && pendingHouseId === h.id;
        return (
          <button
            key={h.id}
            type="button"
            role="menuitem"
            onClick={() => onSelect(h.id)}
            disabled={isPending && !itemPending}
            className="flex w-full items-center gap-2 rounded px-3 py-2 text-left hover:bg-[color:var(--color-bg-surface)] disabled:opacity-60"
            style={{ color: "var(--color-text-primary)" }}
          >
            <span
              aria-hidden
              className="flex h-5 w-5 shrink-0 items-center justify-center"
              style={{ color: "var(--color-accent)" }}
            >
              {itemPending ? (
                <MenuSpinner />
              ) : isActive ? (
                <Icon name="circle-check" size={16} />
              ) : null}
            </span>
            <span className="min-w-0 flex-1">
              <span
                className="block truncate"
                style={{ fontSize: 14, fontWeight: isActive ? 500 : 400 }}
              >
                {h.address_line1 ?? "Untitled property"}
              </span>
              <span
                className="block truncate text-small"
                style={{ color: "var(--color-text-tertiary)" }}
              >
                {[h.city, h.state].filter(Boolean).join(", ")}
              </span>
            </span>
          </button>
        );
      })}
    </>
  );
}

function MenuSpinner() {
  return (
    <span
      aria-label="Switching"
      role="status"
      className="inline-block animate-spin"
      style={{
        width: 14,
        height: 14,
        border: "2px solid color-mix(in oklab, var(--color-accent) 30%, transparent)",
        borderTopColor: "var(--color-accent)",
        borderRadius: "50%",
      }}
    />
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
