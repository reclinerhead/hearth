"use client";

/**
 * Shared form region for the two property-situation inputs that landed
 * in issue #142: water source and basement presence. Used in two
 * places:
 *
 *   1. `EditHomeDetailsModal` — for editing an existing house (lets a
 *      user fill these in without re-onboarding, which would lose
 *      their inventory).
 *   2. `/onboarding/property-details` — the post-address onboarding
 *      step that captures these for new houses.
 *
 * Both controls are segmented buttons with an explicit "Not sure"
 * option, because the fields are slightly intimate and forcing a
 * choice would push users to guess. "Not sure" persists as
 * `water_source: "unknown"` and `basement_present: null` — the
 * application treats both as "we can't reason about this, suppress
 * rather than guess." The form-state encoding uses a single sentinel
 * (`"unset"`) so the React state stays monomorphic; the
 * `choiceTo*` helpers convert back to the row-level persistence
 * shape at save time.
 */

export type WaterSourceChoice =
  | "well"
  | "municipal"
  | "shared"
  | "unknown"
  | "unset";

export type BasementChoice = "yes" | "no" | "not_sure" | "unset";

export type RowWaterSource = "well" | "municipal" | "shared" | "unknown" | null;

export function waterSourceToChoice(v: RowWaterSource): WaterSourceChoice {
  return v ?? "unset";
}

export function choiceToWaterSource(c: WaterSourceChoice): RowWaterSource {
  return c === "unset" ? null : c;
}

export function basementToChoice(v: boolean | null): BasementChoice {
  if (v === true) return "yes";
  if (v === false) return "no";
  // The null persisted state covers both "user said Not sure" and
  // "we never asked." In the form we render "Not sure" as the visible
  // value either way — the distinction only matters to future
  // "complete your profile" prompts that can use null to mean "ask
  // again," and those don't exist yet.
  return "not_sure";
}

export function choiceToBasement(c: BasementChoice): boolean | null {
  if (c === "yes") return true;
  if (c === "no") return false;
  return null; // "not_sure" or "unset"
}

const WATER_SOURCE_OPTIONS: Array<{
  value: Exclude<WaterSourceChoice, "unset">;
  label: string;
}> = [
  { value: "well", label: "Private well" },
  { value: "municipal", label: "City or utility" },
  { value: "shared", label: "Shared system" },
  { value: "unknown", label: "Not sure" },
];

const BASEMENT_OPTIONS: Array<{
  value: Exclude<BasementChoice, "unset">;
  label: string;
}> = [
  { value: "yes", label: "Yes" },
  { value: "no", label: "No" },
  { value: "not_sure", label: "Not sure" },
];

export function PropertySituationFields({
  waterSource,
  onWaterSourceChange,
  basementPresent,
  onBasementChange,
}: {
  waterSource: WaterSourceChoice;
  onWaterSourceChange: (v: WaterSourceChoice) => void;
  basementPresent: BasementChoice;
  onBasementChange: (v: BasementChoice) => void;
}) {
  return (
    <div className="flex flex-col gap-5">
      <SegmentedField
        label="Water source"
        helpText="Helps us tailor environmental findings — well users see well-specific guidance; municipal users get utility-specific framing."
        value={waterSource}
        unsetValue="unset"
        options={WATER_SOURCE_OPTIONS}
        onChange={onWaterSourceChange}
      />
      <SegmentedField
        label="Does your home have a basement?"
        helpText="Used to evaluate vapor-intrusion risk when nearby contamination involves volatile chemicals."
        value={basementPresent}
        unsetValue="unset"
        options={BASEMENT_OPTIONS}
        onChange={onBasementChange}
      />
    </div>
  );
}

/**
 * Generic segmented control rendered as a row of buttons. The selected
 * option carries the accent treatment; the `unsetValue` sentinel means
 * "no choice made yet" and visually leaves every option un-highlighted.
 */
function SegmentedField<T extends string>({
  label,
  helpText,
  value,
  unsetValue,
  options,
  onChange,
}: {
  label: string;
  helpText: string;
  value: T;
  unsetValue: T;
  options: ReadonlyArray<{ value: T; label: string }>;
  onChange: (v: T) => void;
}) {
  return (
    <div>
      <label className="label">{label}</label>
      <div className="flex flex-wrap gap-2">
        {options.map((opt) => {
          const selected = value !== unsetValue && value === opt.value;
          return (
            <button
              key={opt.value}
              type="button"
              onClick={() => onChange(opt.value)}
              aria-pressed={selected}
              className="btn"
              style={{
                backgroundColor: selected
                  ? "color-mix(in oklab, var(--color-accent) 14%, transparent)"
                  : "transparent",
                borderColor: selected
                  ? "color-mix(in oklab, var(--color-accent) 55%, var(--color-border-subtle))"
                  : "var(--color-border-subtle)",
                color: selected
                  ? "var(--color-accent)"
                  : "var(--color-text-primary)",
                fontWeight: selected ? 500 : 400,
              }}
            >
              {opt.label}
            </button>
          );
        })}
      </div>
      <p
        className="text-small mt-1"
        style={{ color: "var(--color-text-tertiary)" }}
      >
        {helpText}
      </p>
    </div>
  );
}
