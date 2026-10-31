// Add the State Department's monthly Visa Bulletins to data.json.
//
// Each bulletin has two charts for the family-sponsored and the
// employment-based preference categories: Final Action Dates (who can be
// issued a visa or approved for a green card) and Dates for Filing (who can
// send in their application). Every chart gives, per category and per
// chargeability area, a cutoff date, or "C" (current: no cutoff) or "U"
// (unavailable: no visas at all). data.json keeps every bulletin since
// FIRST_MONTH, October 2015, the first with both charts.
//
//     bun data/visa_bulletin/bulletin.ts                                  # --fetch
//     bun data/visa_bulletin/bulletin.ts --from-file page.html --month 2026-10
//
// --fetch reads the list of bulletins on State's Visa Bulletin page, adds the
// ones since FIRST_MONTH that data.json does not have yet, and tries the next
// two months' addresses too, in case the list is behind. It fetches each page
// from these, in order:
//
// 1. travel.state.gov. It sits behind Cloudflare, which answers non-browser
//    clients with a 403 challenge page (a challenge page served with HTTP 200
//    counts as not served).
// 2. The same page on adoption.state.gov, which State serves without
//    Cloudflare in front of it. The host is not advertised and could go away.
// 3. The Wayback Machine's capture of the page on either host nearest to the
//    bulletin's month (for State's list of bulletins, nearest to today).
//
// A month that is already in data.json is never fetched or overwritten again:
// State publishes each bulletin once, about the middle of the month before,
// and the month is the key. After a run that added one or two bulletins,
// which is what a monthly run adds, it asks the Wayback Machine to capture
// their pages (best effort), so that the last fallback has something to
// fall back to.
//
// --from-file parses a page saved from a browser instead, for the month
// given, and adds it when data.json does not have that month yet.
//
// The charts are the tables whose header row names the chargeability areas
// ("All Chargeability Areas Except Those Listed", "CHINA-mainland born" and
// so on). A table's rows say whether it is a family (F1 to F4) or an
// employment (1st to 5th) chart; of each kind, the first is Final Action
// Dates and the second Dates for Filing, the order State has kept since
// October 2015. A row, a column or a cell that none of the patterns below
// knows fails the page rather than being skipped, so that a change in State's
// format is noticed.
//
// Exit codes: 0 when bulletins were added, when there was nothing new, or
// when no source could be reached (a `::warning::` annotation is printed
// then; the freshness workflow opens an issue once the newest bulletin gets
// too old, see data/freshness.ts); 1 when a page was served but does not
// parse, in which case the bulletins that did parse are still written, or
// when a file cannot be read.
import { join } from "node:path";
import { parseArgs } from "node:util";
import { findAll, normalizedText, parseHtml, type Element } from "../lib/html";
import {
  STATE_HOSTS,
  fetchPage,
  isChallenge,
  pageTitle,
  savePageNow,
  sleep,
  waybackGet,
  waybackUrl,
} from "../lib/http";
import { readJson, writeJson } from "../lib/json";

const DATA_PATH = join(import.meta.dir, "data.json");
const BULLETINS_PATH = "/content/travel/en/legal/visa-law0/visa-bulletin";
const INDEX_PATH = `${BULLETINS_PATH}.html`;
// Between two bulletin pages, so that filling in years of them does not
// hammer State's servers
const FETCH_DELAY_MS = 1000;
// The first bulletin with both charts, Final Action Dates and Dates for Filing
const FIRST_MONTH = "2015-10";
// Asking the Wayback Machine to capture a whole backfill would take hours;
// a monthly run adds one bulletin, sometimes two
const MAX_SAVES = 2;

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
const MONTH_ABBREVIATIONS = MONTH_NAMES.map((name) =>
  name.slice(0, 3).toUpperCase(),
);
// A bulletin's page, ".../visa-bulletin/2026/visa-bulletin-for-october-2025.html";
// a few old ones leave out the "for-". The folder is the fiscal year.
const BULLETIN_LINK_PATTERN = new RegExp(
  `${BULLETINS_PATH.replace(/[.*+?^${}()|[\]\\/-]/g, "\\$&")}/(?<folder>\\d{4})/visa-bulletin-(?:for-)?(?<month>[a-z]+)-(?<year>\\d{4})\\.html`,
  "g",
);
// "01JAN08"; the year has two digits
const DATE_PATTERN = /^(?<day>\d{1,2})(?<month>[A-Z]{3})(?<year>\d{2})$/;

// The chargeability areas, by a word of their column's heading
const AREAS: Record<string, RegExp> = {
  all: /all chargeability/,
  china: /china/,
  india: /india/,
  mexico: /mexico/,
  philippines: /philippines/,
  "el-salvador-guatemala-honduras": /el salvador/,
  vietnam: /vietnam/,
};
// The categories, by the start of their row's label, lowercased
const FAMILY_CATEGORIES: Record<string, RegExp> = {
  F1: /^f1$/,
  F2A: /^f2a$/,
  F2B: /^f2b$/,
  F3: /^f3$/,
  F4: /^f4$/,
};
const EMPLOYMENT_CATEGORIES: Record<string, RegExp> = {
  "EB-1": /^1st$/,
  "EB-2": /^2nd$/,
  "EB-3": /^3rd$/,
  // EB-3 for jobs that need less than two years of training or experience
  EW: /^other workers$/,
  "EB-4": /^4th$/,
  // EB-4 for religious workers other than ministers
  SR: /^certain religious workers$/,
  // the EB-5 rows since the EB-5 Reform and Integrity Act of 2022; in May
  // 2022 alone, the regional center investors (I5 and R5) had a row of their
  // own, "5th Unreserved (I5 and R5)"
  "EB-5-unreserved-regional-center": /^5th unreserved.*\bi5 and r5\b/,
  "EB-5-unreserved": /^5th unreserved/,
  "EB-5-rural": /^5th set aside.*rural/,
  "EB-5-high-unemployment": /^5th set aside.*high unemployment/,
  "EB-5-infrastructure": /^5th set aside.*infrastructure/,
  // and before it; until October 2015, the regional center row was
  // "5th Targeted Employment Areas/ Regional Centers and Pilot Programs"
  "EB-5-non-regional-center": /^5th non-regional center/,
  "EB-5-regional-center": /^5th (regional center|targeted employment areas)/,
};

// One chart: category -> area -> "2020-01-22", "C" or "U"
type Chart = Record<string, Record<string, string>>;
type Kind = "family" | "employment";

interface Bulletin {
  url: string;
  finalAction: Chart;
  datesForFiling: Chart;
}

interface Data {
  source: string;
  bulletins: Record<string, Bulletin>;
}

/** A page that does not look like a Visa Bulletin we know how to read */
class ParseError extends Error {}

const repr = (value: unknown) => JSON.stringify(value);

// --- parsing ------------------------------------------------------------------

/** A cell: "C", "U", or a date as "2008-01-01". */
export function parseValue(text: string, bulletinYear: number): string {
  const value = text.toUpperCase().replaceAll(" ", "").replace(/\*+$/, "");
  if (value === "C" || value === "U") return value;
  const match = DATE_PATTERN.exec(value);
  const monthIndex = match
    ? MONTH_ABBREVIATIONS.indexOf(match.groups!.month)
    : -1;
  if (match === null || monthIndex === -1) {
    throw new ParseError(`cannot read the cell ${repr(text)}`);
  }
  let year = 2000 + Number(match.groups!.year);
  // two-digit years: the cutoff dates of 2015 go back to the early 1990s
  if (year > bulletinYear + 1) year -= 100;
  const day = Number(match.groups!.day);
  const date = new Date(Date.UTC(year, monthIndex, day));
  if (day < 1 || date.getUTCMonth() !== monthIndex) {
    throw new ParseError(
      `cannot read the cell ${repr(text)}: day is out of range for month`,
    );
  }
  return date.toISOString().slice(0, 10);
}

function matchLabel(
  label: string,
  patterns: Record<string, RegExp>,
): string | null {
  const normalized = label
    .toLowerCase()
    .replace(/[^a-z0-9%,.:()\- ]/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .join(" ")
    .replace(/^[ *.]+|[ *.]+$/g, "");
  for (const [key, pattern] of Object.entries(patterns)) {
    if (pattern.test(normalized)) return key;
  }
  return null;
}

/** A row's ("family" or "employment", its category), or null */
function rowCategory(label: string): [Kind, string] | null {
  const family = matchLabel(label, FAMILY_CATEGORIES);
  if (family !== null) return ["family", family];
  const employment = matchLabel(label, EMPLOYMENT_CATEGORIES);
  if (employment !== null) return ["employment", employment];
  return null;
}

/** A chart as ("family" or "employment", the chart), or null when the table
 * is not one: when no header row names chargeability areas, or no row is a
 * preference category (the diversity visa table names chargeability areas
 * too). */
function parseTable(
  table: Element,
  bulletinYear: number,
): [Kind, Chart] | null {
  const rows = findAll(table, "tr")
    .map((row) => findAll(row, ["td", "th"]).map(normalizedText))
    .filter((row) => row.some(Boolean));
  const headerIndex = rows.findIndex((row) =>
    row.some((cell) => cell.toLowerCase().includes("chargeability")),
  );
  if (headerIndex === -1) return null;
  const header = rows[headerIndex];
  const body = rows.slice(headerIndex + 1);
  const categories = body.map((row) => rowCategory(row[0]));
  const kinds = new Set(
    categories.filter((category) => category !== null).map(([kind]) => kind),
  );
  if (kinds.size === 0) return null;
  if (kinds.size > 1) {
    throw new ParseError(
      `a table headed ${repr(header)} mixes family and employment categories`,
    );
  }

  const areas = header.slice(1).map((heading) => {
    const area = Object.entries(AREAS).find(([, pattern]) =>
      pattern.test(heading.toLowerCase()),
    )?.[0];
    if (area === undefined) {
      throw new ParseError(
        `unknown chargeability area ${repr(heading)} in a table headed ${repr(header)}`,
      );
    }
    return area;
  });

  const chart: Chart = {};
  body.forEach((row, index) => {
    const category = categories[index];
    if (category === null) {
      throw new ParseError(
        `unknown category ${repr(row[0])} in a table headed ${repr(header)}`,
      );
    }
    const cells = row.slice(1);
    if (cells.length !== areas.length) {
      throw new ParseError(
        `the row ${repr(row)} has ${cells.length} cells for ${areas.length} areas`,
      );
    }
    if (category[1] in chart) {
      throw new ParseError(
        `the category ${repr(row[0])} appears twice in a table`,
      );
    }
    chart[category[1]] = Object.fromEntries(
      areas.map((area, i) => [area, parseValue(cells[i], bulletinYear)]),
    );
  });
  return [[...kinds][0], chart];
}

/** The bulletin's [Final Action Dates, Dates for Filing], both charts with
 * the family and the employment categories. */
export function parsePage(html: string, month: string): [Chart, Chart] {
  const charts: Record<Kind, Chart[]> = { family: [], employment: [] };
  for (const table of findAll(parseHtml(html), "table")) {
    // a table laid out around others is not a chart; the ones inside are
    if (findAll(table, "table").length > 0) continue;
    const parsed = parseTable(table, Number(month.slice(0, 4)));
    if (parsed !== null) charts[parsed[0]].push(parsed[1]);
  }
  for (const [kind, found] of Object.entries(charts)) {
    if (found.length !== 2) {
      throw new ParseError(
        `found ${found.length} ${kind} charts, not 2 (Final Action Dates and Dates for Filing)`,
      );
    }
  }
  return [
    { ...charts.family[0], ...charts.employment[0] },
    { ...charts.family[1], ...charts.employment[1] },
  ];
}

// --- data.json ----------------------------------------------------------------

/** Months in order. */
async function saveData(data: Data): Promise<void> {
  data.bulletins = Object.fromEntries(
    Object.entries(data.bulletins).sort(([a], [b]) => (a < b ? -1 : 1)),
  );
  await writeJson(DATA_PATH, data);
}

function addBulletin(
  data: Data,
  month: string,
  url: string,
  html: string,
): void {
  const [finalAction, datesForFiling] = parsePage(html, month);
  data.bulletins[month] = { url, finalAction, datesForFiling };
  console.log(
    `+ ${month}: ${Object.keys(finalAction).length} categories (${url})`,
  );
}

const newestMonth = (data: Data) =>
  Object.keys(data.bulletins).sort().at(-1) ?? "none";

// --- fetching (--fetch) -------------------------------------------------------

/** The page at path from each source that serves it, in order, as [where
 * from, its HTML]; the Wayback Machine, for its capture of the page on
 * either host nearest to the day near ("20161215"), is asked only when the
 * caller asks for more than the live hosts gave. The archive finds the
 * nearest capture itself, so that this does not depend on its search API,
 * which is often down. */
async function* fetchPages(
  path: string,
  near: string,
): AsyncGenerator<[string, string]> {
  for (const host of STATE_HOSTS) {
    const html = await fetchPage(`${host}${path}`);
    if (html !== null) yield [`${host}${path}`, html];
  }
  for (const host of STATE_HOSTS) {
    const response = await waybackGet(waybackUrl(near, `${host}${path}`));
    if (response !== null && !isChallenge(response.text)) {
      yield [`Wayback capture ${response.url}`, response.text];
    }
  }
}

/** The page of a month's bulletin, as State names them: the folder is the
 * fiscal year, which starts in October. */
export function bulletinPath(month: string): string {
  const year = Number(month.slice(0, 4));
  const monthNumber = Number(month.slice(5));
  const fiscalYear = monthNumber >= 10 ? year + 1 : year;
  return `${BULLETINS_PATH}/${fiscalYear}/visa-bulletin-for-${MONTH_NAMES[monthNumber - 1]}-${year}.html`;
}

/** The bulletins State's Visa Bulletin page links to, as month -> path, or
 * null when no source serves the page. */
async function listedBulletins(
  today: string,
): Promise<Map<string, string> | null> {
  for await (const [source, html] of fetchPages(
    INDEX_PATH,
    today.replaceAll("-", ""),
  )) {
    const listed = new Map<string, string>();
    for (const match of html.matchAll(BULLETIN_LINK_PATTERN)) {
      const monthIndex = MONTH_NAMES.indexOf(match.groups!.month);
      if (monthIndex === -1) continue;
      const month = `${match.groups!.year}-${String(monthIndex + 1).padStart(2, "0")}`;
      if (!listed.has(month)) listed.set(month, match[0]);
    }
    if (listed.size > 0) {
      const newest = [...listed.keys()].sort().at(-1);
      console.log(
        `${source} lists ${listed.size} bulletins, the newest for ${newest}`,
      );
      return listed;
    }
    console.log(`${source} lists no bulletins (${repr(pageTitle(html))})`);
  }
  return null;
}

/** The month some months after another: ("2026-10", -1) is "2026-09" */
export function addMonths(month: string, months: number): string {
  const index =
    Number(month.slice(0, 4)) * 12 + Number(month.slice(5)) - 1 + months;
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, "0")}`;
}

async function fetchNew(data: Data, today: string): Promise<number> {
  const listed = (await listedBulletins(today)) ?? new Map<string, string>();
  // The list may be behind, or unreachable: try this month's and next
  // month's addresses as well. State publishes a bulletin around the middle
  // of the month before.
  const thisMonth = today.slice(0, 7);
  for (const month of [thisMonth, addMonths(thisMonth, 1)]) {
    if (!listed.has(month)) listed.set(month, bulletinPath(month));
  }
  const wanted = [...listed.keys()]
    .filter((month) => month >= FIRST_MONTH && !(month in data.bulletins))
    .sort();
  console.log(
    `Newest bulletin in data.json: ${newestMonth(data)}; fetching ${repr(wanted)}`,
  );

  const added: string[] = [];
  const unparseable: string[] = [];
  for (const month of wanted) {
    const errors: string[] = [];
    let parsed = false;
    // the middle of the month before, around when State publishes it
    const near = `${addMonths(month, -1).replace("-", "")}15`;
    for await (const [source, html] of fetchPages(listed.get(month)!, near)) {
      try {
        addBulletin(data, month, `${STATE_HOSTS[0]}${listed.get(month)}`, html);
      } catch (error) {
        if (!(error instanceof ParseError)) throw error;
        console.log(`${source} does not parse: ${error.message}`);
        errors.push(
          `${source}, a page titled ${repr(pageTitle(html))}: ${error.message}`,
        );
        continue;
      }
      added.push(month);
      parsed = true;
      break;
    }
    if (!parsed) {
      if (errors.length > 0) unparseable.push(`${month}: ${errors.join("; ")}`);
      else console.log(`No source serves the bulletin for ${month}`);
    }
    await sleep(FETCH_DELAY_MS);
  }

  if (added.length > 0) {
    await saveData(data);
    console.log(`Wrote ${DATA_PATH}: added ${added.join(", ")}`);
    if (added.length <= MAX_SAVES) {
      for (const month of added) await savePageNow(data.bulletins[month].url);
    }
  }
  if (unparseable.length > 0) {
    for (const problem of unparseable) {
      console.error(
        `::error::A Visa Bulletin page was served but does not parse: ${problem}`,
      );
    }
    return 1;
  }
  if (added.length === 0) {
    // this month's and next month's bulletins count as missing only once
    // the freshness check says so
    console.log(
      `::notice::No new bulletin; the newest is ${newestMonth(data)}`,
    );
  }
  return 0;
}

// --- main ---------------------------------------------------------------------

async function main(): Promise<number> {
  const { values } = parseArgs({
    options: {
      fetch: { type: "boolean" },
      "from-file": { type: "string" },
      month: { type: "string" },
    },
  });
  const data = await readJson<Data>(DATA_PATH);
  const fromFile = values["from-file"];
  if (fromFile === undefined) {
    return fetchNew(data, new Date().toISOString().slice(0, 10));
  }

  const month = values.month;
  if (month === undefined || !/^\d{4}-\d{2}$/.test(month)) {
    console.error("--from-file needs --month, as 2026-10");
    return 2;
  }
  if (month in data.bulletins) {
    console.log(`data.json already has the bulletin for ${month}`);
    return 0;
  }
  try {
    const html = await Bun.file(fromFile).text();
    addBulletin(data, month, `${STATE_HOSTS[0]}${bulletinPath(month)}`, html);
  } catch (error) {
    console.error(
      `ERROR: ${fromFile}: ${error instanceof Error ? error.message : error}`,
    );
    return 1;
  }
  await saveData(data);
  return 0;
}

if (import.meta.main) process.exit(await main());
