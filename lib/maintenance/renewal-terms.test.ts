import { describe, expect, it } from "vitest";
import {
  classifyGenericRenewal,
  classifyRenewalDocument,
  renderSubtitle,
  type ClassificationInput,
} from "./renewal-terms";

function input(
  partial: Partial<ClassificationInput> = {},
): ClassificationInput {
  return {
    vendor_name: null,
    inventory_type: "property",
    inventory_subtype: "vehicle",
    inventory_state: "MI",
    ...partial,
  };
}

describe("classifyRenewalDocument — Michigan registration", () => {
  it("matches the Michigan-SOS shape against a MI vehicle", () => {
    const result = classifyRenewalDocument(
      input({ vendor_name: "State of Michigan Vehicle Registration" }),
    );
    expect(result).not.toBeNull();
    expect(result?.task_title).toBe("Vehicle registration renewal");
    expect(result?.task_subtitle_template).toBe(
      "Michigan SOS · {inventory_name}",
    );
    expect(result?.renewal_options).toEqual([
      { label: "1 year", interval_months: 12 },
      { label: "2 years", interval_months: 24 },
    ]);
    expect(result?.renewal_url_template).toContain("sos.state.mi.us");
  });

  it("matches when the vendor name uses 'Secretary of State' phrasing", () => {
    const result = classifyRenewalDocument(
      input({ vendor_name: "Michigan Department of State - Secretary of State" }),
    );
    expect(result).not.toBeNull();
    expect(result?.task_title).toBe("Vehicle registration renewal");
  });

  it("returns null for a Michigan vendor against a non-MI vehicle", () => {
    const result = classifyRenewalDocument(
      input({
        vendor_name: "State of Michigan Vehicle Registration",
        inventory_state: "OH",
      }),
    );
    expect(result).toBeNull();
  });

  it("returns null when the inventory item is not a vehicle", () => {
    const result = classifyRenewalDocument(
      input({
        vendor_name: "State of Michigan Vehicle Registration",
        inventory_type: "appliance",
        inventory_subtype: null,
      }),
    );
    expect(result).toBeNull();
  });

  it("returns null when the vendor name doesn't include both keywords", () => {
    expect(
      classifyRenewalDocument(input({ vendor_name: "Michigan SOS" })),
    ).toBeNull();
    expect(
      classifyRenewalDocument(input({ vendor_name: "Secretary of State" })),
    ).toBeNull();
  });
});

describe("classifyRenewalDocument — auto insurance", () => {
  it.each([
    "Progressive",
    "GEICO",
    "State Farm",
    "Allstate",
    "Liberty Mutual",
    "Farmers Insurance Group",
    "USAA",
    "Nationwide",
  ])("matches carrier %s against a vehicle", (vendor) => {
    const result = classifyRenewalDocument(
      input({ vendor_name: vendor, inventory_state: "CA" }),
    );
    expect(result).not.toBeNull();
    expect(result?.task_title).toBe("Auto insurance renewal");
    expect(result?.task_subtitle_template).toBe(
      "{vendor_name} · {inventory_name}",
    );
    expect(result?.renewal_options).toEqual([
      { label: "6 months", interval_months: 6 },
      { label: "12 months", interval_months: 12 },
    ]);
  });

  it("matches any vendor with 'Insurance' in the name attached to a vehicle", () => {
    const result = classifyRenewalDocument(
      input({ vendor_name: "Acme Mutual Insurance Co." }),
    );
    expect(result).not.toBeNull();
    expect(result?.task_title).toBe("Auto insurance renewal");
  });

  it("returns null when an insurance vendor is attached to a non-vehicle item", () => {
    const result = classifyRenewalDocument(
      input({
        vendor_name: "Progressive",
        inventory_type: "appliance",
        inventory_subtype: null,
      }),
    );
    expect(result).toBeNull();
  });
});

describe("classifyRenewalDocument — unrecognized", () => {
  it("returns null for vendors that match no classifier", () => {
    expect(
      classifyRenewalDocument(input({ vendor_name: "Vet Clinic of Springfield" })),
    ).toBeNull();
    expect(
      classifyRenewalDocument(input({ vendor_name: "Acme Hardware" })),
    ).toBeNull();
  });

  it("returns null when vendor_name is null", () => {
    expect(classifyRenewalDocument(input({ vendor_name: null }))).toBeNull();
  });
});

describe("classifyGenericRenewal", () => {
  it("emits a vendor-bearing template when vendor_name is set", () => {
    const result = classifyGenericRenewal(input({ vendor_name: "City Permits" }));
    expect(result.task_title).toBe("Renewal");
    expect(result.task_subtitle_template).toBe(
      "{vendor_name} · {inventory_name}",
    );
    expect(result.renewal_options).toEqual([]);
    expect(result.renewal_url_template).toBeNull();
  });

  it("emits an inventory-only template when vendor_name is null", () => {
    const result = classifyGenericRenewal(input({ vendor_name: null }));
    expect(result.task_subtitle_template).toBe("{inventory_name}");
  });
});

describe("renderSubtitle", () => {
  it("substitutes both placeholders when populated", () => {
    expect(
      renderSubtitle("{vendor_name} · {inventory_name}", {
        vendor_name: "Progressive",
        inventory_name: "Audi A4",
      }),
    ).toBe("Progressive · Audi A4");
  });

  it("substitutes a template without a vendor placeholder", () => {
    expect(
      renderSubtitle("Michigan SOS · {inventory_name}", {
        vendor_name: null,
        inventory_name: "Audi A4",
      }),
    ).toBe("Michigan SOS · Audi A4");
  });

  it("drops the leading separator when vendor_name is null", () => {
    expect(
      renderSubtitle("{vendor_name} · {inventory_name}", {
        vendor_name: null,
        inventory_name: "Audi A4",
      }),
    ).toBe("Audi A4");
  });

  it("returns just the inventory name for the inventory-only template", () => {
    expect(
      renderSubtitle("{inventory_name}", {
        vendor_name: null,
        inventory_name: "Audi A4",
      }),
    ).toBe("Audi A4");
  });
});
