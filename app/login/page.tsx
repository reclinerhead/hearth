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
            <svg
              width={18}
              height={18}
              viewBox="0 0 24 24"
              aria-hidden
              focusable={false}
            >
              <path
                fill="#4285F4"
                d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
              />
              <path
                fill="#34A853"
                d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
              />
              <path
                fill="#FBBC05"
                d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
              />
              <path
                fill="#EA4335"
                d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
              />
            </svg>
            Sign in with Google
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
