"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Icon } from "@/components/icon";

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
    <main
      className="flex min-h-dvh flex-col items-center justify-center px-6"
      style={{
        background: `
          radial-gradient(560px 440px at 50% 50%, color-mix(in oklab, var(--color-accent) 20%, transparent), transparent 70%),
          var(--color-bg-base)
        `,
      }}
    >
      <div className="w-full max-w-sm">
        <div className="flex flex-col items-center gap-2 mb-8">
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

        <div className="surface p-5 sm:p-6">
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
