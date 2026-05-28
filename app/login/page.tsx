"use client";

import { useState } from "react";
import Image from "next/image";
import { createClient } from "@/lib/supabase/client";
import { Icon } from "@/components/icon";

const heroEdgeFade =
  "linear-gradient(to bottom, transparent 0%, black 14%, black 86%, transparent 100%)";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "error">(
    "idle",
  );
  const [errorMessage, setErrorMessage] = useState("");

  const supabase = createClient();

  async function handleMagicLink(e: React.FormEvent) {
    e.preventDefault();
    setStatus("sending");
    setErrorMessage("");

    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: `${window.location.origin}/auth/callback`,
      },
    });

    if (error) {
      setStatus("error");
      setErrorMessage(error.message);
    } else {
      setStatus("sent");
    }
  }

  async function handleGoogleSignIn() {
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}/auth/callback`,
      },
    });

    if (error) {
      setErrorMessage(error.message);
    }
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
        alt=""
        aria-hidden
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

      <div className="relative z-10 flex min-h-dvh items-center justify-center px-4">
        <div
          className="w-full max-w-sm"
          style={{
            backgroundColor:
              "color-mix(in oklab, var(--color-bg-base) 78%, transparent)",
            backdropFilter: "blur(4px)",
            WebkitBackdropFilter: "blur(4px)",
            padding: "var(--space-6) var(--space-7)",
            borderRadius: "var(--radius-lg)",
            border:
              "1px solid color-mix(in oklab, var(--color-border-subtle) 70%, transparent)",
            boxShadow:
              "0 24px 60px -20px color-mix(in oklab, black 55%, transparent), 0 8px 20px -8px color-mix(in oklab, black 40%, transparent)",
          }}
        >
          <div className="flex flex-col items-center gap-2 mb-6">
            <span style={{ color: "var(--color-accent)" }}>
              <Icon name="flame" size={24} aria-label="Hearth" />
            </span>
            <h1
              className="h1"
              style={{ fontSize: "var(--text-h2)", letterSpacing: 0 }}
            >
              Hearth
            </h1>
            <p
              className="text-small"
              style={{ color: "var(--color-text-secondary)" }}
            >
              Your home, documented.
            </p>
          </div>

          <button
            type="button"
            onClick={handleGoogleSignIn}
            className="btn btn-ghost w-full"
            style={{ height: 40 }}
          >
            Continue with Google
          </button>

          <div className="relative my-5 flex items-center">
            <span
              className="flex-1 h-px"
              style={{ backgroundColor: "var(--color-border-subtle)" }}
            />
            <span
              className="px-3 eyebrow"
              style={{ color: "var(--color-text-tertiary)" }}
            >
              or
            </span>
            <span
              className="flex-1 h-px"
              style={{ backgroundColor: "var(--color-border-subtle)" }}
            />
          </div>

          {status === "sent" ? (
            <div
              className="surface p-4 text-small"
              style={{
                backgroundColor:
                  "color-mix(in oklab, var(--color-success) 14%, var(--color-bg-surface))",
                borderColor:
                  "color-mix(in oklab, var(--color-success) 30%, var(--color-border-subtle))",
                color: "var(--color-text-primary)",
              }}
            >
              Check your email for the sign-in link.
            </div>
          ) : (
            <form onSubmit={handleMagicLink} className="space-y-3">
              <div>
                <label className="label" htmlFor="email">
                  Email
                </label>
                <input
                  id="email"
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  className="input"
                />
              </div>
              <button
                type="submit"
                disabled={status === "sending"}
                className="btn btn-primary w-full"
                style={{ height: 40 }}
              >
                {status === "sending" ? "Sending…" : "Send magic link"}
              </button>
            </form>
          )}

          {errorMessage && (
            <div
              className="surface mt-4 p-3 text-small"
              style={{
                backgroundColor:
                  "color-mix(in oklab, var(--color-danger) 12%, var(--color-bg-surface))",
                borderColor:
                  "color-mix(in oklab, var(--color-danger) 30%, var(--color-border-subtle))",
              }}
            >
              {errorMessage}
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
