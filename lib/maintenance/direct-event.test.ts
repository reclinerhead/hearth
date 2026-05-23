import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { processDirectEventTaskFromDocument } from "./direct-event";

// --------------------------------------------------------------------------
// Supabase mock
//
// The pipeline issues a small, well-defined set of queries:
//   - documents.select.eq.single
//   - inventory.select.eq.single
//   - houses.select.eq.single
//   - maintenance_tasks.select.eq.eq.eq.maybeSingle    (existing-open check)
//   - maintenance_tasks.update.eq                       (close prior)
//   - maintenance_tasks.insert.select.single            (create new)
//
// We model each as a configurable response. The builder collects the
// insert payload so tests can assert on the written shape.
// --------------------------------------------------------------------------

type Responses = {
  document: { data: unknown; error?: { message: string } | null };
  inventory: { data: unknown; error?: { message: string } | null };
  house: { data: unknown; error?: { message: string } | null };
  existingOpen: { data: unknown; error?: { message: string } | null };
  updateError?: { message: string } | null;
  insert: { data: unknown; error?: { message: string } | null };
};

function makeSupabaseMock(responses: Responses) {
  const captured: {
    insertPayload?: Record<string, unknown>;
    updatePayload?: Record<string, unknown>;
    updatedId?: string;
    /**
     * Filters applied to the existing-open lookup. Tests assert on this
     * to confirm the idempotency check is scoped narrowly enough that
     * independent renewal streams (registration vs insurance) don't
     * close each other (issue #133 follow-up).
     */
    existingOpenFilters?: Record<string, unknown>;
  } = {};

  const documentSingle = vi.fn().mockResolvedValue({
    data: responses.document.data,
    error: responses.document.error ?? null,
  });
  const inventorySingle = vi.fn().mockResolvedValue({
    data: responses.inventory.data,
    error: responses.inventory.error ?? null,
  });
  const houseSingle = vi.fn().mockResolvedValue({
    data: responses.house.data,
    error: responses.house.error ?? null,
  });
  const existingOpenMaybeSingle = vi.fn().mockResolvedValue({
    data: responses.existingOpen.data,
    error: responses.existingOpen.error ?? null,
  });
  const insertSingle = vi.fn().mockResolvedValue({
    data: responses.insert.data,
    error: responses.insert.error ?? null,
  });

  const from = vi.fn((table: string) => {
    if (table === "documents") {
      return {
        select: () => ({
          eq: () => ({ single: documentSingle }),
        }),
      };
    }
    if (table === "inventory") {
      return {
        select: () => ({
          eq: () => ({ single: inventorySingle }),
        }),
      };
    }
    if (table === "houses") {
      return {
        select: () => ({
          eq: () => ({ single: houseSingle }),
        }),
      };
    }
    if (table === "maintenance_tasks") {
      // The existing-open lookup chains `.select(...).eq(...).eq(...)...
      // .maybeSingle()`. We capture every `.eq()` arg so tests can
      // assert the lookup is scoped to the right (inventory_id, kind,
      // title, status) combination, then resolve to the canned response.
      const existingOpenChain: {
        eq: (col: string, value: unknown) => typeof existingOpenChain;
        maybeSingle: typeof existingOpenMaybeSingle;
      } = {
        eq: (col, value) => {
          captured.existingOpenFilters = {
            ...(captured.existingOpenFilters ?? {}),
            [col]: value,
          };
          return existingOpenChain;
        },
        maybeSingle: existingOpenMaybeSingle,
      };

      return {
        select: () => existingOpenChain,
        update: (payload: Record<string, unknown>) => {
          captured.updatePayload = payload;
          return {
            eq: vi.fn(async (_col: string, value: string) => {
              captured.updatedId = value;
              return { error: responses.updateError ?? null };
            }),
          };
        },
        insert: (payload: Record<string, unknown>) => {
          captured.insertPayload = payload;
          return {
            select: () => ({ single: insertSingle }),
          };
        },
      };
    }
    throw new Error(`unexpected table: ${table}`);
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = { from } as unknown as SupabaseClient<any, any, any>;
  return { supabase, captured };
}

// --------------------------------------------------------------------------
// Fixtures
// --------------------------------------------------------------------------

const audiHouse = { id: "house-1", state: "MI" };

const audi = {
  id: "inv-1",
  name: "Audi A4",
  type: "property" as const,
  subtype: "vehicle" as const,
  house_id: audiHouse.id,
};

function audiRegistrationDoc(overrides: Record<string, unknown> = {}) {
  return {
    id: "doc-1",
    house_id: audiHouse.id,
    inventory_id: audi.id,
    kind: "receipt",
    status: "attached",
    metadata: {
      vendor_name: "State of Michigan Vehicle Registration",
      expiration_date: "2028-01-18",
    },
    ...overrides,
  };
}

function defaultResponses(
  overrides: Partial<Responses> = {},
): Responses {
  return {
    document: { data: audiRegistrationDoc() },
    inventory: { data: audi },
    house: { data: audiHouse },
    existingOpen: { data: null },
    insert: { data: { id: "task-new" } },
    ...overrides,
  };
}

// --------------------------------------------------------------------------
// Tests
// --------------------------------------------------------------------------

describe("processDirectEventTaskFromDocument — happy path", () => {
  it("creates a renewal task with Michigan-SOS classification", async () => {
    const { supabase, captured } = makeSupabaseMock(defaultResponses());
    const result = await processDirectEventTaskFromDocument("doc-1", supabase);

    expect(result.closed_task_id).toBeNull();
    expect(result.created_task_id).toBe("task-new");

    expect(captured.insertPayload).toMatchObject({
      house_id: audiHouse.id,
      inventory_id: audi.id,
      source: "direct_event",
      kind: "renewal",
      title: "Vehicle registration renewal",
      subtitle: "Michigan SOS · Audi A4",
      next_due_at: "2028-01-18",
      status: "open",
      cadence_kind: "interval",
      cadence_interval_months: 24,
      cadence_seasonal_anchor: null,
      predecessor_task_id: null,
    });
    expect(captured.insertPayload?.renewal_options).toEqual([
      { label: "1 year", interval_months: 12 },
      { label: "2 years", interval_months: 24 },
    ]);
    expect(captured.insertPayload?.reasoning).toMatchObject({
      source_kind: "document_expiration",
      anchor: { kind: "document_expiration", document_id: "doc-1" },
    });
  });
});

describe("processDirectEventTaskFromDocument — gating", () => {
  it("returns null when expiration_date is missing", async () => {
    const { supabase, captured } = makeSupabaseMock(
      defaultResponses({
        document: {
          data: audiRegistrationDoc({
            metadata: {
              vendor_name: "Some Service Co.",
              expiration_date: null,
            },
          }),
        },
      }),
    );
    const result = await processDirectEventTaskFromDocument("doc-1", supabase);
    expect(result).toEqual({ created_task_id: null, closed_task_id: null });
    expect(captured.insertPayload).toBeUndefined();
  });

  it("returns null when expiration_date is a malformed string", async () => {
    const { supabase, captured } = makeSupabaseMock(
      defaultResponses({
        document: {
          data: audiRegistrationDoc({
            metadata: {
              vendor_name: "State of Michigan Vehicle Registration",
              expiration_date: "Jan 18, 2028",
            },
          }),
        },
      }),
    );
    const result = await processDirectEventTaskFromDocument("doc-1", supabase);
    expect(result).toEqual({ created_task_id: null, closed_task_id: null });
    expect(captured.insertPayload).toBeUndefined();
  });

  it("returns null when the document is not a receipt", async () => {
    const { supabase, captured } = makeSupabaseMock(
      defaultResponses({
        document: { data: audiRegistrationDoc({ kind: "photo" }) },
      }),
    );
    const result = await processDirectEventTaskFromDocument("doc-1", supabase);
    expect(result).toEqual({ created_task_id: null, closed_task_id: null });
    expect(captured.insertPayload).toBeUndefined();
  });

  it("returns null when the document has no inventory_id", async () => {
    const { supabase, captured } = makeSupabaseMock(
      defaultResponses({
        document: { data: audiRegistrationDoc({ inventory_id: null }) },
      }),
    );
    const result = await processDirectEventTaskFromDocument("doc-1", supabase);
    expect(result).toEqual({ created_task_id: null, closed_task_id: null });
    expect(captured.insertPayload).toBeUndefined();
  });

  it("returns null when the document status is not 'attached'", async () => {
    const { supabase, captured } = makeSupabaseMock(
      defaultResponses({
        document: { data: audiRegistrationDoc({ status: "analyzed" }) },
      }),
    );
    const result = await processDirectEventTaskFromDocument("doc-1", supabase);
    expect(result).toEqual({ created_task_id: null, closed_task_id: null });
    expect(captured.insertPayload).toBeUndefined();
  });

  it("returns null when the inventory row is missing", async () => {
    const { supabase, captured } = makeSupabaseMock(
      defaultResponses({ inventory: { data: null } }),
    );
    const result = await processDirectEventTaskFromDocument("doc-1", supabase);
    expect(result).toEqual({ created_task_id: null, closed_task_id: null });
    expect(captured.insertPayload).toBeUndefined();
  });
});

describe("processDirectEventTaskFromDocument — chaining", () => {
  it("closes the existing open renewal and chains predecessor_task_id", async () => {
    const { supabase, captured } = makeSupabaseMock(
      defaultResponses({
        existingOpen: { data: { id: "task-prior" } },
      }),
    );
    const result = await processDirectEventTaskFromDocument("doc-1", supabase);

    expect(result.closed_task_id).toBe("task-prior");
    expect(result.created_task_id).toBe("task-new");

    expect(captured.updatedId).toBe("task-prior");
    expect(captured.updatePayload).toMatchObject({
      status: "completed",
      completed_by_document_id: "doc-1",
      completion_notes: "Renewed via document upload",
    });
    expect(captured.updatePayload?.completed_at).toEqual(expect.any(String));

    expect(captured.insertPayload).toMatchObject({
      predecessor_task_id: "task-prior",
    });
  });

  it("scopes the existing-open lookup by classifier title so independent renewal streams don't close each other", async () => {
    // Regression for the bug where a vehicle's auto-insurance receipt
    // would find the open vehicle-registration task (both kind='renewal'
    // on the same inventory_id) and close it as if it were a renewal of
    // the same stream. The fix narrows the lookup with the classifier-
    // produced title — independent streams now coexist cleanly.
    const { supabase, captured } = makeSupabaseMock(defaultResponses());
    await processDirectEventTaskFromDocument("doc-1", supabase);

    expect(captured.existingOpenFilters).toMatchObject({
      inventory_id: audi.id,
      kind: "renewal",
      title: "Vehicle registration renewal",
      status: "open",
    });
  });

  it("short-circuits the insert when the close fails", async () => {
    const { supabase, captured } = makeSupabaseMock(
      defaultResponses({
        existingOpen: { data: { id: "task-prior" } },
        updateError: { message: "row locked" },
      }),
    );
    const result = await processDirectEventTaskFromDocument("doc-1", supabase);
    expect(result).toEqual({ created_task_id: null, closed_task_id: null });
    expect(captured.insertPayload).toBeUndefined();
  });
});

describe("processDirectEventTaskFromDocument — classifier fallback", () => {
  it("creates a one_time generic-renewal task when no classifier matches", async () => {
    const { supabase, captured } = makeSupabaseMock(
      defaultResponses({
        document: {
          data: audiRegistrationDoc({
            metadata: {
              vendor_name: "City Building Department",
              expiration_date: "2029-06-01",
            },
          }),
        },
        inventory: {
          data: {
            id: "inv-furnace",
            name: "Furnace",
            type: "system",
            subtype: null,
            house_id: audiHouse.id,
          },
        },
      }),
    );
    const result = await processDirectEventTaskFromDocument("doc-1", supabase);

    expect(result.created_task_id).toBe("task-new");
    expect(captured.insertPayload).toMatchObject({
      title: "Renewal",
      subtitle: "City Building Department · Furnace",
      next_due_at: "2029-06-01",
      cadence_kind: "one_time",
      cadence_interval_months: null,
      cadence_seasonal_anchor: null,
      renewal_options: null,
    });
  });

  it("uses just the inventory name in the subtitle when vendor_name is null", async () => {
    const { supabase, captured } = makeSupabaseMock(
      defaultResponses({
        document: {
          data: audiRegistrationDoc({
            metadata: {
              vendor_name: null,
              expiration_date: "2029-06-01",
            },
          }),
        },
        inventory: {
          data: {
            id: "inv-furnace",
            name: "Furnace",
            type: "system",
            subtype: null,
            house_id: audiHouse.id,
          },
        },
      }),
    );
    const result = await processDirectEventTaskFromDocument("doc-1", supabase);
    expect(result.created_task_id).toBe("task-new");
    expect(captured.insertPayload?.subtitle).toBe("Furnace");
  });
});
