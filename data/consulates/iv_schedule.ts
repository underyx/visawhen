// Add a snapshot of State's IV Scheduling Status Tool to iv_schedule.json.
//
// The tool lists, for each immigrant visa post, the month of documentarily
// complete cases NVC is scheduling interviews for, in three columns:
// immediate relatives, family preference and employment. State only ever
// shows its latest monthly update, so every snapshot kept here is history
// nobody else keeps.
//
//     bun data/consulates/iv_schedule.ts --fetch
//     bun data/consulates/iv_schedule.ts --from-file page.html
//
// --fetch downloads the page from these, in order:
//
// 1. travel.state.gov. It sits behind Cloudflare, which answers non-browser
//    clients with a 403 challenge page (a challenge page served with HTTP 200
//    counts as not served).
// 2. The same page on adoption.state.gov, which State serves without
//    Cloudflare in front of it. The host is not advertised and could go away.
// 3. The newest Wayback Machine capture of either page since the newest
//    snapshot's date.
//
// It stops at the first page that parses, lists at least MIN_POST_SHARE of
// the newest snapshot's posts, and is neither older than the newest snapshot
// nor more than LIVE_MAX_AGE_DAYS old; a page that fails the last two checks
// may be a stale copy (the mirror could stop being updated), so the next
// source is tried too, and the newest page wins. A page listing too few
// posts, say a truncated one, is refused: it would become the newest
// snapshot, the only one the site reads, and take the interview card off
// every post it leaves out.
//
// --fetch adds the page's update only when it is newer than the newest
// snapshot in iv_schedule.json, and after adding one asks the Wayback Machine
// to capture both pages (best effort, as in data/nvc/main.ts). It asks only
// after a run that added a snapshot, not after every successful fetch, on
// purpose: the workflow runs this about 30 times on a Monday and daily
// otherwise, and a capture of an update the archive already holds adds
// nothing. --from-file parses a page saved from a browser instead, and adds
// its update when iv_schedule.json does not have it yet, however old it is
// and however many posts it lists.
//
// The page's single table is parsed, the snapshot is dated by the page's
// "Last Updated: September 23, 2026" line, and State's post names are mapped
// to the site's post slugs (from dump/post_slugs.ndjson). A snapshot date
// that is already in iv_schedule.json is never overwritten.
//
// Exit codes: 0 when a snapshot was added, when there was nothing newer, or
// when --fetch could not reach any source (a `::warning::` annotation is
// printed then; the freshness workflow opens an issue once the newest
// snapshot gets too old, see data/freshness.ts); 1 when the page no longer
// parses (for --fetch: some source served a page and none served one that
// parses and lists enough posts), a post name matches no site post slug (add
// it to ALIASES), or a file cannot be read, in which case nothing is written.
import { join } from "node:path";
import { parseArgs } from "node:util";
import { findAll, parseHtml, strippedText, text } from "../lib/html";
import {
  STATE_HOSTS,
  cdx,
  errorMessage,
  fetchPage,
  pageTitle,
  savePageNow,
  waybackGet,
  waybackUrl,
} from "../lib/http";
import { writeJson } from "../lib/json";

const DATA_PATH = join(import.meta.dir, "iv_schedule.json");
const POST_SLUGS_PATH = join(import.meta.dir, "dump", "post_slugs.ndjson");
const PAGE_PATH =
  "/content/travel/en/us-visas/visa-information-resources/iv-wait-times.html";
// The live sources, in the order --fetch tries them
const LIVE_URLS = STATE_HOSTS.map((host) => `${host}${PAGE_PATH}`);
const SOURCE_URL = LIVE_URLS[0];
// State updates the tool about monthly, so a page from --fetch older than
// this may be a stale copy, and the next source is tried too; the freshness
// check and the consulate pages call the data stale from then on as well
const LIVE_MAX_AGE_DAYS = 45;
// --fetch refuses a page that lists fewer posts than this share of the newest
// snapshot's (all snapshots so far list 142)
const MIN_POST_SHARE = 0.9;

const HEADER = ["Post", "Employment Visa", "Preference Visa", "Relative Visa"];
const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];
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
// "Feb-26"; some updates spell the year out, "Feb-2026"
const MONTH_PATTERN = /^(?<month>[A-Z][a-z]{2})-(?<year>\d{2}|\d{4})$/;
// "September 23, 2026", and variants such as "Sept. 23 2026" or "9/23/2026"
const LAST_UPDATED_PATTERN =
  /Last Updated:\s*(?:(?<monthName>[A-Za-z]+)\.?\s+(?<day>\d{1,2}),?\s+(?<year>\d{4})|(?<monthNumber>\d{1,2})\/(?<numericDay>\d{1,2})\/(?<numericYear>\d{4}))/g;
// Cells that mean State gives no month for the post
const MISSING = new Set(["N/A", "NA", "null", ""]);
// State's names that don't reduce to a site post slug by dropping everything
// but the letters
const ALIASES: Record<string, string> = {
  "Mumbai (Bombay)": "mumbai",
  Kuwait: "kuwait-city",
  Ulaanbataar: "ulaanbaatar",
};
// The table has a row for a post literally named "null"
const SKIPPED_POSTS = new Set(["null"]);

/** The months NVC is scheduling at a post, "2026-02", or null for N/A */
interface PostSchedule {
  name: string;
  relative: string | null;
  preference: string | null;
  employment: string | null;
}
type Snapshot = Record<string, PostSchedule>;
// Per State post name, its [employment, preference, relative] months
type Posts = Map<string, [string | null, string | null, string | null]>;

interface Data {
  source: string;
  snapshots: Record<string, Snapshot>;
}

/** A page that parsed: where it came from, its update's date and its posts */
interface Page {
  source: string;
  asOf: string;
  posts: Posts;
}

class ParseError extends Error {}
/** A file this script needs is missing or unreadable. */
class InputError extends Error {}

const repr = (value: unknown) => JSON.stringify(value);
const letters = (value: string) => value.toLowerCase().replace(/[^a-z]/g, "");
const byKey = ([a]: [string, unknown], [b]: [string, unknown]) =>
  a < b ? -1 : a > b ? 1 : 0;

/** "Feb-26" or "Feb-2026" as "2026-02"; "N/A" as null */
export function parseMonth(value: string): string | null {
  if (MISSING.has(value)) return null;
  const match = MONTH_PATTERN.exec(value);
  const month = match ? MONTHS.indexOf(match.groups!.month) : -1;
  if (match === null || month === -1)
    throw new ParseError(`Unexpected month ${repr(value)}`);
  const year =
    match.groups!.year.length === 4
      ? match.groups!.year
      : `20${match.groups!.year}`;
  return `${year}-${String(month + 1).padStart(2, "0")}`;
}

/** "Sept", "Sep" or "September" as 9 */
function monthNumber(name: string): number {
  const lowered = name.toLowerCase();
  const matches = MONTH_NAMES.flatMap((month, index) =>
    lowered.length >= 3 && month.startsWith(lowered) ? [index + 1] : [],
  );
  if (matches.length !== 1) {
    throw new ParseError(
      `Unexpected month ${repr(name)} in the 'Last Updated' date`,
    );
  }
  return matches[0];
}

export function parseLastUpdated(pageText: string): string {
  const dates = new Set<string>();
  for (const match of pageText.matchAll(LAST_UPDATED_PATTERN)) {
    const groups = match.groups!;
    const [year, month, day] =
      groups.monthName !== undefined
        ? [
            Number(groups.year),
            monthNumber(groups.monthName),
            Number(groups.day),
          ]
        : [
            Number(groups.numericYear),
            Number(groups.monthNumber),
            Number(groups.numericDay),
          ];
    const date = new Date(Date.UTC(year, month - 1, day));
    if (
      month < 1 ||
      month > 12 ||
      day < 1 ||
      date.getUTCMonth() !== month - 1
    ) {
      throw new ParseError(
        `The 'Last Updated' date is not a date: ${repr(match[0])}`,
      );
    }
    dates.add(date.toISOString().slice(0, 10));
  }
  if (dates.size !== 1) {
    const found = dates.size ? repr([...dates].sort()) : "none";
    throw new ParseError(
      `Expected one 'Last Updated' date on the page, found ${found}`,
    );
  }
  return [...dates][0];
}

/** The snapshot date and, per State post name, its [employment, preference,
 * relative] months. */
export function parsePage(html: string): [string, Posts] {
  const document = parseHtml(html);
  const tables = findAll(document, "table");
  if (tables.length !== 1) {
    throw new ParseError(
      `Expected one table on the page, found ${tables.length}`,
    );
  }
  const rows = findAll(tables[0], "tr");
  if (rows.length === 0) throw new ParseError("The table has no rows");
  const cellsOf = (row: (typeof rows)[number]) =>
    findAll(row, ["th", "td"]).map(strippedText);
  const header = cellsOf(rows[0]);
  if (repr(header) !== repr(HEADER)) {
    throw new ParseError(`Unexpected table header ${repr(header)}`);
  }

  const posts: Posts = new Map();
  for (const row of rows.slice(1)) {
    const cells = cellsOf(row);
    if (cells.length !== HEADER.length)
      throw new ParseError(`Unexpected row ${repr(cells)}`);
    const [name, employment, preference, relative] = cells;
    if (SKIPPED_POSTS.has(name)) continue;
    if (posts.has(name)) throw new ParseError(`${name} is in the table twice`);
    posts.set(name, [
      parseMonth(employment),
      parseMonth(preference),
      parseMonth(relative),
    ]);
  }
  if (posts.size === 0) throw new ParseError("The table has no posts");
  return [parseLastUpdated(text(document, " ")), posts];
}

/** The site's post slugs, from the consulates database's dump. */
async function loadPostSlugs(): Promise<string[]> {
  try {
    const lines = (await Bun.file(POST_SLUGS_PATH).text()).split("\n");
    return lines
      .filter((line) => line.trim())
      .map((line) => JSON.parse(line)[0] as string);
  } catch (error) {
    throw new InputError(
      `cannot read the site's post slugs from ${POST_SLUGS_PATH}: ${errorMessage(error)}`,
    );
  }
}

/** Each State post name's site post slug, and the names that match none */
export function matchSlugs(
  names: string[],
  postSlugs: string[],
): [Map<string, string>, string[]] {
  const byLetters = new Map(postSlugs.map((slug) => [letters(slug), slug]));
  const matched = new Map<string, string>();
  const unmatched: string[] = [];
  for (const name of names) {
    const slug =
      (Object.hasOwn(ALIASES, name) ? ALIASES[name] : undefined) ??
      byLetters.get(letters(name));
    if (slug === undefined || !postSlugs.includes(slug)) unmatched.push(name);
    else matched.set(name, slug);
  }
  return [matched, unmatched];
}

async function loadData(path: string): Promise<Data> {
  const file = Bun.file(path);
  if (!(await file.exists())) return { source: SOURCE_URL, snapshots: {} };
  try {
    return (await file.json()) as Data;
  } catch (error) {
    throw new InputError(`cannot read ${path}: ${errorMessage(error)}`);
  }
}

async function saveData(data: Data, path: string): Promise<void> {
  data.snapshots = Object.fromEntries(
    Object.entries(data.snapshots)
      .sort(byKey)
      .map(([asOf, snapshot]) => [
        asOf,
        Object.fromEntries(Object.entries(snapshot).sort(byKey)),
      ]),
  );
  await writeJson(path, data);
}

// --- fetching (--fetch) -------------------------------------------------------

/** [timestamp, url] of the newest HTTP 200 capture of either page, since the
 * given day, "2026-09-23", if one is given. */
async function newestCapture(
  since: string | undefined,
): Promise<[string, string] | null> {
  const captures: [string, string][] = [];
  const params: Record<string, string> = {
    fl: "timestamp",
    filter: "statuscode:200",
    limit: "-1",
  };
  if (since !== undefined) params.from = since.replaceAll("-", "");
  for (const url of LIVE_URLS) {
    const rows = await cdx(url, params);
    if (rows !== null)
      captures.push(
        ...rows.map(([timestamp]): [string, string] => [timestamp, url]),
      );
  }
  return captures.sort(byKey).at(-1) ?? null;
}

/** The tool's page from each source that serves it, in order, as [where
 * from, its HTML]; the Wayback Machine, for its newest capture since the
 * given day, is asked only when the caller asks for more than the live
 * sources gave. */
async function* fetchPages(
  since: string | undefined,
): AsyncGenerator<[string, string]> {
  for (const url of LIVE_URLS) {
    const html = await fetchPage(url);
    if (html !== null) yield [url, html];
  }
  console.log("Trying the Wayback Machine");
  const capture = await newestCapture(since);
  if (capture === null) {
    console.log(
      `The Wayback Machine has no capture of the page${since ? ` since ${since}` : ""}`,
    );
    return;
  }
  const [timestamp, url] = capture;
  const response = await waybackGet(waybackUrl(timestamp, url));
  if (response !== null)
    yield [`Wayback capture ${timestamp} of ${url}`, response.text];
}

// --- main ---------------------------------------------------------------------

/** What --fetch found: the newest page that is fit to add, or null, and what
 * was wrong with the pages that are not */
interface Fetched {
  page: Page | null;
  // pages that were served but do not parse, with what each is
  unparseable: string[];
  // pages that list too few posts
  incomplete: string[];
}

const newestSnapshot = (data: Data) =>
  Object.keys(data.snapshots).sort().at(-1);

/** Go through fetchPages() until a page parses, lists enough posts, and is
 * neither older than the newest snapshot nor more than LIVE_MAX_AGE_DAYS
 * old; of the pages that parse and list enough posts, the newest wins. */
async function fetchNewest(data: Data, today: string): Promise<Fetched> {
  const newest = newestSnapshot(data);
  const newestPosts =
    newest !== undefined ? Object.keys(data.snapshots[newest]).length : 0;
  let best: Page | null = null;
  const unparseable: string[] = [];
  const incomplete: string[] = [];
  for await (const [source, html] of fetchPages(newest)) {
    let asOf: string;
    let posts: Posts;
    try {
      [asOf, posts] = parsePage(html);
    } catch (error) {
      if (!(error instanceof ParseError)) throw error;
      console.log(`${source} does not parse: ${error.message}`);
      unparseable.push(
        `${source}, a page titled ${repr(pageTitle(html))}: ${error.message}`,
      );
      continue;
    }
    console.log(`${source}: ${posts.size} posts, last updated ${asOf}`);
    if (posts.size < MIN_POST_SHARE * newestPosts) {
      const problem = `${source} lists only ${posts.size} posts, against ${newestPosts} in the newest snapshot (${newest})`;
      console.log(`::warning::${problem}; a partial page? Not using it`);
      incomplete.push(problem);
      continue;
    }
    if (best === null || asOf > best.asOf) best = { source, asOf, posts };
    const age = Math.round((Date.parse(today) - Date.parse(asOf)) / 86_400_000);
    if (newest !== undefined && asOf < newest) {
      console.log(
        `${source} is older than the newest snapshot, ${newest}; it may be a stale copy`,
      );
    } else if (age > LIVE_MAX_AGE_DAYS) {
      console.log(`${source} is ${age} days old; it may be a stale copy`);
    } else {
      break;
    }
  }
  return { page: best, unparseable, incomplete };
}

async function run(options: {
  fetch: boolean;
  fromFile?: string;
  data: string;
}): Promise<number> {
  const data = await loadData(options.data);
  let source: string;
  let asOf: string;
  let posts: Posts;
  if (options.fetch) {
    const fetched = await fetchNewest(
      data,
      new Date().toISOString().slice(0, 10),
    );
    if (fetched.page === null) {
      if (fetched.unparseable.length > 0 || fetched.incomplete.length > 0) {
        console.error("ERROR: no source served a page that can be added.");
        for (const problem of fetched.unparseable)
          console.error(`  Does not parse: ${problem}`);
        for (const problem of fetched.incomplete)
          console.error(`  Too few posts: ${problem}`);
        if (fetched.unparseable.length > 0) {
          console.error(
            "A page that is State's tool but no longer parses means State changed it: update " +
              "parsePage in data/consulates/iv_schedule.ts. A page that is something else, such as an " +
              "error page, needs no change here.",
          );
        }
        if (fetched.incomplete.length > 0) {
          console.error(
            "Check the tool in a browser. If State really lists fewer posts now, save the page and " +
              "add it with --from-file.",
          );
        }
        return 1;
      }
      console.log(
        "::warning::No new IV Scheduling Status Tool data: no source served the page",
      );
      return 0;
    }
    ({ source, asOf, posts } = fetched.page);
  } else {
    source = options.fromFile!;
    let html: string;
    try {
      html = await Bun.file(source).text();
    } catch (error) {
      throw new InputError(`cannot read ${source}: ${errorMessage(error)}`);
    }
    try {
      [asOf, posts] = parsePage(html);
    } catch (error) {
      if (!(error instanceof ParseError)) throw error;
      console.error(
        `ERROR: ${source} does not parse: ${error.message}. If it is State's tool, saved in full, State has ` +
          "changed the page: update parsePage in data/consulates/iv_schedule.ts.",
      );
      return 1;
    }
    console.log(`${source}: ${posts.size} posts, last updated ${asOf}`);
  }

  const [slugs, unmatched] = matchSlugs(
    [...posts.keys()],
    await loadPostSlugs(),
  );
  if (unmatched.length > 0) {
    console.error(
      `ERROR: no site post slug for ${unmatched.join(", ")}; map each to one in ALIASES in iv_schedule.ts`,
    );
    return 1;
  }
  if (new Set(slugs.values()).size !== slugs.size) {
    console.error("ERROR: two of State's posts map to the same site post slug");
    return 1;
  }

  const newest = newestSnapshot(data);
  if (options.fetch && newest !== undefined && asOf < newest) {
    console.log(
      `::warning::No new IV Scheduling Status Tool data: ${source} is older than the newest snapshot, ${newest}`,
    );
    return 0;
  }
  if (asOf in data.snapshots) {
    console.log(
      `${options.data} already has the snapshot of ${asOf}; leaving it as it is`,
    );
    return 0;
  }
  data.snapshots[asOf] = Object.fromEntries(
    [...posts].map(([name, [employment, preference, relative]]) => [
      slugs.get(name)!,
      { name, relative, preference, employment },
    ]),
  );
  await saveData(data, options.data);
  console.log(`Added the snapshot of ${asOf} to ${options.data}`);
  // Only after a run that added a snapshot; see the comment at the top.
  if (options.fetch && LIVE_URLS.includes(source)) {
    for (const url of LIVE_URLS) await savePageNow(url);
  }
  return 0;
}

async function main(): Promise<number> {
  const { values } = parseArgs({
    options: {
      fetch: { type: "boolean" },
      "from-file": { type: "string" },
      data: { type: "string" },
    },
  });
  if (Boolean(values.fetch) === (values["from-file"] !== undefined)) {
    console.error("Give one of --fetch or --from-file page.html");
    return 2;
  }
  try {
    return await run({
      fetch: Boolean(values.fetch),
      fromFile: values["from-file"],
      data: values.data ?? DATA_PATH,
    });
  } catch (error) {
    if (!(error instanceof InputError)) throw error;
    console.error(`ERROR: ${error.message}`);
    return 1;
  }
}

if (import.meta.main) process.exit(await main());
