import Link from "next/link";
import { Icon } from "@/components/icon";
import { TODDTECH_HEARTH_URL } from "@/lib/reports/constants";

/**
 * Public route group layout (epic #298, Phase 0). No AppShell, no
 * session read — every page under (public) must stay statically
 * renderable, so this layout never touches cookies() or Supabase.
 * The sign-in CTA is a plain link; /login already routes authed
 * users onward.
 */
export default function PublicLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-dvh flex flex-col">
      <header
        style={{
          borderBottom: "1px solid var(--color-border-subtle)",
          backgroundColor:
            "color-mix(in oklab, var(--color-bg-base) 92%, transparent)",
        }}
      >
        <div
          className="flex items-center justify-between"
          style={{
            maxWidth: 860,
            margin: "0 auto",
            padding: "var(--space-3) var(--space-4)",
          }}
        >
          <Link
            href="/"
            className="flex items-center gap-2"
            aria-label="Hearth home"
          >
            <span style={{ color: "var(--color-accent)" }}>
              <Icon name="flame" size={20} />
            </span>
            <span
              style={{
                fontFamily: "var(--font-serif)",
                fontSize: 20,
                fontWeight: 500,
                color: "var(--color-text-primary)",
              }}
            >
              Hearth
            </span>
          </Link>
          <Link href="/login" className="btn btn-ghost">
            Sign in
          </Link>
        </div>
      </header>

      <main className="flex-1 w-full">
        <div
          style={{
            maxWidth: 860,
            margin: "0 auto",
            padding: "var(--space-7) var(--space-4) var(--space-8)",
          }}
        >
          {children}
        </div>
      </main>

      <footer
        style={{ borderTop: "1px solid var(--color-border-subtle)" }}
      >
        <div
          className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between"
          style={{
            maxWidth: 860,
            margin: "0 auto",
            padding: "var(--space-4)",
            fontSize: "var(--text-small)",
            color: "var(--color-text-tertiary)",
          }}
        >
          <span>
            Hearth — home awareness · Powered by{" "}
            <a
              href={TODDTECH_HEARTH_URL}
              style={{
                color: "var(--color-text-secondary)",
                textDecoration: "underline",
              }}
            >
              ToddTech
            </a>
          </span>
          <span className="flex items-center gap-4">
            <Link
              href="/how-it-works"
              style={{ color: "var(--color-text-secondary)" }}
            >
              How Hearth works
            </Link>
            <Link
              href="/login"
              style={{ color: "var(--color-text-secondary)" }}
            >
              Sign in
            </Link>
          </span>
        </div>
      </footer>
    </div>
  );
}
