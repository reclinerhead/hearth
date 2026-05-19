import { describe, it, expect } from "vitest";
import {
  HEARTH_DOCUMENTS_BUCKET,
  OPTIMIZED_FILENAME,
  THUMBNAIL_FILENAME,
  documentDirectoryPath,
  optimizedObjectPath,
  thumbnailObjectPath,
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
