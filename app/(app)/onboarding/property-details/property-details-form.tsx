"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Icon } from "@/components/icon";
import {
  basementToChoice,
  choiceToBasement,
  choiceToWaterSource,
  PropertySituationFields,
  waterSourceToChoice,
  type BasementChoice,
  type RowWaterSource,
  type WaterSourceChoice,
} from "@/components/property-situation-fields";
import { createClient } from "@/lib/supabase/client";

/**
 * Client-side form for the property-details onboarding step (issue #142).
 * Shares the segmented-control building blocks with the home-details
 * edit modal via `components/property-situation-fields.tsx`.
 *
 * Writes go through the browser Supabase client (same pattern as the
 * edit modal). RLS scopes the UPDATE to the user's own house — the
 * server page already RLS-verified ownership of `houseId` before
 * rendering this form, so this is defense in depth.
 *
 * "Skip for now" is a simple `<Link>` to `/dashboard` rather than an
 * action — there's nothing to persist when the user chooses not to
 * answer.
 */
export function PropertyDetailsForm({
  houseId,
  initialWaterSource,
  initialBasementPresent,
}: {
  houseId: string;
  initialWaterSource: RowWaterSource;
  initialBasementPresent: boolean | null;
}) {
  const router = useRouter();

  const [waterSource, setWaterSource] = useState<WaterSourceChoice>(() =>
    waterSourceToChoice(initialWaterSource),
  );
  const [basementPresent, setBasementPresent] = useState<BasementChoice>(() =>
    basementToChoice(initialBasementPresent),
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      const supabase = createClient();
      const { error: updateError } = await supabase
        .from("houses")
        .update({
          water_source: choiceToWaterSource(waterSource),
          basement_present: choiceToBasement(basementPresent),
        })
        .eq("id", houseId);
      if (updateError) {
        setError(
          updateError.message ||
            "We couldn't save those answers. Try again or skip for now.",
        );
        return;
      }
      router.push("/dashboard");
    } catch (err) {
      console.error("property-details save failed", err);
      setError("Something went wrong saving. Try again or skip for now.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-6">
      <PropertySituationFields
        waterSource={waterSource}
        onWaterSourceChange={setWaterSource}
        basementPresent={basementPresent}
        onBasementChange={setBasementPresent}
      />

      {error ? (
        <div
          className="surface p-3 text-small"
          role="alert"
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

      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link
          href="/dashboard"
          className="text-small"
          style={{ color: "var(--color-text-secondary)" }}
        >
          Skip for now
        </Link>
        <button
          type="submit"
          disabled={saving}
          className="btn btn-primary"
          style={{
            opacity: saving ? 0.6 : 1,
            cursor: saving ? "not-allowed" : "pointer",
          }}
        >
          {saving ? "Saving…" : "Save and continue"}
          {!saving ? <Icon name="arrow-right" size={16} /> : null}
        </button>
      </div>
    </form>
  );
}
