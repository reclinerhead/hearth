import Link from "next/link";
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
    <main
      className="flex min-h-dvh flex-col items-center justify-center px-6"
      style={{
        background:
          "radial-gradient(900px 600px at 50% -10%, color-mix(in oklab, var(--color-accent) 12%, transparent), transparent 60%)",
      }}
    >
      <div className="flex items-center gap-2 mb-6">
        <span style={{ color: "var(--color-accent)" }}>
          <Icon name="flame" size={28} aria-label="Hearth" />
        </span>
        <span
          style={{
            fontFamily: "var(--font-serif)",
            fontSize: 28,
            fontWeight: 500,
          }}
        >
          Hearth
        </span>
      </div>
      <h1
        className="h1 text-center max-w-xl"
        style={{ marginBottom: "var(--space-3)" }}
      >
        Your home, documented.
      </h1>
      <p
        className="text-center max-w-md"
        style={{ color: "var(--color-text-secondary)" }}
      >
        A calm place for everything you know about your house — appliances,
        documents, maintenance, and the world around it.
      </p>
      <Link href="/login" className="btn btn-primary mt-8">
        Sign in
        <Icon name="arrow-right" size={16} />
      </Link>
    </main>
  );
}
