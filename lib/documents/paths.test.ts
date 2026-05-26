import { describe, it, expect } from "vitest";
import {
  HEARTH_DOCUMENTS_BUCKET,
  HEARTH_EMERGENCY_VIDEOS_BUCKET,
  OPTIMIZED_FILENAME,
  THUMBNAIL_FILENAME,
  EMERGENCY_VIDEO_WEBM_FILENAME,
  EMERGENCY_VIDEO_MP4_FILENAME,
  EMERGENCY_VIDEO_POSTER_FILENAME,
  documentDirectoryPath,
  optimizedObjectPath,
  pageOptimizedObjectPath,
  pageThumbnailObjectPath,
  thumbnailObjectPath,
  emergencyVideoObjectPath,
  emergencyVideoPosterObjectPath,
} from "./paths";

const houseId = "11111111-1111-1111-1111-111111111111";
const documentId = "22222222-2222-2222-2222-222222222222";

describe("documents/paths constants", () => {
  it("exports the expected bucket name", () => {
    expect(HEARTH_DOCUMENTS_BUCKET).toBe("hearth-documents");
  });

  it("exports the expected filenames", () => {
    expect(OPTIMIZED_FILENAME).toBe("optimized.jpg");
    expect(THUMBNAIL_FILENAME).toBe("thumb.jpg");
  });

  it("exports the emergency-video bucket and filenames", () => {
    expect(HEARTH_EMERGENCY_VIDEOS_BUCKET).toBe("hearth-emergency-videos");
    expect(EMERGENCY_VIDEO_WEBM_FILENAME).toBe("video.webm");
    expect(EMERGENCY_VIDEO_MP4_FILENAME).toBe("video.mp4");
    expect(EMERGENCY_VIDEO_POSTER_FILENAME).toBe("poster.jpg");
  });
});

describe("documentDirectoryPath", () => {
  it("joins houseId and documentId with a single slash, no trailing", () => {
    expect(documentDirectoryPath({ houseId, documentId })).toBe(
      `${houseId}/${documentId}`,
    );
  });

  it("throws on empty houseId", () => {
    expect(() => documentDirectoryPath({ houseId: "", documentId })).toThrow(
      /houseId/,
    );
  });

  it("throws on empty documentId", () => {
    expect(() => documentDirectoryPath({ houseId, documentId: "" })).toThrow(
      /documentId/,
    );
  });
});

describe("optimizedObjectPath", () => {
  it("produces {houseId}/{documentId}/optimized.jpg", () => {
    expect(optimizedObjectPath({ houseId, documentId })).toBe(
      `${houseId}/${documentId}/optimized.jpg`,
    );
  });

  it("uses the OPTIMIZED_FILENAME constant", () => {
    expect(optimizedObjectPath({ houseId, documentId })).toContain(
      OPTIMIZED_FILENAME,
    );
  });

  it("throws on empty houseId", () => {
    expect(() => optimizedObjectPath({ houseId: "", documentId })).toThrow(
      /houseId/,
    );
  });

  it("throws on empty documentId", () => {
    expect(() => optimizedObjectPath({ houseId, documentId: "" })).toThrow(
      /documentId/,
    );
  });
});

describe("thumbnailObjectPath", () => {
  it("produces {houseId}/{documentId}/thumb.jpg", () => {
    expect(thumbnailObjectPath({ houseId, documentId })).toBe(
      `${houseId}/${documentId}/thumb.jpg`,
    );
  });

  it("uses the THUMBNAIL_FILENAME constant", () => {
    expect(thumbnailObjectPath({ houseId, documentId })).toContain(
      THUMBNAIL_FILENAME,
    );
  });

  it("throws on empty houseId", () => {
    expect(() => thumbnailObjectPath({ houseId: "", documentId })).toThrow(
      /houseId/,
    );
  });

  it("throws on empty documentId", () => {
    expect(() => thumbnailObjectPath({ houseId, documentId: "" })).toThrow(
      /documentId/,
    );
  });
});

describe("pageOptimizedObjectPath (#117)", () => {
  it("produces {houseId}/{documentId}/page-{N}-optimized.jpg", () => {
    expect(
      pageOptimizedObjectPath({ houseId, documentId, pageNumber: 2 }),
    ).toBe(`${houseId}/${documentId}/page-2-optimized.jpg`);
  });

  it("supports higher page numbers", () => {
    expect(
      pageOptimizedObjectPath({ houseId, documentId, pageNumber: 5 }),
    ).toBe(`${houseId}/${documentId}/page-5-optimized.jpg`);
  });

  it("rejects pageNumber=1 (page 1 lives on the parent row)", () => {
    expect(() =>
      pageOptimizedObjectPath({ houseId, documentId, pageNumber: 1 }),
    ).toThrow(/pageNumber/);
  });

  it("rejects non-integer page numbers", () => {
    expect(() =>
      pageOptimizedObjectPath({ houseId, documentId, pageNumber: 2.5 }),
    ).toThrow(/pageNumber/);
  });

  it("rejects empty houseId/documentId", () => {
    expect(() =>
      pageOptimizedObjectPath({ houseId: "", documentId, pageNumber: 2 }),
    ).toThrow(/houseId/);
    expect(() =>
      pageOptimizedObjectPath({ houseId, documentId: "", pageNumber: 2 }),
    ).toThrow(/documentId/);
  });
});

describe("pageThumbnailObjectPath (#117)", () => {
  it("produces {houseId}/{documentId}/page-{N}-thumb.jpg", () => {
    expect(
      pageThumbnailObjectPath({ houseId, documentId, pageNumber: 2 }),
    ).toBe(`${houseId}/${documentId}/page-2-thumb.jpg`);
  });

  it("rejects pageNumber=1", () => {
    expect(() =>
      pageThumbnailObjectPath({ houseId, documentId, pageNumber: 1 }),
    ).toThrow(/pageNumber/);
  });

  it("rejects non-integer page numbers", () => {
    expect(() =>
      pageThumbnailObjectPath({ houseId, documentId, pageNumber: 0 }),
    ).toThrow(/pageNumber/);
  });
});

describe("emergencyVideoObjectPath (#139)", () => {
  it("produces {houseId}/{documentId}/video.webm for webm container", () => {
    expect(
      emergencyVideoObjectPath({ houseId, documentId, container: "webm" }),
    ).toBe(`${houseId}/${documentId}/video.webm`);
  });

  it("produces {houseId}/{documentId}/video.mp4 for mp4 container", () => {
    expect(
      emergencyVideoObjectPath({ houseId, documentId, container: "mp4" }),
    ).toBe(`${houseId}/${documentId}/video.mp4`);
  });

  it("throws on empty houseId/documentId", () => {
    expect(() =>
      emergencyVideoObjectPath({ houseId: "", documentId, container: "webm" }),
    ).toThrow(/houseId/);
    expect(() =>
      emergencyVideoObjectPath({ houseId, documentId: "", container: "webm" }),
    ).toThrow(/documentId/);
  });
});

describe("emergencyVideoPosterObjectPath (#139)", () => {
  it("produces {houseId}/{documentId}/poster.jpg", () => {
    expect(emergencyVideoPosterObjectPath({ houseId, documentId })).toBe(
      `${houseId}/${documentId}/poster.jpg`,
    );
  });

  it("uses the EMERGENCY_VIDEO_POSTER_FILENAME constant", () => {
    expect(emergencyVideoPosterObjectPath({ houseId, documentId })).toContain(
      EMERGENCY_VIDEO_POSTER_FILENAME,
    );
  });

  it("throws on empty houseId/documentId", () => {
    expect(() =>
      emergencyVideoPosterObjectPath({ houseId: "", documentId }),
    ).toThrow(/houseId/);
    expect(() =>
      emergencyVideoPosterObjectPath({ houseId, documentId: "" }),
    ).toThrow(/documentId/);
  });
});

describe("path layout consistency", () => {
  it("optimized path starts with the directory prefix", () => {
    const dir = documentDirectoryPath({ houseId, documentId });
    expect(optimizedObjectPath({ houseId, documentId }).startsWith(`${dir}/`)).toBe(
      true,
    );
  });

  it("thumbnail path starts with the directory prefix", () => {
    const dir = documentDirectoryPath({ houseId, documentId });
    expect(thumbnailObjectPath({ houseId, documentId }).startsWith(`${dir}/`)).toBe(
      true,
    );
  });

  it("paths never start with a slash", () => {
    expect(documentDirectoryPath({ houseId, documentId }).startsWith("/")).toBe(
      false,
    );
    expect(optimizedObjectPath({ houseId, documentId }).startsWith("/")).toBe(
      false,
    );
    expect(thumbnailObjectPath({ houseId, documentId }).startsWith("/")).toBe(
      false,
    );
  });
});
