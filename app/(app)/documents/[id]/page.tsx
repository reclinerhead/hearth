import Link from "next/link";
import { Icon } from "@/components/icon";
import { DocumentTrigger, SAMPLE_DOCUMENT } from "@/components/document-modal";
import { Breadcrumb } from "@/components/ui";

export default async function DocumentPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await params; // Reserved for real lookups; the document is currently hardcoded.

  return (
    <div className="flex flex-col gap-5">
      <Breadcrumb
        items={[
          { label: "Appliances", href: "/inventory" },
          { label: "Maytag dishwasher", href: "/entities/maytag-dishwasher" },
          { label: "Drain pump receipt" },
        ]}
      />

      <section className="surface p-6 sm:p-8 text-center flex flex-col items-center gap-4">
        <div className="eyebrow">{SAMPLE_DOCUMENT.kind}</div>
        <h1 className="h1" style={{ marginTop: 0 }}>
          {SAMPLE_DOCUMENT.title}
        </h1>
        <p
          className="max-w-md"
          style={{ color: "var(--color-text-secondary)" }}
        >
          {SAMPLE_DOCUMENT.description}
        </p>

        <div className="flex flex-wrap items-center justify-center gap-2 mt-2">
          <DocumentTrigger
            document={SAMPLE_DOCUMENT}
            className="btn btn-primary"
          >
            <Icon name="file-text" size={16} />
            View document
          </DocumentTrigger>
          <Link
            href={SAMPLE_DOCUMENT.entityHref}
            className="btn btn-ghost"
          >
            <Icon name="chevron-left" size={16} />
            {SAMPLE_DOCUMENT.entityName}
          </Link>
        </div>
      </section>
    </div>
  );
}
