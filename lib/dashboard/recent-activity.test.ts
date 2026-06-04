import { describe, expect, it } from "vitest";
import {
  ACTIVITY_LIMIT,
  buildRecentActivity,
  shapeDocumentAttached,
  shapeInventoryAdded,
  shapeTaskCompleted,
  type ActivityEntry,
  type RecentActivitySources,
} from "./recent-activity";

// Reference clock well ahead of every fixture timestamp so the
// future-date guard is a no-op except where a test deliberately probes it.
const NOW = new Date("2026-06-03T00:00:00.000Z");

function sources(
  partial: Partial<RecentActivitySources>,
): RecentActivitySources {
  return {
    inventoryAdded: [],
    documentsAttached: [],
    tasksCompleted: [],
    ...partial,
  };
}

describe("shapeInventoryAdded", () => {
  it("uppercases the type into the eyebrow and points href at the item", () => {
    const entry = shapeInventoryAdded({
      id: "inv-1",
      name: "Rheem water heater",
      type: "system",
      subtype: null,
      createdAt: "2026-05-01T12:00:00Z",
      thumbnailPath: "house/doc/thumb.jpg",
    });
    expect(entry.eyebrow).toBe("SYSTEM · ADDED");
    expect(entry.title).toBe("Rheem water heater");
    expect(entry.href).toBe("/inventory/inv-1");
    expect(entry.kind).toBe("inventory_added");
    expect(entry.fallbackIcon).toBe("flame-burner");
  });

  it("surfaces the vehicle subtype in the eyebrow, not PROPERTY", () => {
    const entry = shapeInventoryAdded({
      id: "v-1",
      name: "Toyota Land Cruiser",
      type: "property",
      subtype: "vehicle",
      createdAt: "2026-05-02T12:00:00Z",
      thumbnailPath: null,
    });
    expect(entry.eyebrow).toBe("VEHICLE · ADDED");
    expect(entry.fallbackIcon).toBe("car");
  });

  it("falls back to the bare type when a property has no subtype", () => {
    const entry = shapeInventoryAdded({
      id: "p-1",
      name: "Telescope",
      type: "property",
      subtype: null,
      createdAt: "2026-05-02T12:00:00Z",
      thumbnailPath: null,
    });
    expect(entry.eyebrow).toBe("PROPERTY · ADDED");
    expect(entry.fallbackIcon).toBe("package");
  });
});

describe("shapeDocumentAttached", () => {
  it("resolves the parent name into the eyebrow and a generic title for receipts", () => {
    const entry = shapeDocumentAttached({
      id: "doc-1",
      inventoryId: "inv-9",
      parentName: "Water heater",
      kind: "receipt",
      createdAt: "2026-05-03T12:00:00Z",
      thumbnailPath: "house/doc-1/thumb.jpg",
    });
    // The receipt kind is overloaded (registrations, insurance, warranties),
    // so it surfaces generically rather than as "Service receipt".
    expect(entry.eyebrow).toBe("WATER HEATER · DOCUMENT ATTACHED");
    expect(entry.title).toBe("Document");
    // href targets the parent item, but the entry id is the document's own.
    expect(entry.href).toBe("/inventory/inv-9");
    expect(entry.id).toBe("doc-1");
    expect(entry.fallbackIcon).toBe("file-text");
  });

  it("keeps a specific label for non-overloaded kinds", () => {
    const entry = shapeDocumentAttached({
      id: "doc-2",
      inventoryId: "inv-9",
      parentName: "Water heater",
      kind: "manual",
      createdAt: "2026-05-03T12:00:00Z",
      thumbnailPath: null,
    });
    expect(entry.eyebrow).toBe("WATER HEATER · MANUAL ATTACHED");
    expect(entry.title).toBe("Manual");
  });
});

describe("shapeTaskCompleted", () => {
  it("uses a kind-appropriate verb and the parent hero thumbnail", () => {
    const entry = shapeTaskCompleted({
      id: "task-1",
      inventoryId: "inv-3",
      itemName: "Furnace",
      kind: "service",
      title: "Annual furnace service",
      completedAt: "2026-05-04T12:00:00Z",
      thumbnailPath: "house/doc/thumb.jpg",
    });
    expect(entry.eyebrow).toBe("FURNACE · SERVICED");
    expect(entry.title).toBe("Annual furnace service");
    expect(entry.href).toBe("/inventory/inv-3");
    expect(entry.fallbackIcon).toBe("tool");
  });

  it("uses the renewal verb for renewal-kind tasks", () => {
    const entry = shapeTaskCompleted({
      id: "task-2",
      inventoryId: "inv-4",
      itemName: "Land Cruiser",
      kind: "renewal",
      title: "Vehicle registration",
      completedAt: "2026-05-04T12:00:00Z",
      thumbnailPath: null,
    });
    expect(entry.eyebrow).toBe("LAND CRUISER · RENEWED");
    expect(entry.fallbackIcon).toBe("calendar");
  });
});

// Lightweight ActivityEntry factory for the merge tests — the shapers are
// covered above, so here we just need entries with controllable id /
// kind / occurredAt.
function entry(
  id: string,
  kind: ActivityEntry["kind"],
  occurredAt: string,
): ActivityEntry {
  return {
    id,
    kind,
    occurredAt,
    eyebrow: "EYEBROW",
    title: "Title",
    href: `/inventory/${id}`,
    thumbnailPath: null,
    thumbnailBucket: "hearth-documents",
    fallbackIcon: "package",
  };
}

describe("buildRecentActivity", () => {
  it("returns empty entries and zero total for an empty house", () => {
    expect(buildRecentActivity(sources({}), NOW)).toEqual({
      entries: [],
      totalCount: 0,
    });
  });

  it("merges all three sources newest-first", () => {
    const result = buildRecentActivity(
      sources({
        inventoryAdded: [entry("a", "inventory_added", "2026-05-01T00:00:00Z")],
        documentsAttached: [
          entry("b", "document_attached", "2026-05-03T00:00:00Z"),
        ],
        tasksCompleted: [entry("c", "task_completed", "2026-05-02T00:00:00Z")],
      }),
      NOW,
    );
    expect(result.entries.map((e) => e.id)).toEqual(["b", "c", "a"]);
    expect(result.totalCount).toBe(3);
  });

  it("caps the entries at ACTIVITY_LIMIT but reports the full total", () => {
    const count = ACTIVITY_LIMIT + 2;
    const inventoryAdded = Array.from({ length: count }, (_, i) =>
      // Descending dates (zero-padded) so id order matches date order.
      entry(
        `i${i}`,
        "inventory_added",
        `2026-05-${String(count - i).padStart(2, "0")}T00:00:00Z`,
      ),
    );
    const result = buildRecentActivity(sources({ inventoryAdded }), NOW);
    expect(result.entries).toHaveLength(ACTIVITY_LIMIT);
    expect(result.entries.map((e) => e.id)).toEqual(
      Array.from({ length: ACTIVITY_LIMIT }, (_, i) => `i${i}`),
    );
    expect(result.totalCount).toBe(count);
  });

  it("breaks ties by kind (completion > document > inventory) then id", () => {
    const ts = "2026-05-01T00:00:00Z";
    const result = buildRecentActivity(
      sources({
        inventoryAdded: [entry("z", "inventory_added", ts)],
        documentsAttached: [
          entry("m", "document_attached", ts),
          entry("a", "document_attached", ts),
        ],
        tasksCompleted: [entry("q", "task_completed", ts)],
      }),
      NOW,
    );
    // task first, then the two documents ordered by id, then inventory.
    expect(result.entries.map((e) => e.id)).toEqual(["q", "a", "m", "z"]);
  });

  it("drops future-dated and unparseable timestamps", () => {
    const result = buildRecentActivity(
      sources({
        inventoryAdded: [
          entry("past", "inventory_added", "2026-05-01T00:00:00Z"),
          entry("future", "inventory_added", "2099-01-01T00:00:00Z"),
          entry("junk", "inventory_added", "not-a-date"),
        ],
      }),
      NOW,
    );
    expect(result.entries.map((e) => e.id)).toEqual(["past"]);
    expect(result.totalCount).toBe(1);
  });
});
