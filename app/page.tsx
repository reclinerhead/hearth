import Link from "next/link";
import Image from "next/image";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Icon } from "@/components/icon";

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
      <Image
        src="/landing/hero-mobile.png"
        alt="Architectural sketch of a home with Hearth annotation panels showing air quality, home facts, water quality, and ground risk."
        width={832}
        height={1248}
        priority
        sizes="(min-width: 768px) 0px, 100vw"
        className="absolute left-0 top-1/2 w-full h-auto -translate-y-1/2 md:hidden"
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
      />

      <div className="relative z-10 flex min-h-dvh items-center justify-center px-4">
        <div
          className="w-full max-w-lg text-center"
          style={{
            backgroundColor:
              "color-mix(in oklab, var(--color-bg-base) 90%, transparent)",
            backdropFilter: "blur(2px)",
            WebkitBackdropFilter: "blur(2px)",
            padding: "var(--space-6) var(--space-7)",
            borderRadius: "var(--radius-lg)",
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
      </div>
    </main>
  );
}
