// Scrape NVC processing time frames into data.json.
//
// Sources, in order:
//
// 1. The page on travel.state.gov. It sits behind Cloudflare, which answers
//    non-browser clients with a 403 challenge page.
// 2. The same page on adoption.state.gov. State serves the same content from
//    that host without Cloudflare in front of it. The host is not advertised
//    and could go away, so it is only a fallback.
// 3. The Wayback Machine, for captures of either page newer than our newest
//    reading, when no live page parses or the one that does is more than a
//    week old.
// 4. With --search, Google's search results for the page on travel.state.gov,
//    when none of the above had anything new and a new weekly reading is due.
//    Google may crawl the page, and the short text it shows under a result
//    quotes the sentence that was searched for, so one search per timeframe
//    reads all three. The searches go through serper.dev and need
//    SERPER_API_KEY; each costs one credit, so the first one alone decides
//    whether Google's copy is newer than data.json, and the workflow passes
//    --search on a few runs a week only.
//
//     bun data/nvc/main.ts                        # the sources above, 1 to 3
//     bun data/nvc/main.ts --search               # 1 to 4
//     bun data/nvc/main.ts --from-file page.html  # a saved page, or its text
//
// --from-file reads a page saved from a browser instead, or a text file with
// the page's text pasted into it (the three sentences are enough), and adds
// the readings data.json does not have yet.
//
// Every source is dated by its own content ("As of 21-Sep-26"), and a date
// that is already in data.json is never overwritten, so a stale source can
// never insert wrong data: the as_of date is the key.
//
// Requests carry an honest user agent. After a run that added new data, the
// Wayback Machine is asked to capture both pages (Save Page Now), so that the
// fallback has captures to fall back to; that is best effort and never fails
// the run. It happens only after a run that added data rather than after
// every successful fetch, on purpose: the workflow runs this about 30 times
// on a Monday and daily otherwise, and a capture of a page the archive
// already holds adds nothing.
//
// Exit codes: 0 when new data was added or when every source is simply
// unavailable or stale (a `::warning::` annotation is printed in the latter
// case, and the freshness workflow opens an issue once the data gets too
// old, see data/freshness.ts); 1 when a page was served but no longer matches
// our patterns and no source had anything new, when the file given to
// --from-file cannot be read or holds no timeframe, or on any other error.
import { join } from "node:path";
import { parseArgs } from "node:util";
import {
  STATE_HOSTS,
  USER_AGENT,
  cdx,
  errorMessage,
  fetchPage,
  savePageNow,
  waybackGet,
  waybackUrl,
} from "../lib/http";
import { readJson, writeJson } from "../lib/json";

type TimeframeName = "creation" | "review" | "inquiry";
type Data = Record<TimeframeName, Record<string, number>>;
// per timeframe: [as_of date in ISO format, number of days of backlog]
type Parsed = Partial<Record<TimeframeName, [string, number]>>;

const PAGE_PATH = "/content/travel/en/us-visas/immigrate/nvc-timeframes.html";
// The live sources, in the order they are tried
const LIVE_URLS = STATE_HOSTS.map((host) => `${host}${PAGE_PATH}`);
const DATA_PATH =
  process.env.NVC_DATA_PATH ?? join(import.meta.dir, "data.json");
// A live page older than this many days may be a stale copy; see main()
const LIVE_MAX_AGE_DAYS = 7;
// NVC updates the page weekly, so Google's results are searched only once
// the newest reading is this many days old
const SEARCH_MIN_AGE_DAYS = 7;
const SEARCH_URL = "https://google.serper.dev/search";
const SEARCH_TIMEOUT_MS = 30_000;
// What each search asks Google for, in quotes: words of the timeframe's
// sentence that never change, so that the text under the result quotes it.
// The first is the one that decides whether Google's copy is new.
const SEARCH_PHRASES: Record<TimeframeName, string> = {
  creation: "we are working on cases that were received from USCIS on",
  review: "we are reviewing documents submitted to us on",
  inquiry: "we are responding to inquiries received on",
};

const DATE = String.raw`\d+-\w+-\d+`;
const PATTERNS: Record<TimeframeName, RegExp> = {
  creation: new RegExp(
    String.raw`Current case creation time frame: As of (?<asOf>${DATE}), we are working on cases that were received from USCIS on (?<latest>${DATE})\.`,
  ),
  review: new RegExp(
    String.raw`Current case review time: As of (?<asOf>${DATE}), we are reviewing documents submitted to us on (?<latest>${DATE})\.`,
  ),
  inquiry: new RegExp(
    String.raw`As of (?<asOf>${DATE}), we are responding to inquiries received on (?<latest>${DATE})\.`,
  ),
};
const TIMEFRAMES = Object.keys(PATTERNS) as TimeframeName[];

const MONTH_NAMES = [
  "january",
  "february",
  "march",
  "april",
  "may",
  "june",
  "july",
  "august",
  "september",
  "october",
  "november",
  "december",
];

/** "21-Sep-26", "21-September-2026" or "1-Sep-2026" as a UTC date. Two-digit
 * years 69 to 99 are 1969 to 1999, as arrow read them. */
export function parseDate(text: string): Date {
  const match = /^(\d{1,2})-([A-Za-z]+)-(\d{2}|\d{4})$/.exec(text);
  const name = match?.[2].toLowerCase() ?? "";
  const month = MONTH_NAMES.findIndex(
    (full) => full === name || full.slice(0, 3) === name,
  );
  if (match === null || month === -1)
    throw new Error(`cannot read the date ${text}`);
  let year = Number(match[3]);
  if (match[3].length === 2) year += year > 68 ? 1900 : 2000;
  const date = new Date(Date.UTC(year, month, Number(match[1])));
  if (date.getUTCMonth() !== month)
    throw new Error(`cannot read the date ${text}`);
  return date;
}

const isoDate = (date: Date) => date.toISOString().slice(0, 10);
const DAY_MS = 86_400_000;

/** [as_of date, backlog days] per timeframe; timeframes that don't match are
 * left out. */
export function parsePage(html: string): Parsed {
  // also through line breaks, which text pasted by hand may have mid-sentence
  const text = html
    .replaceAll("&nbsp;", " ")
    .replaceAll(" ", " ")
    .replace(/\s+/g, " ");
  const parsed: Parsed = {};
  for (const name of TIMEFRAMES) {
    const match = PATTERNS[name].exec(text);
    if (match === null) continue;
    const asOf = parseDate(match.groups!.asOf);
    const latest = parseDate(match.groups!.latest);
    parsed[name] = [
      isoDate(asOf),
      Math.round((asOf.getTime() - latest.getTime()) / DAY_MS),
    ];
  }
  return parsed;
}

const entries = (parsed: Parsed) =>
  Object.entries(parsed) as [TimeframeName, [string, number]][];

/** Add as_of dates we haven't seen yet to data; return whether anything was
 * added. */
function merge(data: Data, parsed: Parsed, source: string): boolean {
  let changed = false;
  for (const [name, [asOf, days]] of entries(parsed)) {
    if (asOf in data[name]) continue;
    data[name][asOf] = days;
    changed = true;
    console.log(`+ ${name} ${asOf}: ${days} days (${source})`);
  }
  return changed;
}

const latestAsOf = (data: Data) =>
  TIMEFRAMES.flatMap((name) => Object.keys(data[name]))
    .sort()
    .at(-1)!;

const daysSince = (date: string) =>
  Math.floor((Date.parse(isoDate(new Date())) - Date.parse(date)) / DAY_MS);

const describe = (parsed: Parsed) =>
  [...new Set(entries(parsed).map(([, [asOf]]) => asOf))].sort().join(", ");

/** The first live source whose page parses and what it says, or [null, {}],
 * and the sources that served a page (HTTP 200) that did not parse. */
async function fetchLive(): Promise<[string | null, Parsed, string[]]> {
  const unparseable: string[] = [];
  for (const url of LIVE_URLS) {
    const html = await fetchPage(url);
    if (html === null) continue;
    const parsed = parsePage(html);
    if (Object.keys(parsed).length > 0) return [url, parsed, unparseable];
    console.log(
      `${url} was served (HTTP 200) but matched no timeframe pattern`,
    );
    unparseable.push(url);
  }
  return [null, {}, unparseable];
}

/** [timestamp, url] of the newest HTTP 200 captures of either page since the
 * given YYYYMMDD, oldest first; null when the CDX API is unavailable for both
 * pages. */
async function waybackCaptures(
  since: string,
): Promise<[string, string][] | null> {
  const captures: [string, string][] = [];
  let answered = false;
  for (const url of LIVE_URLS) {
    const rows = await cdx(url, {
      fl: "timestamp,statuscode",
      filter: "statuscode:200",
      from: since,
      // newest N captures; the page changes weekly and is captured a few
      // times a month, so this covers a blackout of a couple of months
      limit: "-20",
    });
    if (rows === null) continue;
    answered = true;
    captures.push(
      ...rows.map(([timestamp]): [string, string] => [timestamp, url]),
    );
  }
  return answered
    ? captures.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    : null;
}

/** Merge data from Wayback captures newer than what we already have. Returns
 * [changed, why nothing changed]. */
async function fetchWayback(data: Data): Promise<[boolean, string]> {
  const since = latestAsOf(data).replaceAll("-", "");
  const captures = await waybackCaptures(since);
  if (captures === null) return [false, "the Wayback Machine is unavailable"];
  if (captures.length === 0) {
    return [
      false,
      `the Wayback Machine has no HTTP 200 capture of the page since ${since}`,
    ];
  }
  let changed = false;
  for (const [timestamp, url] of captures) {
    const response = await waybackGet(waybackUrl(timestamp, url));
    if (response === null) continue;
    const parsed = parsePage(response.text);
    if (Object.keys(parsed).length === 0) {
      console.log(
        `Wayback capture ${timestamp} of ${url} matched no timeframe pattern`,
      );
      continue;
    }
    console.log(
      `Wayback capture ${timestamp} of ${url} is as of ${describe(parsed)}`,
    );
    changed =
      merge(data, parsed, `Wayback capture ${timestamp} of ${url}`) || changed;
  }
  return [
    changed,
    `Wayback captures since ${since} hold nothing newer than ${latestAsOf(data)}`,
  ];
}

/** Whether a search result is State's NVC timeframes page itself, at its old
 * address or in the newer /en/ scheme, rather than another page quoting it. */
export function isNvcPage(link: string): boolean {
  let url: URL;
  try {
    url = new URL(link);
  } catch {
    return false;
  }
  return (
    url.hostname === "travel.state.gov" &&
    url.pathname.endsWith("/nvc-timeframes.html")
  );
}

type SearchResults = { organic?: { link?: string; snippet?: string }[] };

/** The text Google shows under its results for State's page; "" when it has
 * no result for the page. */
export function pageSnippets(results: SearchResults): string {
  return (results.organic ?? [])
    .filter((result) => isNvcPage(result.link ?? ""))
    .map((result) => result.snippet ?? "")
    .join("\n");
}

/** What Google shows under its result for State's page when asked for a
 * timeframe's sentence: the sentence, if Google quotes it in full. Null when
 * the search failed, "" when it has no result for the page. */
async function searchSnippet(name: TimeframeName): Promise<string | null> {
  const query = `site:travel.state.gov "${SEARCH_PHRASES[name]}"`;
  let response: Response;
  let body: SearchResults;
  try {
    response = await fetch(SEARCH_URL, {
      method: "POST",
      headers: {
        "User-Agent": USER_AGENT,
        "X-API-KEY": process.env.SERPER_API_KEY ?? "",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ q: query }),
      signal: AbortSignal.timeout(SEARCH_TIMEOUT_MS),
    });
    if (response.status !== 200) {
      console.log(`Search for the ${name} sentence: HTTP ${response.status}`);
      return null;
    }
    body = (await response.json()) as typeof body;
  } catch (error) {
    console.log(
      `Search for the ${name} sentence failed: ${errorMessage(error)}`,
    );
    return null;
  }
  return pageSnippets(body);
}

/** Merge what Google's search results quote from State's page. Returns
 * [changed, why nothing changed]. */
export async function fetchSearch(
  data: Data,
  search: (name: TimeframeName) => Promise<string | null> = searchSnippet,
): Promise<[boolean, string]> {
  const newest = latestAsOf(data);
  const found: Parsed = {};
  for (const name of TIMEFRAMES) {
    const snippet = await search(name);
    if (snippet === null) return [false, "the search did not answer"];
    const reading = parsePage(snippet)[name];
    if (reading === undefined) {
      console.log(
        `Google's result for the ${name} sentence does not quote it in full: ${JSON.stringify(snippet)}`,
      );
    } else {
      console.log(
        `Google's copy of the ${name} sentence is as of ${reading[0]}`,
      );
      found[name] = reading;
    }
    // One search is enough to see that Google has nothing new
    if (
      name === TIMEFRAMES[0] &&
      (reading === undefined || reading[0] <= newest)
    ) {
      return [
        false,
        reading === undefined
          ? "Google's search results do not quote the page"
          : `Google's copy of the page holds nothing newer than ${newest}`,
      ];
    }
  }
  const missing = TIMEFRAMES.filter((name) => !(name in found));
  if (missing.length > 0) {
    console.log(
      `::warning::Google's search results quoted no ${missing.join(", ")} sentence; ` +
        "add those readings with --from-file if they stay missing.",
    );
  }
  return [
    merge(data, found, "Google's search results for travel.state.gov"),
    `Google's copy of the page holds nothing newer than ${newest}`,
  ];
}

/** Each timeframe chronological, even if a fallback filled in an older gap. */
async function save(data: Data): Promise<void> {
  for (const name of TIMEFRAMES) {
    data[name] = Object.fromEntries(
      Object.entries(data[name]).sort(([a], [b]) => (a < b ? -1 : 1)),
    );
  }
  await writeJson(DATA_PATH, data);
}

/** --from-file: add the readings of a saved page, or of its pasted text. */
async function addFromFile(data: Data, path: string): Promise<number> {
  let text: string;
  try {
    text = await Bun.file(path).text();
  } catch (error) {
    console.error(`ERROR: cannot read ${path}: ${errorMessage(error)}`);
    return 1;
  }
  const parsed = parsePage(text);
  if (Object.keys(parsed).length === 0) {
    console.error(
      `ERROR: ${path} holds none of the timeframe sentences ("As of 21-Sep-26, we are ..."). ` +
        "If it is State's page, saved in full, State has changed its wording: update PATTERNS in data/nvc/main.ts.",
    );
    return 1;
  }
  console.log(`${path} is as of ${describe(parsed)}`);
  const missing = TIMEFRAMES.filter((name) => !(name in parsed));
  if (missing.length > 0) {
    console.log(`::warning::${path} has no ${missing.join(", ")} sentence`);
  }
  if (merge(data, parsed, path)) {
    await save(data);
    console.log(`Wrote ${DATA_PATH}`);
  } else {
    console.log(`${DATA_PATH} already has these readings`);
  }
  return 0;
}

async function main(): Promise<number> {
  const { values } = parseArgs({
    options: {
      "from-file": { type: "string" },
      search: { type: "boolean" },
    },
  });
  const data = await readJson<Data>(DATA_PATH);
  console.log(`Latest as_of date in ${DATA_PATH}: ${latestAsOf(data)}`);
  if (values["from-file"] !== undefined) {
    return addFromFile(data, values["from-file"]);
  }

  const [liveUrl, liveParsed, unparseable] = await fetchLive();

  let changed = false;
  let reason = "";
  if (liveUrl !== null) {
    console.log(`${liveUrl} is as of ${describe(liveParsed)}`);
    const missing = TIMEFRAMES.filter((name) => !(name in liveParsed));
    if (missing.length > 0) {
      console.log(
        `::warning::The NVC page matched no pattern for ${missing.sort().join(", ")}; ` +
          "the site may have changed its wording for those. Update PATTERNS in data/nvc/main.ts.",
      );
    }
    changed = merge(data, liveParsed, liveUrl);
    reason = `${liveUrl} holds nothing newer than ${latestAsOf(data)}`;
  }
  // NVC updates the page weekly, so a live page older than a week may be a
  // stale copy (the mirror could stop being updated); the archive may hold a
  // newer capture then.
  const liveAge =
    liveUrl === null
      ? null
      : daysSince(
          entries(liveParsed)
            .map(([, [asOf]]) => asOf)
            .sort()
            .at(-1)!,
        );
  if (liveAge === null || liveAge > LIVE_MAX_AGE_DAYS) {
    console.log(
      `${liveAge === null ? "No live source parsed" : `${liveUrl} is ${liveAge} days old`}; trying the Wayback Machine`,
    );
    const [waybackChanged, waybackReason] = await fetchWayback(data);
    changed = waybackChanged || changed;
    reason = reason ? `${reason}; ${waybackReason}` : waybackReason;
  }
  // The last resort, and one that costs search credits: only when asked to,
  // and only when a new weekly reading is due.
  if (
    values.search &&
    !changed &&
    daysSince(latestAsOf(data)) >= SEARCH_MIN_AGE_DAYS
  ) {
    console.log("Nothing new so far; asking Google's search results");
    const [searchChanged, searchReason] = process.env.SERPER_API_KEY
      ? await fetchSearch(data)
      : ([false, "SERPER_API_KEY is not set, so no search"] as const);
    changed = searchChanged;
    reason = `${reason}; ${searchReason}`;
  }

  if (changed) {
    await save(data);
    console.log(`Wrote ${DATA_PATH}`);
    if (liveUrl !== null) {
      for (const url of LIVE_URLS) await savePageNow(url);
    } else if (unparseable.length > 0) {
      console.log(
        `::warning::${unparseable.join(", ")} was served but matched no timeframe pattern; the site may have changed`,
      );
    }
    return 0;
  }

  if (liveUrl === null && unparseable.length > 0) {
    console.error(
      `ERROR: ${unparseable.join(", ")} was served (HTTP 200) but none of the timeframe patterns matched, ` +
        "and the Wayback Machine had nothing newer either. The site has probably changed its wording " +
        "or layout; update PATTERNS in data/nvc/main.ts.",
    );
    return 1;
  }

  console.log(`::warning::No new NVC data: ${reason}`);
  return 0;
}

if (import.meta.main) process.exit(await main());
