// Fetching for the scrapers: State's pages, which sit behind Cloudflare on
// travel.state.gov and are also served, without it, on adoption.state.gov,
// and the Wayback Machine, which is the fallback for both.

export const USER_AGENT = "visawhen-bot (+https://github.com/underyx/visawhen)";
export const HEADERS = {
  "User-Agent": USER_AGENT,
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
};

// travel.state.gov sits behind Cloudflare, which answers non-browser clients
// with a 403 challenge page. State serves the same pages and files from
// adoption.state.gov without Cloudflare in front of them; that host is not
// advertised and could go away, so it is only the second choice.
export const STATE_HOSTS = [
  "https://travel.state.gov",
  "https://adoption.state.gov",
] as const;

const TIMEOUT_MS = 60_000;
// Save Page Now fetches the page itself before it answers
const SAVE_TIMEOUT_MS = 180_000;
const CDX_URL = "https://web.archive.org/cdx/search/cdx";

// Signs of the bot challenge Cloudflare serves in place of the page, which it
// may do with HTTP 200
const CHALLENGE_MARKERS = [
  "/cdn-cgi/challenge-platform/",
  "<title>Just a moment...</title>",
  "Attention Required! | Cloudflare",
];

export const sleep = (ms: number) => Bun.sleep(ms);

export function withParams(url: string, params?: Record<string, string>) {
  return params ? `${url}?${new URLSearchParams(params)}` : url;
}

/** GET with HEADERS and a timeout; throws on a network error or timeout. */
export function get(
  url: string,
  options: {
    params?: Record<string, string>;
    timeoutMs?: number;
    redirect?: RequestRedirect;
    headers?: Record<string, string>;
  } = {},
): Promise<Response> {
  return fetch(withParams(url, options.params), {
    headers: { ...HEADERS, ...options.headers },
    signal: AbortSignal.timeout(options.timeoutMs ?? TIMEOUT_MS),
    redirect: options.redirect ?? "follow",
  });
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Whether a page is Cloudflare's bot challenge rather than State's */
export function isChallenge(html: string): boolean {
  return CHALLENGE_MARKERS.some((marker) => html.includes(marker));
}

/** The page's <title>, to say in an error what a source served */
export function pageTitle(html: string): string {
  const match = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  return match ? match[1].split(/\s+/).filter(Boolean).join(" ") : "(no title)";
}

/** The page's HTML on HTTP 200, null otherwise, or when it is a bot challenge.
 * Says why in the log. */
export async function fetchPage(url: string): Promise<string | null> {
  let response: Response;
  let html: string;
  try {
    response = await get(url);
    html = await response.text();
  } catch (error) {
    console.log(`${url}: request failed: ${errorMessage(error)}`);
    return null;
  }
  if (response.status !== 200) {
    console.log(`${url}: HTTP ${response.status}`);
    return null;
  }
  if (isChallenge(html)) {
    console.log(
      `${url}: HTTP 200, but a bot challenge page (${JSON.stringify(pageTitle(html))})`,
    );
    return null;
  }
  return html;
}

/** GET from web.archive.org, retrying through its frequent 429 and 5xx
 * answers, resets and timeouts, waiting backoffMs(attempt) in between; null
 * when every attempt failed, or at once on another 4xx, such as a 404 for
 * no capture. The body is read, so that a reset halfway through is retried
 * too. */
export async function waybackGet(
  url: string,
  options: {
    params?: Record<string, string>;
    attempts?: number;
    timeoutMs?: number;
    backoffMs?: (attempt: number) => number;
  } = {},
): Promise<{ url: string; status: number; text: string } | null> {
  const attempts = options.attempts ?? 3;
  const backoffMs = options.backoffMs ?? ((attempt) => 5000 * attempt);
  const fullUrl = withParams(url, options.params);
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const response = await get(fullUrl, { timeoutMs: options.timeoutMs });
      const text = await response.text();
      if (response.status === 200) {
        return { url: response.url, status: response.status, text };
      }
      console.log(
        `Wayback returned HTTP ${response.status} (${attempt}/${attempts}) for ${response.url}`,
      );
      if (response.status < 500 && response.status !== 429) return null;
    } catch (error) {
      console.log(
        `Wayback request failed (${attempt}/${attempts}): ${errorMessage(error)}: ${fullUrl}`,
      );
    }
    if (attempt < attempts) await sleep(backoffMs(attempt));
  }
  return null;
}

/** The unmodified (`id_`) body of a capture: the one taken at timestamp, or
 * the nearest one to it. */
export function waybackUrl(timestamp: string, url: string): string {
  return `https://web.archive.org/web/${timestamp}id_/${url}`;
}

/** The rows the Wayback Machine's CDX index has for a URL (a `*` wildcard
 * may end it), without the header row; null when the index did not answer.
 * fl names the fields of each row. */
export async function cdx(
  url: string,
  params: Record<string, string>,
  options: {
    attempts?: number;
    timeoutMs?: number;
    backoffMs?: (attempt: number) => number;
  } = {},
): Promise<string[][] | null> {
  const response = await waybackGet(CDX_URL, {
    ...options,
    params: { url: url.replace(/^https?:\/\//, ""), output: "json", ...params },
  });
  if (response === null) return null;
  if (!response.text.trim()) return [];
  try {
    const rows = JSON.parse(response.text) as string[][];
    // the first row is a header, present only when there are results at all
    return rows.slice(1);
  } catch {
    console.log(
      `CDX API returned non-JSON: ${JSON.stringify(response.text.slice(0, 200))}`,
    );
    return null;
  }
}

/** Ask the Wayback Machine to capture url now, so that the fallback has
 * something to fall back to. Best effort: a failure is a warning. */
export async function savePageNow(url: string): Promise<void> {
  let response: Response;
  try {
    response = await get(`https://web.archive.org/save/${url}`, {
      timeoutMs: SAVE_TIMEOUT_MS,
      redirect: "manual",
    });
    await response.arrayBuffer();
  } catch (error) {
    console.log(
      `::warning::Save Page Now failed for ${url}: ${errorMessage(error)}`,
    );
    return;
  }
  const location =
    response.headers.get("Location") ||
    response.headers.get("Content-Location") ||
    "";
  const match = /\/web\/(\d{14})/.exec(location);
  if (![200, 302].includes(response.status) || match === null) {
    console.log(
      `::warning::Save Page Now did not capture ${url} (HTTP ${response.status})`,
    );
    return;
  }
  console.log(`Save Page Now captured ${url} as ${match[1]}`);
}
