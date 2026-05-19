// @vitest-environment jsdom
import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  vi,
  type Mock,
} from "vitest";
import {
  processImage,
  OPTIMIZED_MAX_DIMENSION,
  OPTIMIZED_JPEG_QUALITY,
  THUMBNAIL_MAX_DIMENSION,
  THUMBNAIL_JPEG_QUALITY,
} from "./process-image";
import { OPTIMIZED_FILENAME, THUMBNAIL_FILENAME } from "./paths";

// --- Mock harness ------------------------------------------------------
//
// jsdom provides Image, HTMLCanvasElement, and URL.createObjectURL, but
// none of them actually decode bytes or encode JPEGs. We replace the
// pieces we need with controllable mocks so we can:
//   - drive Image.onload synchronously with known naturalWidth/Height
//   - capture canvas drawImage dimensions to verify scale math
//   - hold toBlob invocations open to verify parallelism
//   - assert URL.createObjectURL/revokeObjectURL bookkeeping

type ToBlobInvocation = {
  type: string | undefined;
  quality: number | undefined;
  resolve: () => void;
  reject: () => void;
};

type DrawImageCall = {
  width: number;
  height: number;
};

let toBlobInvocations: ToBlobInvocation[] = [];
let drawImageCalls: DrawImageCall[] = [];
let mockImageNaturalWidth = 3840;
let mockImageNaturalHeight = 2160;
let mockImageShouldError = false;
let createObjectURLSpy: Mock;
let revokeObjectURLSpy: Mock;

class MockImage {
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  naturalWidth = mockImageNaturalWidth;
  naturalHeight = mockImageNaturalHeight;
  private _src = "";

  set src(value: string) {
    this._src = value;
    // Fire async so callers register handlers first — matches real-browser
    // behavior where decode completes after the current microtask.
    queueMicrotask(() => {
      if (mockImageShouldError) this.onerror?.();
      else this.onload?.();
    });
  }
  get src() {
    return this._src;
  }
}

async function flushMicrotasks(): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
}

beforeEach(() => {
  toBlobInvocations = [];
  drawImageCalls = [];
  mockImageNaturalWidth = 3840;
  mockImageNaturalHeight = 2160;
  mockImageShouldError = false;

  vi.stubGlobal(
    "Image",
    class extends MockImage {
      constructor() {
        super();
        this.naturalWidth = mockImageNaturalWidth;
        this.naturalHeight = mockImageNaturalHeight;
      }
    },
  );

  // jsdom's URL doesn't implement createObjectURL/revokeObjectURL.
  // Define them as plain functions, then spy on them — spyOn requires
  // the property to already exist as a function.
  Object.defineProperty(URL, "createObjectURL", {
    value: () => "",
    writable: true,
    configurable: true,
  });
  Object.defineProperty(URL, "revokeObjectURL", {
    value: () => {},
    writable: true,
    configurable: true,
  });

  createObjectURLSpy = vi
    .spyOn(URL, "createObjectURL")
    .mockReturnValue("blob:mock-url") as unknown as Mock;
  revokeObjectURLSpy = vi
    .spyOn(URL, "revokeObjectURL")
    .mockImplementation(() => {}) as unknown as Mock;

  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(
    () =>
      ({
        drawImage: (
          _img: unknown,
          _x: number,
          _y: number,
          width: number,
          height: number,
        ) => {
          drawImageCalls.push({ width, height });
        },
      }) as unknown as CanvasRenderingContext2D,
  );

  vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation(function (
    this: HTMLCanvasElement,
    callback: BlobCallback,
    type?: string,
    quality?: number,
  ) {
    toBlobInvocations.push({
      type,
      quality,
      resolve: () =>
        callback(new Blob(["x"], { type: type ?? "image/jpeg" })),
      reject: () => callback(null),
    });
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function makeImageFile(): File {
  return new File([new Uint8Array([1, 2, 3, 4])], "input.jpg", {
    type: "image/jpeg",
  });
}

describe("processImage — exported constants", () => {
  it("exposes the documented dimension and quality constants", () => {
    expect(OPTIMIZED_MAX_DIMENSION).toBe(1920);
    expect(OPTIMIZED_JPEG_QUALITY).toBe(0.88);
    expect(THUMBNAIL_MAX_DIMENSION).toBe(600);
    expect(THUMBNAIL_JPEG_QUALITY).toBe(0.82);
  });
});

describe("processImage — happy path", () => {
  it("returns two Files with the correct filenames and image/jpeg type", async () => {
    const promise = processImage(makeImageFile());
    await flushMicrotasks();
    toBlobInvocations.forEach((inv) => inv.resolve());

    const result = await promise;
    expect(result.optimized).toBeInstanceOf(File);
    expect(result.thumbnail).toBeInstanceOf(File);
    expect(result.optimized.name).toBe(OPTIMIZED_FILENAME);
    expect(result.thumbnail.name).toBe(THUMBNAIL_FILENAME);
    expect(result.optimized.type).toBe("image/jpeg");
    expect(result.thumbnail.type).toBe("image/jpeg");
  });

  it("calls toBlob with image/jpeg and the documented qualities", async () => {
    const promise = processImage(makeImageFile());
    await flushMicrotasks();

    expect(toBlobInvocations).toHaveLength(2);
    const qualities = toBlobInvocations.map((inv) => inv.quality);
    expect(qualities).toEqual(
      expect.arrayContaining([OPTIMIZED_JPEG_QUALITY, THUMBNAIL_JPEG_QUALITY]),
    );
    toBlobInvocations.forEach((inv) => expect(inv.type).toBe("image/jpeg"));

    toBlobInvocations.forEach((inv) => inv.resolve());
    await promise;
  });
});

describe("processImage — scale math", () => {
  it("scales a 3840x2160 source down to 1920x1080 for optimized", async () => {
    mockImageNaturalWidth = 3840;
    mockImageNaturalHeight = 2160;

    const promise = processImage(makeImageFile());
    await flushMicrotasks();
    toBlobInvocations.forEach((inv) => inv.resolve());
    await promise;

    // Two drawImage calls — one per resize. Sort to be tolerant of order.
    const dims = drawImageCalls.map((c) => `${c.width}x${c.height}`).sort();
    expect(dims).toEqual(["1920x1080", "600x338"].sort());
  });

  it("does not upscale — a 100x100 source stays 100x100 for both outputs", async () => {
    mockImageNaturalWidth = 100;
    mockImageNaturalHeight = 100;

    const promise = processImage(makeImageFile());
    await flushMicrotasks();
    toBlobInvocations.forEach((inv) => inv.resolve());
    await promise;

    expect(drawImageCalls).toHaveLength(2);
    drawImageCalls.forEach((call) => {
      expect(call.width).toBe(100);
      expect(call.height).toBe(100);
    });
  });

  it("preserves aspect ratio for portrait images", async () => {
    mockImageNaturalWidth = 2160;
    mockImageNaturalHeight = 3840;

    const promise = processImage(makeImageFile());
    await flushMicrotasks();
    toBlobInvocations.forEach((inv) => inv.resolve());
    await promise;

    const dims = drawImageCalls.map((c) => `${c.width}x${c.height}`).sort();
    expect(dims).toEqual(["1080x1920", "338x600"].sort());
  });
});

describe("processImage — parallelism", () => {
  it("invokes both toBlob calls before either resolves", async () => {
    const promise = processImage(makeImageFile());
    await flushMicrotasks();

    // Both resize branches must have reached canvas.toBlob before we
    // resolve any of them. If processImage awaited one resize before
    // starting the other, only one invocation would be present here.
    expect(toBlobInvocations).toHaveLength(2);

    toBlobInvocations.forEach((inv) => inv.resolve());
    await promise;
  });
});

describe("processImage — object URL lifecycle", () => {
  it("creates an object URL for the source file and revokes it on success", async () => {
    const file = makeImageFile();
    const promise = processImage(file);
    await flushMicrotasks();
    toBlobInvocations.forEach((inv) => inv.resolve());
    await promise;

    expect(createObjectURLSpy).toHaveBeenCalledTimes(1);
    expect(createObjectURLSpy).toHaveBeenCalledWith(file);
    expect(revokeObjectURLSpy).toHaveBeenCalledTimes(1);
    expect(revokeObjectURLSpy).toHaveBeenCalledWith("blob:mock-url");
  });

  it("revokes the object URL even when image decode fails", async () => {
    mockImageShouldError = true;

    const promise = processImage(makeImageFile());
    await expect(promise).rejects.toThrow(/Failed to decode image/);

    expect(revokeObjectURLSpy).toHaveBeenCalledTimes(1);
    expect(revokeObjectURLSpy).toHaveBeenCalledWith("blob:mock-url");
  });
});
