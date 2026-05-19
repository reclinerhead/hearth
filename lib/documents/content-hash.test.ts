// Runs under Vitest's default Node environment. Node 20's globalThis
// provides both `crypto.subtle` and a Blob/File implementation with
// `arrayBuffer()` — jsdom's Blob does not, so we avoid jsdom here.
import { describe, it, expect } from "vitest";
import { computeContentHash } from "./content-hash";

// SHA-256 of "hello world" — canonical reference vector.
const HELLO_WORLD_SHA256 =
  "b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9";

// SHA-256 of zero bytes — also a well-known reference vector.
const EMPTY_SHA256 =
  "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

describe("computeContentHash", () => {
  it("hashes 'hello world' to the canonical SHA-256 hex digest", async () => {
    const blob = new Blob(["hello world"]);
    expect(await computeContentHash(blob)).toBe(HELLO_WORLD_SHA256);
  });

  it("hashes an empty blob to the SHA-256 of zero bytes", async () => {
    const blob = new Blob([]);
    expect(await computeContentHash(blob)).toBe(EMPTY_SHA256);
  });

  it("returns a 64-character lowercase hex string", async () => {
    const blob = new Blob(["anything"]);
    const hash = await computeContentHash(blob);
    expect(hash).toHaveLength(64);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is deterministic — same input produces same hash on repeated calls", async () => {
    const file = new File(["repeat me"], "x.bin");
    const first = await computeContentHash(file);
    const second = await computeContentHash(file);
    expect(first).toBe(second);
  });

  it("produces different hashes for different bytes", async () => {
    const a = await computeContentHash(new Blob(["a"]));
    const b = await computeContentHash(new Blob(["b"]));
    expect(a).not.toBe(b);
  });

  it("accepts a File and a Blob interchangeably for the same bytes", async () => {
    const bytes = "shared bytes";
    const blobHash = await computeContentHash(new Blob([bytes]));
    const fileHash = await computeContentHash(new File([bytes], "x.txt"));
    expect(blobHash).toBe(fileHash);
  });
});
