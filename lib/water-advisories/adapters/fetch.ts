/**
 * The one HTTP fetch every advisory adapter uses (issues #331, #337, #341).
 *
 * Browser-like headers, a bounded timeout, and the bot-wall diagnostics
 * live here so each adapter is only "what do I do with the body." The
 * optional proxy hop is opt-in **per source** (`use_fetch_proxy` in the
 * source config): only the sources that sit behind a cloud-egress block
 * pay for a proxy service; open feeds fetch directly.
 */

const FETCH_TIMEOUT_MS = 20_000;
// toddtech-web-relay gives up on the origin at 20 s and answers 504
// `upstream-timeout`; waiting a little longer means Hearth records the
// relay's verdict instead of racing it with its own abort (issue #353).
const PROXY_FETCH_TIMEOUT_MS = 25_000;

const BROWSER_HEADERS: Record<string, string> = {
  "user-agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
  accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "accept-language": "en-US,en;q=0.9",
};

/**
 * Optional fetch proxy. Akamai fronts the Kalamazoo site and rejects every
 * cloud egress range we tested (Vercel/AWS, GitHub Actions/Azure, a
 * Cloudflare Worker) while a home connection running the same fetch gets
 * the page. When `WATER_ADVISORY_FETCH_PROXY_URL` is set it is a template
 * such as `https://<relay-host>/fetch?key=…&url={url}`; a source whose
 * config says `use_fetch_proxy: true` has `{url}` replaced with its
 * encoded target and the request goes to the proxy instead.
 */
export function resolveFetchTarget(
  url: string,
  useProxy: boolean,
): { target: string; viaProxy: boolean } {
  const template = process.env.WATER_ADVISORY_FETCH_PROXY_URL;
  if (!useProxy || !template || !template.includes("{url}")) {
    return { target: url, viaProxy: false };
  }
  return { target: template.replace("{url}", encodeURIComponent(url)), viaProxy: true };
}

export type FetchTextOptions = {
  fetchImpl?: typeof fetch;
  useProxy?: boolean;
  /** Override the Accept header (feeds want XML first). */
  accept?: string;
  /** Pause before the single retry of a network-level failure (tests pass 0). */
  retryDelayMs?: number;
};

// One retry, network-level failures only. A connect timeout / reset on a
// single-homed civic origin is usually a blip (Portage flapped overnight
// on 2026-09-23 with every re-run succeeding — issue #349); a second
// attempt a moment later turns a false "failed run" into a late one.
// HTTP responses are never retried: a 403 or a 5xx is the origin's
// decision, and retrying is how an address earns a permanent block.
const NETWORK_RETRY_ATTEMPTS = 2;
const DEFAULT_RETRY_DELAY_MS = 1_500;

function describeNetworkError(url: string, err: unknown): string {
  // undici wraps network-level failures as a bare "fetch failed" with the
  // real reason on `cause` (ECONNRESET, ENOTFOUND, a connect timeout…).
  // Surface it so a transient blip and a real outage read differently on
  // the admin page and in the alarm (issue #347).
  const cause =
    err instanceof Error && err.cause instanceof Error ? err.cause.message : null;
  const name = err instanceof Error ? err.name : "Error";
  const msg = err instanceof Error ? err.message : String(err);
  return `GET ${url} → ${name === "TimeoutError" ? "timed out" : msg}${cause ? ` (${cause})` : ""}`;
}

/**
 * GET a text body. Throws on non-2xx and on a bot-wall page served with a
 * 200, with the upstream `server` header and a short tag-stripped excerpt
 * in the message so the admin page and the alarm email say *why*.
 */
export async function fetchText(url: string, opts: FetchTextOptions = {}): Promise<string> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const { target, viaProxy } = resolveFetchTarget(url, opts.useProxy ?? false);
  const headers = viaProxy
    ? undefined // the proxy supplies its own browser fingerprint
    : { ...BROWSER_HEADERS, ...(opts.accept ? { accept: opts.accept } : {}) };
  const retryDelayMs = opts.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS;

  let res: Response | null = null;
  let lastNetworkError: string | null = null;
  for (let attempt = 1; attempt <= NETWORK_RETRY_ATTEMPTS; attempt++) {
    try {
      res = await fetchImpl(target, {
        headers,
        redirect: "follow",
        signal: AbortSignal.timeout(viaProxy ? PROXY_FETCH_TIMEOUT_MS : FETCH_TIMEOUT_MS),
      });
      if (attempt > 1) {
        console.info(`[water-advisories] retry succeeded for ${url} after: ${lastNetworkError}`);
      }
      break;
    } catch (err) {
      lastNetworkError = describeNetworkError(url, err);
      if (attempt < NETWORK_RETRY_ATTEMPTS) {
        console.warn(`[water-advisories] attempt ${attempt} failed, retrying once: ${lastNetworkError}`);
        if (retryDelayMs > 0) await new Promise((r) => setTimeout(r, retryDelayMs));
      }
    }
  }
  if (!res) throw new Error(`${lastNetworkError} — failed ${NETWORK_RETRY_ATTEMPTS} attempts`);

  const body = await res.text();
  const botWall = /Access Denied|errors\.edgesuite\.net|Reference&#32;#|Reference #/i.test(
    body.slice(0, 4_000),
  );
  if (!res.ok || botWall) {
    const excerpt = body
      .replace(/<[^>]+>/g, " ")
      .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 160);
    // The relay forwards only content-type/etag/last-modified from the
    // origin and reports the origin's `server` separately, so a bot wall
    // seen through it still names Akamai.
    const served = res.headers.get("server") ?? res.headers.get("x-relay-upstream-server") ?? "";
    throw new Error(
      `GET ${url} → ${res.status}${botWall ? " bot wall" : ""}${served ? ` (server: ${served})` : ""}${excerpt ? ` — ${excerpt}` : ""}`,
    );
  }
  return body;
}
