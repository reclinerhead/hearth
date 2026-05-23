// Per-issuer classification for renewal documents (issue #131).
//
// Pure logic: given a document's vendor name and the linked inventory
// item's context (type, subtype, house state), return the renewal-task
// shape the direct-event pipeline should write — task title, subtitle
// template, term cards for the future mark-renewed sheet, optional
// deep-link template for the future "Renew now" CTA.
//
// The classifiers are functions, not table data, because a future
// classifier may need to discriminate on additional fields (e.g. an
// installed_on date). Functions give us that flexibility cheaply.
// Each branch stays tight enough that the file as a whole reads as a
// lookup table anyway.
//
// First-match-wins. New issuers / document types extend CLASSIFIERS.

import type { EquipmentType, InventorySubtype } from "@/types/document";

export type RenewalTermOption = {
  label: string;
  interval_months: number;
};

export type RenewalDocumentClassification = {
  task_title: string;
  task_subtitle_template: string;
  renewal_options: RenewalTermOption[];
  renewal_url_template: string | null;
};

export type ClassificationInput = {
  vendor_name: string | null;
  inventory_type: EquipmentType;
  inventory_subtype: InventorySubtype | null;
  /** USPS code, from house.state via the linked inventory's house. */
  inventory_state: string | null;
};

export function classifyRenewalDocument(
  input: ClassificationInput,
): RenewalDocumentClassification | null {
  for (const classifier of CLASSIFIERS) {
    const match = classifier(input);
    if (match) return match;
  }
  return null;
}

type Classifier = (
  input: ClassificationInput,
) => RenewalDocumentClassification | null;

const CLASSIFIERS: Classifier[] = [michiganRegistration, autoInsurance];

// Michigan vehicle registration. MI terms are 1 or 2 years, but the
// expiration date is anchored on the registrant's birthday rather than
// transaction_date + term. The auto-completion path always writes the
// literal extracted expiration_date so the birthday quirk doesn't
// matter here; the term cards exist for phase 6's manual mark-renewed
// sheet, where phase 6 will surface a caveat about the birthday anchor.
function michiganRegistration(
  input: ClassificationInput,
): RenewalDocumentClassification | null {
  if (input.inventory_type !== "property") return null;
  if (input.inventory_subtype !== "vehicle") return null;
  if (input.inventory_state !== "MI") return null;

  const vendor = (input.vendor_name ?? "").toLowerCase();
  const matched =
    vendor.includes("michigan") &&
    (vendor.includes("registration") || vendor.includes("secretary of state"));
  if (!matched) return null;

  return {
    task_title: "Vehicle registration renewal",
    task_subtitle_template: "Michigan SOS · {inventory_name}",
    renewal_options: [
      { label: "1 year", interval_months: 12 },
      { label: "2 years", interval_months: 24 },
    ],
    renewal_url_template: "https://services2.sos.state.mi.us/serviceshome/",
  };
}

// Auto insurance — covers most US carriers. Detected by the inventory
// subtype being 'vehicle' and the vendor name containing "insurance"
// or matching a known carrier keyword. Carrier list is the major US
// names; new entries land when we observe a miss in production.
function autoInsurance(
  input: ClassificationInput,
): RenewalDocumentClassification | null {
  if (input.inventory_type !== "property") return null;
  if (input.inventory_subtype !== "vehicle") return null;

  const vendor = (input.vendor_name ?? "").toLowerCase();
  const isInsurance =
    vendor.includes("insurance") ||
    vendor.includes("progressive") ||
    vendor.includes("geico") ||
    vendor.includes("state farm") ||
    vendor.includes("allstate") ||
    vendor.includes("liberty mutual") ||
    vendor.includes("farmers") ||
    vendor.includes("usaa") ||
    vendor.includes("nationwide");
  if (!isInsurance) return null;

  return {
    task_title: "Auto insurance renewal",
    task_subtitle_template: "{vendor_name} · {inventory_name}",
    renewal_options: [
      { label: "6 months", interval_months: 6 },
      { label: "12 months", interval_months: 12 },
    ],
    renewal_url_template: null,
  };
}

/**
 * Fallback for documents with an expiration_date and a strong inventory
 * match that didn't match any specific classifier. Produces a generic
 * renewal task with empty term cards — phase 6's mark-renewed sheet
 * falls back to a date picker when renewal_options is empty.
 */
export function classifyGenericRenewal(
  input: ClassificationInput,
): RenewalDocumentClassification {
  return {
    task_title: "Renewal",
    task_subtitle_template: input.vendor_name
      ? "{vendor_name} · {inventory_name}"
      : "{inventory_name}",
    renewal_options: [],
    renewal_url_template: null,
  };
}

/**
 * Substitutes placeholders in a subtitle template against the concrete
 * values for this task. Pure string formatting.
 *
 * Drops the vendor placeholder cleanly when vendor_name is null so a
 * template like "{vendor_name} · {inventory_name}" doesn't render as
 * "· Audi". Trailing / leading separators are stripped, and a
 * doubled-up separator (vendor was empty in the middle) is collapsed.
 */
export function renderSubtitle(
  template: string,
  values: { vendor_name: string | null; inventory_name: string },
): string {
  return template
    .replace("{vendor_name}", values.vendor_name ?? "")
    .replace("{inventory_name}", values.inventory_name)
    .replace(/\s+·\s+·\s+/g, " · ")
    .replace(/^\s*·\s+/, "")
    .replace(/\s+·\s*$/, "")
    .trim();
}
