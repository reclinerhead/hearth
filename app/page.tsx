import Link from "next/link";
import Image from "next/image";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Icon } from "@/components/icon";
import { PUBLIC_WATER_SYSTEMS } from "@/lib/public-pages/slugs";

const heroEdgeFade =
  "linear-gradient(to bottom, transparent 0%, black 14%, black 86%, transparent 100%)";

/**
 * Frosted-glass card treatment shared by the hero card and the
 * public-water panel so the two read as one composed column over the
 * house sketch rather than two unrelated boxes.
 */
const glassCard: React.CSSProperties = {
  backgroundColor: "color-mix(in oklab, var(--color-bg-base) 88%, transparent)",
  backdropFilter: "blur(3px)",
  WebkitBackdropFilter: "blur(3px)",
  borderRadius: "var(--radius-lg)",
  border:
    "1px solid color-mix(in oklab, var(--color-border-subtle) 70%, transparent)",
  boxShadow:
    "0 24px 60px -20px color-mix(in oklab, black 55%, transparent), 0 8px 20px -8px color-mix(in oklab, black 40%, transparent)",
};

export default async function Home() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user) {
    redirect("/dashboard");
  }

  return (
    <main className="relative min-h-dvh w-full overflow-hidden">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background: `
            radial-gradient(140% 90% at 50% 50%, color-mix(in oklab, var(--color-accent) 9%, transparent), transparent 62%),
            var(--color-bg-base)
          `,
        }}
      />

      <Image
        src="/landing/hero-mobile.png"
        alt="Architectural sketch of a home with Hearth annotation panels showing air quality, home facts, water quality, and ground risk."
        width={832}
        height={1248}
        priority
        sizes="(min-width: 768px) 0px, 100vw"
        className="absolute left-0 top-1/2 w-full h-auto -translate-y-1/2 md:hidden"
        style={{
          maskImage: heroEdgeFade,
          WebkitMaskImage: heroEdgeFade,
        }}
      />

      <Image
        src="/landing/hero.png"
        alt=""
        aria-hidden
        width={1360}
        height={768}
        priority
        sizes="(min-width: 768px) 100vw, 0px"
        className="absolute left-0 top-1/2 hidden w-full h-auto -translate-y-1/2 md:block"
        style={{
          maskImage: heroEdgeFade,
          WebkitMaskImage: heroEdgeFade,
        }}
      />

      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(120% 80% at 50% 120%, transparent 40%, color-mix(in oklab, black 35%, transparent) 100%)",
        }}
      />

      <div className="relative z-10 flex min-h-dvh items-center justify-center px-4 py-8">
        <div className="w-full max-w-lg flex flex-col gap-4">
          <div
            className="text-center"
            style={{
              ...glassCard,
              padding: "var(--space-6) var(--space-7)",
            }}
          >
            <div className="flex items-center justify-center gap-2 mb-5">
              <span style={{ color: "var(--color-accent)" }}>
                <Icon name="flame" size={24} aria-label="Hearth" />
              </span>
              <span
                style={{
                  fontFamily: "var(--font-serif)",
                  fontSize: 26,
                  fontWeight: 500,
                  color: "var(--color-text-primary)",
                }}
              >
                Hearth
              </span>
            </div>

            <h1 className="h1" style={{ marginBottom: "var(--space-3)" }}>
              Your home, documented.
            </h1>

            <p
              style={{
                color: "var(--color-text-secondary)",
                marginBottom: "var(--space-5)",
              }}
            >
              A calm place for everything you know about your house — appliances,
              documents, maintenance, and the world around it.
            </p>

            <Link href="/login" className="btn btn-primary">
              Sign in
              <Icon name="arrow-right" size={16} />
            </Link>
          </div>

          <section
            aria-labelledby="public-water-heading"
            style={{
              ...glassCard,
              padding: "var(--space-4) var(--space-5)",
            }}
          >
            <div className="flex items-center gap-2">
              <span style={{ color: "var(--color-accent)" }}>
                <Icon name="droplet" size={16} aria-hidden />
              </span>
              <h2 id="public-water-heading" className="eyebrow">
                Public water quality
              </h2>
            </div>
            <p
              className="text-small mt-2"
              style={{ color: "var(--color-text-secondary)" }}
            >
              No account needed. Hearth publishes the latest results from its
              Water Quality Awareness module for these cities. Each opens in a
              new window.
            </p>

            <ul className="mt-3 grid gap-2 sm:grid-cols-2">
              {PUBLIC_WATER_SYSTEMS.map((system) => (
                <li key={system.slug}>
                  <a
                    href={`/water/${system.slug}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="group flex items-center justify-between gap-3 rounded-md border px-3 py-2.5 transition-colors hover:bg-(--color-bg-surface-raised) hover:border-(--color-border-emphasis) focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--color-accent)"
                    style={{
                      borderColor:
                        "color-mix(in oklab, var(--color-border-subtle) 70%, transparent)",
                    }}
                  >
                    <span className="flex min-w-0 flex-col">
                      <span
                        className="font-medium"
                        style={{ color: "var(--color-text-primary)" }}
                      >
                        {system.placeName}
                      </span>
                      <span
                        className="text-small"
                        style={{ color: "var(--color-text-tertiary)" }}
                      >
                        Latest public water quality results
                      </span>
                    </span>
                    <span
                      className="shrink-0 transition-colors group-hover:text-(--color-accent)"
                      style={{ color: "var(--color-text-tertiary)" }}
                    >
                      <Icon name="external-link" size={16} aria-hidden />
                      <span className="sr-only">(opens in a new window)</span>
                    </span>
                  </a>
                </li>
              ))}
            </ul>
          </section>
        </div>
      </div>
    </main>
  );
}
