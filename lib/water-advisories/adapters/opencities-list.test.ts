import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { resolveFetchTarget } from "./fetch";
import {
  fetchOpenCitiesAdvisories,
  PROXY_DETAIL_PACE_MS,
  PROXY_MAX_DETAIL_FETCHES,
} from "./opencities-list";

const LIST_HTML = readFileSync(
  join(__dirname, "..", "fixtures", "kalamazoo-list.html"),
  "utf8",
);
const LIST_URL =
  "https://www.kalamazoocity.org/Residents/Water-Sewer-Service/Boil-Water-Advisories";

// The stub Akamai serves to cloud egress ranges (observed from Vercel on
// 2026-09-22): a 403 whose body carries "Access Denied" and a reference id.
const AKAMAI_403 = `<HTML><HEAD><TITLE>Access Denied</TITLE></HEAD><BODY><H1>Access Denied</H1>You don't have permission to access "http&#58;&#47;&#47;www&#46;kalamazoocity&#46;org&#47;Residents" on this server.<P>Reference&#32;&#35;18&#46;8eaa3717&#46;1790086345&#46;1dd1f374</BODY></HTML>`;

function fakeFetch(
  handler: (url: string) => { status: number; body: string; server?: string },
): typeof fetch {
  return (async (input: string | URL | Request) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const r = handler(url);
    return new Response(r.body, {
      status: r.status,
      headers: r.server ? { server: r.server } : undefined,
    });
  }) as typeof fetch;
}

const ORIGINAL_PROXY = process.env.WATER_ADVISORY_FETCH_PROXY_URL;
afterEach(() => {
  if (ORIGINAL_PROXY === undefined) delete process.env.WATER_ADVISORY_FETCH_PROXY_URL;
  else process.env.WATER_ADVISORY_FETCH_PROXY_URL = ORIGINAL_PROXY;
});

describe("resolveFetchTarget", () => {
  it("fetches directly when no proxy template is configured", () => {
    delete process.env.WATER_ADVISORY_FETCH_PROXY_URL;
    expect(resolveFetchTarget(LIST_URL, true)).toEqual({ target: LIST_URL, viaProxy: false });
  });

  it("substitutes the encoded target into the template when the source opts in", () => {
    process.env.WATER_ADVISORY_FETCH_PROXY_URL = "https://proxy.example/?key=k&url={url}";
    expect(resolveFetchTarget(LIST_URL, true)).toEqual({
      target: `https://proxy.example/?key=k&url=${encodeURIComponent(LIST_URL)}`,
      viaProxy: true,
    });
  });

  it("a source that does not opt in fetches directly even with a template set", () => {
    process.env.WATER_ADVISORY_FETCH_PROXY_URL = "https://proxy.example/?key=k&url={url}";
    expect(resolveFetchTarget(LIST_URL, false)).toEqual({ target: LIST_URL, viaProxy: false });
  });

  it("ignores a template that has no {url} placeholder", () => {
    process.env.WATER_ADVISORY_FETCH_PROXY_URL = "https://proxy.example/";
    expect(resolveFetchTarget(LIST_URL, true).viaProxy).toBe(false);
  });
});

describe("fetchOpenCitiesAdvisories", () => {
  it("names the bot wall and keeps an excerpt when Akamai serves its 403 stub", async () => {
    delete process.env.WATER_ADVISORY_FETCH_PROXY_URL;
    const fetchImpl = fakeFetch(() => ({ status: 403, body: AKAMAI_403, server: "AkamaiGHost" }));
    await expect(
      fetchOpenCitiesAdvisories({ list_url: LIST_URL }, { knownUrls: new Set(), fetchImpl }),
    ).rejects.toThrow(/→ 403 bot wall \(server: AkamaiGHost\) — Access Denied Access Denied You don't have permission/);
  });

  it("treats a 200 that is really the denial page as a bot wall", async () => {
    const fetchImpl = fakeFetch(() => ({ status: 200, body: AKAMAI_403 }));
    await expect(
      fetchOpenCitiesAdvisories({ list_url: LIST_URL }, { knownUrls: new Set(), fetchImpl }),
    ).rejects.toThrow(/→ 200 bot wall/);
  });

  it("throws when a healthy-looking page parses to zero entries", async () => {
    const fetchImpl = fakeFetch(() => ({ status: 200, body: "<html><body>Maintenance</body></html>" }));
    await expect(
      fetchOpenCitiesAdvisories({ list_url: LIST_URL }, { knownUrls: new Set(), fetchImpl }),
    ).rejects.toThrow(/parsed zero list entries/);
  });

  it("parses the fixture, folds the banner-only lift in, and skips detail pages for known URLs", async () => {
    const calls: string[] = [];
    const fetchImpl = fakeFetch((url) => {
      calls.push(url);
      if (url === LIST_URL) return { status: 200, body: LIST_HTML };
      return {
        status: 200,
        body: `<h1 class='oc-page-title '>Detail</h1><p class="published-on">Published on September 19, 2026</p>`,
      };
    });
    const known = new Set([
      `${LIST_URL}/Scheduled-Boil-Water-Advisory-Baker-St`,
      `${LIST_URL}/Scheduled-Boil-Water-Advisory-Wheaton-Ave-Axtell-St-Merrill-St`,
      `${LIST_URL}/Boil-Water-Advisory-Lifted-Rose-Arbour-Dr`,
    ]);
    const parsed = await fetchOpenCitiesAdvisories(
      { list_url: LIST_URL },
      { knownUrls: known, fetchImpl },
    );

    expect(parsed).toHaveLength(5);
    const bannerOnly = parsed.find((p) => p.source_url.endsWith("LIFTED-LOW-and-HIGH-Pressure-Districts"));
    expect(bannerOnly).toMatchObject({ on_emergency_banner: true, published_on: "2026-09-19" });
    expect(bannerOnly?.raw).toMatchObject({ banner_severity: 30, detail_title: "Detail" });
    // list page + 2 unknown URLs (the district advisory and the banner lift)
    expect(calls).toHaveLength(3);
  });

  it("routes every fetch through the proxy template when the source opts in", async () => {
    process.env.WATER_ADVISORY_FETCH_PROXY_URL = "https://proxy.example/?url={url}";
    const calls: string[] = [];
    const fetchImpl = fakeFetch((url) => {
      calls.push(url);
      return { status: 200, body: LIST_HTML };
    });
    await fetchOpenCitiesAdvisories(
      { list_url: LIST_URL, use_fetch_proxy: true },
      { knownUrls: new Set(["x"]), fetchImpl, sleep: async () => {} },
    ).catch(() => undefined);
    expect(calls[0]).toBe(`https://proxy.example/?url=${encodeURIComponent(LIST_URL)}`);
    expect(calls.every((c) => c.startsWith("https://proxy.example/"))).toBe(true);
  });
});

describe("fetchOpenCitiesAdvisories — detail pacing through the relay (issue #353)", () => {
  /** A list page with `n` entries, none of them known to the store. */
  function longList(n: number): string {
    return Array.from(
      { length: n },
      (_, i) =>
        `<div class="list-item-container"><article><a href="${LIST_URL}/Advisory-${i}"><h2 class="list-item-title">Boil Water Advisory: ${i} Main St</h2><p>Summary ${i}</p></a></article></div>`,
    ).join("\n");
  }

  const DETAIL = `<h1 class='oc-page-title '>Detail</h1><p class="published-on">Published on September 19, 2026</p>`;

  /** Records the timeline of fetches and pauses so the ordering can be asserted. */
  function harness(listHtml: string) {
    const log: string[] = [];
    const fetchImpl = fakeFetch((url) => {
      const isList = url === LIST_URL || url.endsWith(encodeURIComponent(LIST_URL));
      log.push(isList ? "list" : "detail");
      return { status: 200, body: isList ? listHtml : DETAIL };
    });
    const sleep = async (ms: number) => {
      log.push(`sleep ${ms}`);
    };
    return { log, fetchImpl, sleep };
  }

  it("pauses PROXY_DETAIL_PACE_MS before every proxied detail fetch and stops at PROXY_MAX_DETAIL_FETCHES", async () => {
    process.env.WATER_ADVISORY_FETCH_PROXY_URL = "https://relay.example/fetch?key=k&url={url}";
    const h = harness(longList(12));
    const parsed = await fetchOpenCitiesAdvisories(
      { list_url: LIST_URL, use_fetch_proxy: true },
      { knownUrls: new Set(), fetchImpl: h.fetchImpl, sleep: h.sleep },
    );

    expect(PROXY_DETAIL_PACE_MS).toBe(3_200);
    expect(PROXY_MAX_DETAIL_FETCHES).toBe(8);
    expect(h.log).toEqual([
      "list",
      ...Array.from({ length: PROXY_MAX_DETAIL_FETCHES }, () => [`sleep ${PROXY_DETAIL_PACE_MS}`, "detail"]).flat(),
    ]);
    // Entries past the cap keep a null date rather than failing the run.
    expect(parsed.filter((p) => p.published_on === "2026-09-19")).toHaveLength(PROXY_MAX_DETAIL_FETCHES);
    expect(parsed.filter((p) => p.published_on === null)).toHaveLength(12 - PROXY_MAX_DETAIL_FETCHES);
  });

  it("a direct fetch keeps today's behavior: no pauses, cap 12", async () => {
    process.env.WATER_ADVISORY_FETCH_PROXY_URL = "https://relay.example/fetch?key=k&url={url}";
    const h = harness(longList(14));
    await fetchOpenCitiesAdvisories(
      { list_url: LIST_URL }, // no use_fetch_proxy
      { knownUrls: new Set(), fetchImpl: h.fetchImpl, sleep: h.sleep },
    );
    expect(h.log).toEqual(["list", ...Array.from({ length: 12 }, () => "detail")]);
  });

  it("an opted-in source with no proxy template configured also fetches directly and unpaced", async () => {
    delete process.env.WATER_ADVISORY_FETCH_PROXY_URL;
    const h = harness(longList(3));
    await fetchOpenCitiesAdvisories(
      { list_url: LIST_URL, use_fetch_proxy: true },
      { knownUrls: new Set(), fetchImpl: h.fetchImpl, sleep: h.sleep },
    );
    expect(h.log).toEqual(["list", "detail", "detail", "detail"]);
  });

  it("never pauses for known URLs — only fetched details are paced", async () => {
    process.env.WATER_ADVISORY_FETCH_PROXY_URL = "https://relay.example/fetch?key=k&url={url}";
    const h = harness(longList(3));
    await fetchOpenCitiesAdvisories(
      { list_url: LIST_URL, use_fetch_proxy: true },
      {
        knownUrls: new Set([`${LIST_URL}/Advisory-0`, `${LIST_URL}/Advisory-2`]),
        fetchImpl: h.fetchImpl,
        sleep: h.sleep,
      },
    );
    expect(h.log).toEqual(["list", `sleep ${PROXY_DETAIL_PACE_MS}`, "detail"]);
  });
});
