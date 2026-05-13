import { Icon } from "@/components/icon";
import { PlaceholderImage, SectionHeader } from "@/components/ui";

export default function HomeDetailsPage() {
  return (
    <div className="mx-auto w-full max-w-2xl flex flex-col gap-6">
      <SectionHeader eyebrow="Edit" title="Your house" />

      <div className="surface p-5 sm:p-6 flex flex-col gap-5">
        <Field
          label="Address"
          value="604 Norton Drive, Ann Arbor MI 48104"
          locked
          hint="From public records — contact us if this needs to change."
        />

        <div className="grid sm:grid-cols-2 gap-4">
          <Field label="Build year" value="1934" />
          <Field label="Square feet" value="1,840" />
          <Field label="Lot size" value="7,840 sf (0.18 ac)" />
          <Field label="Bedrooms" value="3" />
          <Field label="Bathrooms" value="1.5" />
          <Field label="Ownership start" value="Aug 2019" />
        </div>

        <div>
          <div className="label">Photo</div>
          <div className="grid sm:grid-cols-[180px_1fr] gap-4 items-start">
            <div className="w-full sm:w-44">
              <PlaceholderImage ratio="4 / 3" label="604 Norton Drive" icon="home" />
            </div>
            <div className="flex flex-col gap-2">
              <button type="button" className="btn btn-ghost self-start">
                <Icon name="upload" size={16} />
                Upload photo
              </button>
              <p
                className="text-small"
                style={{ color: "var(--color-text-tertiary)" }}
              >
                JPEG or PNG, up to 10 MB. Square or landscape works best.
              </p>
            </div>
          </div>
        </div>

        <div
          className="flex items-center justify-between gap-3 pt-2"
          style={{ borderTop: "1px solid var(--color-border-subtle)" }}
        >
          <p
            className="text-small"
            style={{ color: "var(--color-text-tertiary)" }}
          >
            Some of this came from public records — edit anything we got wrong.
          </p>
          <button type="button" className="btn btn-primary">
            Save changes
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({
  label,
  value,
  locked,
  hint,
}: {
  label: string;
  value: string;
  locked?: boolean;
  hint?: string;
}) {
  return (
    <div>
      <label className="label">
        {label}
        {locked ? (
          <span
            className="ml-2 chip"
            style={{ height: 18, fontSize: 10, padding: "0 6px" }}
          >
            From records
          </span>
        ) : null}
      </label>
      <input
        type="text"
        defaultValue={value}
        readOnly={locked}
        className="input"
        style={
          locked
            ? {
                backgroundColor: "var(--color-bg-surface-raised)",
                color: "var(--color-text-secondary)",
              }
            : undefined
        }
      />
      {hint ? (
        <p
          className="text-small mt-1"
          style={{ color: "var(--color-text-tertiary)" }}
        >
          {hint}
        </p>
      ) : null}
    </div>
  );
}
