import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  afterEach,
  type Mock,
} from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { uploadDocumentFiles } from "./upload";
import {
  HEARTH_DOCUMENTS_BUCKET,
  optimizedObjectPath,
  thumbnailObjectPath,
} from "./paths";

const houseId = "11111111-1111-1111-1111-111111111111";
const documentId = "22222222-2222-2222-2222-222222222222";

type UploadCall = {
  path: string;
  body: unknown;
  options: unknown;
  resolve: (value: { data: unknown; error: { message: string } | null }) => void;
  reject: (reason: unknown) => void;
};

type Harness = {
  supabase: SupabaseClient;
  from: Mock;
  uploadMock: Mock;
  removeMock: Mock;
  uploadCalls: UploadCall[];
  optimized: File;
  thumbnail: File;
};

function makeHarness(): Harness {
  const uploadCalls: UploadCall[] = [];

  const uploadMock = vi.fn(
    (path: string, body: unknown, options: unknown) =>
      new Promise((resolve, reject) => {
        uploadCalls.push({ path, body, options, resolve, reject });
      }),
  );

  const removeMock = vi.fn(async () => ({ data: [], error: null }));

  const bucket = { upload: uploadMock, remove: removeMock };
  const from = vi.fn(() => bucket);
  const supabase = { storage: { from } } as unknown as SupabaseClient;

  return {
    supabase,
    from,
    uploadMock,
    removeMock,
    uploadCalls,
    optimized: new File(["o"], "optimized.jpg", { type: "image/jpeg" }),
    thumbnail: new File(["t"], "thumb.jpg", { type: "image/jpeg" }),
  };
}

async function flushMicrotasks(): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
}

let harness: Harness;

beforeEach(() => {
  harness = makeHarness();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("uploadDocumentFiles — happy path", () => {
  it("returns the optimized and thumbnail paths when both uploads succeed", async () => {
    const promise = uploadDocumentFiles({
      supabase: harness.supabase,
      houseId,
      documentId,
      optimized: harness.optimized,
      thumbnail: harness.thumbnail,
    });

    await flushMicrotasks();
    harness.uploadCalls.forEach((call) =>
      call.resolve({ data: { path: call.path }, error: null }),
    );

    const result = await promise;
    expect(result).toEqual({
      optimizedPath: optimizedObjectPath({ houseId, documentId }),
      thumbnailPath: thumbnailObjectPath({ houseId, documentId }),
    });
  });

  it("targets the hearth-documents bucket", async () => {
    const promise = uploadDocumentFiles({
      supabase: harness.supabase,
      houseId,
      documentId,
      optimized: harness.optimized,
      thumbnail: harness.thumbnail,
    });
    await flushMicrotasks();
    harness.uploadCalls.forEach((call) =>
      call.resolve({ data: { path: call.path }, error: null }),
    );
    await promise;

    expect(harness.from).toHaveBeenCalledWith(HEARTH_DOCUMENTS_BUCKET);
  });

  it("uploads to the correct paths with upsert:false and immutable cache-control", async () => {
    const promise = uploadDocumentFiles({
      supabase: harness.supabase,
      houseId,
      documentId,
      optimized: harness.optimized,
      thumbnail: harness.thumbnail,
    });
    await flushMicrotasks();
    harness.uploadCalls.forEach((call) =>
      call.resolve({ data: { path: call.path }, error: null }),
    );
    await promise;

    const paths = harness.uploadMock.mock.calls.map((c) => c[0]).sort();
    expect(paths).toEqual(
      [
        optimizedObjectPath({ houseId, documentId }),
        thumbnailObjectPath({ houseId, documentId }),
      ].sort(),
    );

    harness.uploadMock.mock.calls.forEach((call) => {
      expect(call[2]).toMatchObject({
        upsert: false,
        cacheControl: "31536000, immutable",
        contentType: "image/jpeg",
      });
    });
  });

  it("does not call remove on the happy path", async () => {
    const promise = uploadDocumentFiles({
      supabase: harness.supabase,
      houseId,
      documentId,
      optimized: harness.optimized,
      thumbnail: harness.thumbnail,
    });
    await flushMicrotasks();
    harness.uploadCalls.forEach((call) =>
      call.resolve({ data: { path: call.path }, error: null }),
    );
    await promise;

    expect(harness.removeMock).not.toHaveBeenCalled();
  });
});

describe("uploadDocumentFiles — parallelism", () => {
  it("invokes both upload calls before either resolves", async () => {
    const promise = uploadDocumentFiles({
      supabase: harness.supabase,
      houseId,
      documentId,
      optimized: harness.optimized,
      thumbnail: harness.thumbnail,
    });

    await flushMicrotasks();
    // Both uploads must already be in flight before we resolve either.
    // A sequential implementation would only have called upload once
    // at this point.
    expect(harness.uploadMock).toHaveBeenCalledTimes(2);
    expect(harness.uploadCalls).toHaveLength(2);

    harness.uploadCalls.forEach((call) =>
      call.resolve({ data: { path: call.path }, error: null }),
    );
    await promise;
  });
});

describe("uploadDocumentFiles — partial failures", () => {
  it("cleans up the thumbnail when optimized fails (error in result.error)", async () => {
    const promise = uploadDocumentFiles({
      supabase: harness.supabase,
      houseId,
      documentId,
      optimized: harness.optimized,
      thumbnail: harness.thumbnail,
    });

    await flushMicrotasks();
    const optimizedCall = harness.uploadCalls.find((c) =>
      c.path.endsWith("optimized.jpg"),
    )!;
    const thumbnailCall = harness.uploadCalls.find((c) =>
      c.path.endsWith("thumb.jpg"),
    )!;

    optimizedCall.resolve({
      data: null,
      error: { message: "optimized boom" },
    });
    thumbnailCall.resolve({
      data: { path: thumbnailCall.path },
      error: null,
    });

    await expect(promise).rejects.toMatchObject({ message: "optimized boom" });

    expect(harness.removeMock).toHaveBeenCalledTimes(1);
    expect(harness.removeMock).toHaveBeenCalledWith([
      thumbnailObjectPath({ houseId, documentId }),
    ]);
  });

  it("cleans up the optimized when thumbnail fails", async () => {
    const promise = uploadDocumentFiles({
      supabase: harness.supabase,
      houseId,
      documentId,
      optimized: harness.optimized,
      thumbnail: harness.thumbnail,
    });

    await flushMicrotasks();
    const optimizedCall = harness.uploadCalls.find((c) =>
      c.path.endsWith("optimized.jpg"),
    )!;
    const thumbnailCall = harness.uploadCalls.find((c) =>
      c.path.endsWith("thumb.jpg"),
    )!;

    optimizedCall.resolve({
      data: { path: optimizedCall.path },
      error: null,
    });
    thumbnailCall.resolve({
      data: null,
      error: { message: "thumbnail boom" },
    });

    await expect(promise).rejects.toMatchObject({ message: "thumbnail boom" });

    expect(harness.removeMock).toHaveBeenCalledTimes(1);
    expect(harness.removeMock).toHaveBeenCalledWith([
      optimizedObjectPath({ houseId, documentId }),
    ]);
  });

  it("re-throws the optimized error when both fail and does not call remove", async () => {
    const promise = uploadDocumentFiles({
      supabase: harness.supabase,
      houseId,
      documentId,
      optimized: harness.optimized,
      thumbnail: harness.thumbnail,
    });

    await flushMicrotasks();
    const optimizedCall = harness.uploadCalls.find((c) =>
      c.path.endsWith("optimized.jpg"),
    )!;
    const thumbnailCall = harness.uploadCalls.find((c) =>
      c.path.endsWith("thumb.jpg"),
    )!;

    optimizedCall.resolve({ data: null, error: { message: "first" } });
    thumbnailCall.resolve({ data: null, error: { message: "second" } });

    await expect(promise).rejects.toMatchObject({ message: "first" });
    expect(harness.removeMock).not.toHaveBeenCalled();
  });

  it("swallows cleanup errors and still surfaces the original failure", async () => {
    harness.removeMock.mockRejectedValueOnce(new Error("cleanup failed"));

    const promise = uploadDocumentFiles({
      supabase: harness.supabase,
      houseId,
      documentId,
      optimized: harness.optimized,
      thumbnail: harness.thumbnail,
    });

    await flushMicrotasks();
    const optimizedCall = harness.uploadCalls.find((c) =>
      c.path.endsWith("optimized.jpg"),
    )!;
    const thumbnailCall = harness.uploadCalls.find((c) =>
      c.path.endsWith("thumb.jpg"),
    )!;

    optimizedCall.resolve({
      data: null,
      error: { message: "optimized boom" },
    });
    thumbnailCall.resolve({
      data: { path: thumbnailCall.path },
      error: null,
    });

    await expect(promise).rejects.toMatchObject({ message: "optimized boom" });
  });

  it("propagates a rejected promise from upload", async () => {
    const promise = uploadDocumentFiles({
      supabase: harness.supabase,
      houseId,
      documentId,
      optimized: harness.optimized,
      thumbnail: harness.thumbnail,
    });

    await flushMicrotasks();
    const optimizedCall = harness.uploadCalls.find((c) =>
      c.path.endsWith("optimized.jpg"),
    )!;
    const thumbnailCall = harness.uploadCalls.find((c) =>
      c.path.endsWith("thumb.jpg"),
    )!;

    optimizedCall.reject(new Error("network down"));
    thumbnailCall.resolve({
      data: { path: thumbnailCall.path },
      error: null,
    });

    await expect(promise).rejects.toThrow(/network down/);
    expect(harness.removeMock).toHaveBeenCalledTimes(1);
    expect(harness.removeMock).toHaveBeenCalledWith([
      thumbnailObjectPath({ houseId, documentId }),
    ]);
  });
});
