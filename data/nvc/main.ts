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
// our patterns and no source had anything new, or on any other error.
import { join } from "node:path";
import {
  STATE_HOSTS,
  cdx,
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
  const text = html.replaceAll("&nbsp;", " ").replaceAll(" ", " ");
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

/** Each timeframe chronological, even if a fallback filled in an older gap. */
async function save(data: Data): Promise<void> {
  for (const name of TIMEFRAMES) {
    data[name] = Object.fromEntries(
      Object.entries(data[name]).sort(([a], [b]) => (a < b ? -1 : 1)),
    );
  }
  await writeJson(DATA_PATH, data);
}

async function main(): Promise<number> {
  const data = await readJson<Data>(DATA_PATH);
  console.log(`Latest as_of date in ${DATA_PATH}: ${latestAsOf(data)}`);

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
