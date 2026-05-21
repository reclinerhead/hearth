"use client";

import { useState, useTransition } from "react";
import { AddressAutofill, useConfirmAddress } from "@mapbox/search-js-react";
import { Icon } from "@/components/icon";
import { createHouseFromMapboxFeature } from "./actions";
import type { MapboxRetrievedFeature } from "./extract-address";

// `@mapbox/search-js-react@1.5` types `children: React.ReactChild`, which was
// removed from @types/react in v19, and `@mapbox/search-js-core` is only a
// transitive dependency so we can't import its response type here. Re-type
// the component locally with the shape we actually consume.
type RetrieveResponse = { features?: MapboxRetrievedFeature[] };
type AutofillProps = {
  accessToken: string;
  options?: { country?: string; language?: string };
  onRetrieve?: (res: RetrieveResponse) => void;
  children: React.ReactNode;
};
const Autofill = AddressAutofill as unknown as React.FC<AutofillProps>;

const MAPBOX_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN ?? "";

// The form is shared between /onboarding (first house) and /houses/new
// (adding a subsequent property). The only user-visible difference is
// the submit button text; everything else — Mapbox flow, confirmation
// minimap, server action — is identical, so reuse beats fork. The
// default keeps the existing onboarding copy unchanged.
export function AddressForm({
  submitLabel = "Set up my house",
}: { submitLabel?: string } = {}) {
  const [streetValue, setStreetValue] = useState("");
  const [feature, setFeature] = useState<MapboxRetrievedFeature | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const { formRef, showConfirm } = useConfirmAddress({
    minimap: true,
    skipConfirmModal: (f) =>
      ["exact", "high"].includes(f.properties?.match_code?.confidence ?? ""),
  });

  function handleRetrieve(res: RetrieveResponse) {
    const next = res.features?.[0];
    if (next) {
      setFeature(next);
      setError(null);
    }
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!feature) return;

    setError(null);

    let toSubmit: MapboxRetrievedFeature = feature;
    try {
      const result = await showConfirm();
      if (result.type === "cancel") return;
      if (result.type === "change" && result.feature) {
        toSubmit = result.feature as unknown as MapboxRetrievedFeature;
      }
    } catch {
      // Confirmation modal failed; fall through and submit the original feature.
    }

    startTransition(async () => {
      const res = await createHouseFromMapboxFeature(toSubmit);
      // On success the action calls redirect() and never returns here.
      if (res && !res.ok) {
        setError(res.error);
      }
    });
  }

  if (!MAPBOX_TOKEN) {
    return (
      <div
        className="surface p-4 text-small"
        style={{
          backgroundColor:
            "color-mix(in oklab, var(--color-danger) 12%, var(--color-bg-surface))",
          borderColor:
            "color-mix(in oklab, var(--color-danger) 30%, var(--color-border-subtle))",
        }}
      >
        Address lookup isn&apos;t configured —
        <span className="mono"> NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN</span> is
        missing.
      </div>
    );
  }

  const submitDisabled = !feature || isPending;

  return (
    <form ref={formRef} onSubmit={handleSubmit} className="flex flex-col gap-4">
      <div>
        <label className="label" htmlFor="address-line1">
          Street address
        </label>
        <Autofill
          accessToken={MAPBOX_TOKEN}
          options={{ country: "US", language: "en" }}
          onRetrieve={handleRetrieve}
        >
          <input
            id="address-line1"
            name="address-line1"
            type="text"
            autoComplete="address-line1"
            required
            placeholder="Start typing your address…"
            value={streetValue}
            onChange={(e) => setStreetValue(e.target.value)}
            className="input"
          />
        </Autofill>
        {/* Hidden fields let Mapbox autofill the rest of the address and give
            the confirmation minimap full context to render. */}
        <input type="hidden" name="address-line2" autoComplete="address-line2" />
        <input
          type="hidden"
          name="address-level2"
          autoComplete="address-level2"
        />
        <input
          type="hidden"
          name="address-level1"
          autoComplete="address-level1"
        />
        <input type="hidden" name="postal-code" autoComplete="postal-code" />
        <input type="hidden" name="country" autoComplete="country" />
      </div>

      {feature ? (
        <div
          className="surface flex items-start gap-3 p-3"
          style={{ borderRadius: "var(--radius-md)" }}
        >
          <span
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md"
            style={{
              backgroundColor:
                "color-mix(in oklab, var(--color-accent) 14%, transparent)",
              color: "var(--color-accent)",
            }}
            aria-hidden
          >
            <Icon name="map-pin" size={16} />
          </span>
          <div className="min-w-0 flex-1">
            <div className="eyebrow mb-1">Selected</div>
            <div
              className="text-small truncate"
              style={{ color: "var(--color-text-primary)" }}
            >
              {feature.properties?.full_address ??
                feature.properties?.address_line1}
            </div>
          </div>
        </div>
      ) : null}

      {error ? (
        <div
          className="surface p-3 text-small"
          style={{
            backgroundColor:
              "color-mix(in oklab, var(--color-danger) 12%, var(--color-bg-surface))",
            borderColor:
              "color-mix(in oklab, var(--color-danger) 30%, var(--color-border-subtle))",
            color: "var(--color-text-primary)",
          }}
        >
          {error}
        </div>
      ) : null}

      <button
        type="submit"
        disabled={submitDisabled}
        className="btn btn-primary w-full"
        style={{
          height: 44,
          opacity: submitDisabled ? 0.5 : 1,
          cursor: submitDisabled ? "not-allowed" : "pointer",
        }}
      >
        {isPending ? "Setting up…" : submitLabel}
        {!isPending ? <Icon name="arrow-right" size={16} /> : null}
      </button>
    </form>
  );
}
