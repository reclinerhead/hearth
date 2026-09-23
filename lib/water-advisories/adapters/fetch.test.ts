import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchText } from "./fetch";

const URL_ = "https://www.portagemi.gov/RSSFeed.aspx?ModID=1&CID=All-newsflash.xml";

/** undici's shape for a connect timeout: a bare TypeError with the cause attached. */
function connectTimeout(): Error {
  const cause = new Error(
    "Connect Timeout Error (attempted address: www.portagemi.gov:443, timeout: 10000ms)",
  );
  cause.name = "ConnectTimeoutError";
  return new TypeError("fetch failed", { cause });
}

function sequence(steps: Array<Error | { status: number; body: string }>): {
  fetchImpl: typeof fetch;
  calls: () => number;
} {
  let i = 0;
  const fetchImpl = (async () => {
    const step = steps[Math.min(i++, steps.length - 1)];
    if (step instanceof Error) throw step;
    return new Response(step.body, { status: step.status });
  }) as typeof fetch;
  return { fetchImpl, calls: () => i };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("fetchText — network-level retry (issue #349)", () => {
  it("retries once after a connect timeout and returns the body", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "info").mockImplementation(() => {});
    const s = sequence([connectTimeout(), { status: 200, body: "<rss/>ok" }]);
    await expect(fetchText(URL_, { fetchImpl: s.fetchImpl, retryDelayMs: 0 })).resolves.toBe("<rss/>ok");
    expect(s.calls()).toBe(2);
  });

  it("gives up after the second network failure, naming the cause and the attempt count", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const s = sequence([connectTimeout(), connectTimeout()]);
    await expect(fetchText(URL_, { fetchImpl: s.fetchImpl, retryDelayMs: 0 })).rejects.toThrow(
      /fetch failed \(Connect Timeout Error .*\) — failed 2 attempts/,
    );
    expect(s.calls()).toBe(2);
  });

  it("never retries an HTTP response — a 403 is the origin's decision", async () => {
    const s = sequence([{ status: 403, body: "<html>Access Denied</html>" }, { status: 200, body: "late" }]);
    await expect(fetchText(URL_, { fetchImpl: s.fetchImpl, retryDelayMs: 0 })).rejects.toThrow(/→ 403 bot wall/);
    expect(s.calls()).toBe(1);
  });

  it("never retries a 5xx either", async () => {
    const s = sequence([{ status: 503, body: "busy" }, { status: 200, body: "late" }]);
    await expect(fetchText(URL_, { fetchImpl: s.fetchImpl, retryDelayMs: 0 })).rejects.toThrow(/→ 503/);
    expect(s.calls()).toBe(1);
  });

  it("labels our own overall timeout as 'timed out'", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const abort = new Error("The operation was aborted due to timeout");
    abort.name = "TimeoutError";
    const s = sequence([abort, abort]);
    await expect(fetchText(URL_, { fetchImpl: s.fetchImpl, retryDelayMs: 0 })).rejects.toThrow(/→ timed out — failed 2 attempts/);
  });
});
