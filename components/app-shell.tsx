import type { ReactNode } from "react";
import type { UserCapabilities } from "@/lib/houses/capabilities";
import { TopNav, type TopNavHouse } from "./top-nav";
import { BottomNav } from "./bottom-nav";
import { DesktopSidebar } from "./desktop-sidebar";

export function AppShell({
  children,
  house,
  capabilities,
}: {
  children: ReactNode;
  house: TopNavHouse | null;
  capabilities: UserCapabilities;
}) {
  return (
    <div className="flex flex-col min-h-dvh">
      <TopNav house={house} capabilities={capabilities} />
      <div className="flex flex-1 min-h-0">
        <DesktopSidebar />
        <main
          className="flex-1 min-w-0"
          style={{
            paddingBottom:
              "calc(var(--nav-bottom-h) + env(safe-area-inset-bottom, 0px) + 16px)",
          }}
        >
          <div
            className="mx-auto w-full"
            style={{
              maxWidth: "var(--content-max)",
              padding: "var(--space-5) var(--space-4) var(--space-7)",
            }}
          >
            {children}
          </div>
        </main>
      </div>
      <BottomNav />
    </div>
  );
}
