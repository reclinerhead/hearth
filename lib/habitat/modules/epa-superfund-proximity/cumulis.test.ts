import { afterEach, describe, expect, it, vi } from "vitest";
import {
  fetchSiteContacts,
  parseCommunityInvolvementCoordinator,
  siteContactsUrl,
  siteDocumentsUrl,
  siteProfileUrl,
} from "./cumulis";

/**
 * Fixture HTML matching the live Cumulis Contacts page shape sampled
 * across five MI Final-NPL sites in November 2025. Trimmed to just
 * the block the parser targets; the live pages wrap this in their
 * full EPA chrome (header, sidebar, footer, GTM script) which is
 * not load-bearing for the parser.
 */
const HAPPY_PATH_HTML = `
<h2 class="page-title">Site Contacts</h2>
<table>
  <tr>
    <td>
      <b>
        Community Involvement Coordinator:
      </b><br>
      <p>
        Kirstin&nbsp;Safakas
        <br><a href="mailto:Safakas.Kirstin@epa.gov">Safakas.Kirstin@epa.gov</a>
        <br>(312) 886-6015
      </p>
      <b>
        Remedial Project Manager:
      </b><br>
      <p>
        Kelly&nbsp;Poulos
        <br><a href="mailto:poulos.kelly@epa.gov">poulos.kelly@epa.gov</a>
      </p>
    </td>
  </tr>
</table>
`;

/**
 * Peerless Plating Co. shape: Remedial Project Manager listed, but no
 * Community Involvement Coordinator block at all. Parser must return
 * null in this case — we deliberately don't fall back to the RPM
 * (RPM is the technical-cleanup contact, not the community-facing one).
 */
const NO_CIC_HTML = `
<h2 class="page-title">Site Contacts</h2>
<table>
  <tr>
    <td>
      <b>
        Remedial Project Manager:
      </b><br>
      <p>
        Alyssa&nbsp;Graveline
        <br><a href="mailto:Graveline.Alyssa@epa.gov">Graveline.Alyssa@epa.gov</a>
      </p>
    </td>
  </tr>
</table>
`;

describe("siteProfileUrl / siteDocumentsUrl / siteContactsUrl", () => {
  it("preserves the zero-padded site_id (canonical Cumulis path requires it)", () => {
    expect(siteProfileUrl("0503011")).toContain("id=0503011");
    expect(siteDocumentsUrl("0503011")).toContain("id=0503011");
    expect(siteContactsUrl("0503011")).toContain("id=0503011");
  });

  it("points at the SiteProfiles canonical path, not the legacy cursites path", () => {
    // The legacy `cursites/csitinfo.cfm` URL still works as a redirect
    // when given the padded id, but EPA's own navigation publishes the
    // canonical SiteProfiles form — pin to that so deep links survive
    // as legacy paths are rearranged.
    expect(siteProfileUrl("0503011")).toContain(
      "/SiteProfiles/index.cfm?fuseaction=second.scs",
    );
    expect(siteDocumentsUrl("0503011")).toContain(
      "fuseaction=second.docdata",
    );
    expect(siteContactsUrl("0503011")).toContain(
      "fuseaction=second.contacts",
    );
  });

  it("URL-encodes site_ids with unusual characters (defensive)", () => {
    expect(siteProfileUrl("abc/def")).toContain("abc%2Fdef");
  });
});

describe("parseCommunityInvolvementCoordinator", () => {
  it("extracts name + email + phone from the canonical block", () => {
    const cic = parseCommunityInvolvementCoordinator(HAPPY_PATH_HTML);
    expect(cic).not.toBeNull();
    expect(cic?.name).toBe("Kirstin Safakas");
    expect(cic?.email).toBe("Safakas.Kirstin@epa.gov");
    expect(cic?.phone).toBe("(312) 886-6015");
  });

  it("returns null when the page has no Community Involvement Coordinator block (Peerless Plating case)", () => {
    const cic = parseCommunityInvolvementCoordinator(NO_CIC_HTML);
    expect(cic).toBeNull();
  });

  it("returns null when the page is empty or unrelated HTML", () => {
    expect(parseCommunityInvolvementCoordinator("")).toBeNull();
    expect(parseCommunityInvolvementCoordinator("<html><body></body></html>")).toBeNull();
  });

  it("collapses &nbsp; between first and last name to a regular space", () => {
    const cic = parseCommunityInvolvementCoordinator(HAPPY_PATH_HTML);
    expect(cic?.name).not.toContain(" ");
    expect(cic?.name).not.toMatch(/&nbsp;/);
  });

  it("preserves EPA's all-caps name casing rather than re-titlecasing", () => {
    // Some sites publish the CIC name in all caps (sampled at site
    // 0503026, CHERYL ALLEN). The display layer is responsible for
    // any case normalization — the parser keeps the source verbatim.
    const allCapsHtml = HAPPY_PATH_HTML.replace(
      "Kirstin&nbsp;Safakas",
      "CHERYL&nbsp;ALLEN",
    ).replace(/Safakas\.Kirstin/g, "allen.cheryl");
    const cic = parseCommunityInvolvementCoordinator(allCapsHtml);
    expect(cic?.name).toBe("CHERYL ALLEN");
  });

  it("returns name + email but null phone when the page omits the number", () => {
    const noPhoneHtml = HAPPY_PATH_HTML.replace(
      /\n\s*<br>\(312\) 886-6015/,
      "",
    );
    const cic = parseCommunityInvolvementCoordinator(noPhoneHtml);
    expect(cic?.name).toBe("Kirstin Safakas");
    expect(cic?.email).toBe("Safakas.Kirstin@epa.gov");
    expect(cic?.phone).toBeNull();
  });

  it("accepts a few phone-format variants", () => {
    const dashedHtml = HAPPY_PATH_HTML.replace(
      "(312) 886-6015",
      "312-886-6015",
    );
    const dottedHtml = HAPPY_PATH_HTML.replace(
      "(312) 886-6015",
      "312.886.6015",
    );
    expect(
      parseCommunityInvolvementCoordinator(dashedHtml)?.phone,
    ).toBe("(312) 886-6015");
    expect(
      parseCommunityInvolvementCoordinator(dottedHtml)?.phone,
    ).toBe("(312) 886-6015");
  });

  it("normalizes whitespace in the extracted name", () => {
    const messyHtml = HAPPY_PATH_HTML.replace(
      "Kirstin&nbsp;Safakas",
      "  Kirstin&nbsp;&nbsp;Safakas  ",
    );
    const cic = parseCommunityInvolvementCoordinator(messyHtml);
    expect(cic?.name).toBe("Kirstin Safakas");
  });
});

describe("fetchSiteContacts", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns the parsed CIC on a successful happy-path response", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(HAPPY_PATH_HTML, { status: 200 }),
    ) as unknown as typeof fetch;
    const cic = await fetchSiteContacts("0503011", { fetchImpl });
    expect(cic?.name).toBe("Kirstin Safakas");
    expect(cic?.email).toBe("Safakas.Kirstin@epa.gov");
  });

  it("returns null on a non-2xx response (page error, site not found)", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response("not found", { status: 404 }),
    ) as unknown as typeof fetch;
    const cic = await fetchSiteContacts("0503011", { fetchImpl });
    expect(cic).toBeNull();
  });

  it("returns null when the fetch itself throws (network error)", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError("network");
    }) as unknown as typeof fetch;
    const cic = await fetchSiteContacts("0503011", { fetchImpl });
    expect(cic).toBeNull();
  });

  it("returns null when the response parses to no CIC", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(NO_CIC_HTML, { status: 200 }),
    ) as unknown as typeof fetch;
    const cic = await fetchSiteContacts("0503011", { fetchImpl });
    expect(cic).toBeNull();
  });

  it("times out cleanly when the server hangs past the configured deadline", async () => {
    const fetchImpl = vi.fn(
      async (_url: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            reject(new DOMException("aborted", "AbortError"));
          });
        }),
    ) as unknown as typeof fetch;
    const cic = await fetchSiteContacts("0503011", {
      fetchImpl,
      timeoutMs: 50,
    });
    expect(cic).toBeNull();
  });

  it("calls the canonical contacts URL with the site_id passed through verbatim", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(HAPPY_PATH_HTML, { status: 200 }),
    ) as unknown as typeof fetch;
    await fetchSiteContacts("0503011", { fetchImpl });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const calledUrl = (fetchImpl as unknown as { mock: { calls: [string, unknown][] } })
      .mock.calls[0][0];
    expect(String(calledUrl)).toContain("fuseaction=second.contacts");
    expect(String(calledUrl)).toContain("id=0503011");
  });
});
