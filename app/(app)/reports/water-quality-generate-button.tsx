"use client";

import { useState } from "react";
import { Icon } from "@/components/icon";

/**
 * Generate action for the Water Quality Report card (issue #207) — the one
 * live report on the /reports hub. Synchronous-with-spinner per the issue's
 * latency decision: the first generation per data change is multi-second
 * (headless Chromium); cached serves return fast. We fetch the route, then
 * trigger a client-side download of the returned PDF blob so the filename
 * and UX stay in our control.
 *
 * Errors are surfaced inline rather than swallowed — a 422 ("no CCR data
 * yet") or a transient render failure tells the user what happened.
 */

const ROUTE = "/api/reports/water-quality";

export function WaterQualityGenerateButton() {
  const [status, setStatus] = useState<"idle" | "loading" | "error">("idle");
  const [message, setMessage] = useState<string | null>(null);

  async function handleGenerate() {
    setStatus("loading");
    setMessage(null);
    try {
      const res = await fetch(ROUTE, { method: "GET" });
      if (!res.ok) {
        let detail = "We couldn't generate your report. Please try again.";
        try {
          const body = (await res.json()) as { error?: string };
          if (body.error) detail = body.error;
        } catch {
          // non-JSON error body; keep the default message
        }
        setStatus("error");
        setMessage(detail);
        return;
      }

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "Hearth Water Quality Report.pdf";
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      setStatus("idle");
    } catch {
      setStatus("error");
      setMessage("Something went wrong. Please try again.");
    }
  }

  const loading = status === "loading";

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "var(--space-2)",
        marginTop: "auto",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "flex-end",
        }}
      >
        <button
          type="button"
          className="btn btn-primary"
          onClick={handleGenerate}
          disabled={loading}
          aria-busy={loading}
          style={loading ? { opacity: 0.8 } : undefined}
        >
          {loading ? (
            <>
              <span
                aria-hidden
                className="animate-spin"
                style={{
                  width: 13,
                  height: 13,
                  borderRadius: "50%",
                  border: "2px solid color-mix(in oklab, var(--color-bg-base) 45%, transparent)",
                  borderTopColor: "var(--color-bg-base)",
                  display: "inline-block",
                }}
              />
              Generating&hellip;
            </>
          ) : (
            <>
              Generate
              <Icon name="arrow-right" size={14} />
            </>
          )}
        </button>
      </div>

      {status === "error" && message ? (
        <p
          className="text-small"
          role="alert"
          style={{ margin: 0, color: "var(--color-danger)", textAlign: "right" }}
        >
          {message}
        </p>
      ) : null}
    </div>
  );
}
