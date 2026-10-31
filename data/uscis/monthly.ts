// Add USCIS's monthly "Application Processing Data" reports to monthly.json.
//
// Every month since November 2022, USCIS publishes for Congress (as the
// Consolidated Appropriations Act, 2022 asked it to) a short CSV with, for
// six forms, the applications received, approved and denied in the month,
// those pending at its end and pending for more than six months, and the
// average processing time of the cases decided in the month: the I-130, the
// I-360, the I-485 by category (family, employment, asylum, refugee, Cuban
// and other), the I-751, the I-765 and the N-400. The quarterly reports
// forms.ts reads cover every form, but come out about two months after their
// quarter ends; this one comes out about four weeks after its month.
//
//     bun data/uscis/monthly.ts                                   # --fetch
//     bun data/uscis/monthly.ts --from-file report.csv --url URL  # a saved report
//
// --fetch reads the list of reports on USCIS's Immigration and Citizenship
// Data page and adds the months monthly.json does not have yet. The list and
// each report come from, in order:
//
// 1. www.uscis.gov. It sits behind Akamai, which often answers HTTP 403 to
//    scripts (see forms.ts), although it served these reports to GitHub's
//    runners in September 2026.
// 2. The Wayback Machine: for a report, its capture nearest to the month
//    after the report's, when USCIS publishes it; for the list, and for a
//    report it has not captured, Save Page Now.
//
// The month is the one the report itself names ("For the Month of August
// 2026"), which must be the one the list names it by, and a month already in
// monthly.json is never fetched or overwritten again: USCIS publishes each
// month's report once. A column, a row or a cell the script does not know
// fails the report rather than being skipped, so that a change in USCIS's
// layout is noticed: add it to the tables at the top of the script.
//
// --from-file parses a report saved from a browser instead, published at
// URL, and adds its month when monthly.json does not have it yet.
//
// Exit codes: 0 when months were added, when there was nothing new, or when
// no source could be reached (a `::warning::` annotation is printed then; the
// freshness workflow opens an issue once the newest month gets too old, see
// data/freshness.ts); 1 when a report was served but does not parse, in
// which case the months that did parse are still written, or when a file
// cannot be read.
import { join } from "node:path";
import { parseArgs } from "node:util";
import { decodeText, parseCsv } from "../lib/csv";
import { attr, findAll, normalizedText, parseHtml, text } from "../lib/html";
import {
  errorMessage,
  get,
  savePageNow,
  sleep,
  waybackGet,
  waybackUrl,
} from "../lib/http";
import { writeJson } from "../lib/json";

const DATA_PATH = join(import.meta.dir, "monthly.json");
const USCIS = "https://www.uscis.gov";
// Searching for "Appropriations" lists every report, the newest first, on one page
const LISTING_URL = `${USCIS}/tools/reports-and-studies/immigration-and-citizenship-data?query=Appropriations&items_per_page=100`;
// Between two reports, so that filling in years of them does not hammer USCIS
const FETCH_DELAY_MS = 1000;
// Asking the Wayback Machine to capture a whole backfill would take long; a
// monthly run adds one report, sometimes two
const MAX_SAVES = 2;
// The same browser user agent as forms.ts: Akamai lets it through more often
export const USCIS_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
    "(KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
  "Accept-Language": "en-US,en;q=0.9",
};

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
const MONTH = String.raw`(?<month>[A-Za-z]+),?\s+(?<year>\d{4})`;
// The list's link to a report: "FY22 Appropriations Reporting Requirement -
// Application Processing Data for August, 2026 (CSV, 3.54 KB)"
const LINK_TEXT = new RegExp(`Application Processing Data for ${MONTH}`, "i");
// The report's own line naming its month
const REPORT_MONTH = new RegExp(`^For the Month of ${MONTH}$`, "i");

// The columns, by their header (compared ignoring case and spacing), as the
// fields of monthly.json
const COLUMNS: Record<string, keyof Row | "form"> = {
  "form number": "form",
  description: "title",
  "forms received": "received",
  approvals: "approved",
  denials: "denied",
  pending: "pending",
  "pending over 6 months": "pendingOver6Months",
  "pending over six months": "pendingOver6Months",
  "avg. processing time": "averageMonths",
};
const COUNT_FIELDS = [
  "received",
  "approved",
  "denied",
  "pending",
  "pendingOver6Months",
] as const;
// The forms the report covers. A form's only row is category "all"; the
// I-485's rows are its categories, by the parenthetical of their title, with
// the keys forms.ts gives the same categories of the all-forms report.
const FORMS = ["I-130", "I-360", "I-485", "I-751", "I-765", "N-400"];
const CATEGORIES: Record<string, Record<string, string>> = {
  "I-485": {
    family: "family",
    employment: "employment",
    asylum: "asylum",
    refugee: "refugee",
    cuban: "cuban",
    "indo-chinese": "indo-chinese",
    other: "other",
  },
};
// The notes under the table that every report has, numbered 1 to this: what
// the columns mean, and where the data comes from. A note after them is about
// that month in particular (March to June 2025: USCIS turned approved parole
// work permits back into pending ones, then approved them again), and is
// kept.
const STANDARD_NOTES = 11;
const NOTE = /^(?<number>\d+)\)\s*(?<text>[\s\S]+)$/;

interface Row {
  title: string;
  received: number;
  approved: number;
  denied: number;
  pending: number;
  pendingOver6Months: number;
  // USCIS's average processing time, in months, of the cases decided in the month
  averageMonths: number;
}

interface Report {
  url: string;
  // per form, per category ("all" for a form's only row)
  forms: Record<string, Record<string, Row>>;
  // USCIS's notes about this month in particular (STANDARD_NOTES)
  notes?: string[];
}

interface Data {
  source: string;
  months: Record<string, Report>;
}

/** A file that does not look like a monthly report we know how to read */
class ParseError extends Error {}

const repr = (value: unknown) => JSON.stringify(value);
const newestMonth = (data: Data) =>
  Object.keys(data.months).sort().at(-1) ?? "none";

// --- parsing ------------------------------------------------------------------

/** ("August", "2026") as "2026-08" */
function monthKey(monthName: string, year: string): string {
  const index = MONTH_NAMES.indexOf(monthName.toLowerCase());
  if (index === -1) throw new ParseError(`unknown month ${repr(monthName)}`);
  return `${year}-${String(index + 1).padStart(2, "0")}`;
}

const normalize = (value: string) =>
  value.toLowerCase().split(/\s+/).filter(Boolean).join(" ");

function parseCount(value: string): number {
  if (!/^(?:\d{1,3}(?:,\d{3})*|\d+)$/.test(value)) {
    throw new ParseError(`cannot read the count ${repr(value)}`);
  }
  return Number(value.replaceAll(",", ""));
}

function parseMonths(value: string): number {
  if (!/^\d+(?:\.\d+)?$/.test(value)) {
    throw new ParseError(`cannot read the processing time ${repr(value)}`);
  }
  return Number(value);
}

/** The row's category: "all" for a form's only row, or for the I-485 the key
 * of its title's parenthetical */
function categoryKey(form: string, title: string): string {
  const categories = CATEGORIES[form];
  if (categories === undefined) return "all";
  const parenthetical = /\(([^()]+)\)\s*$/.exec(title);
  const key =
    parenthetical === null
      ? undefined
      : categories[normalize(parenthetical[1])];
  if (key === undefined)
    throw new ParseError(`unknown ${form} category in ${repr(title)}`);
  return key;
}

/** The report's month ("2026-08"), its rows per form and category, and its
 * notes about the month in particular (STANDARD_NOTES). */
export function parseReport(
  content: Uint8Array,
): [string, Record<string, Record<string, Row>>, string[]] {
  const rows = parseCsv(decodeText(content)).map((row) =>
    row.map((cell) => cell.trim()),
  );
  let month: string | null = null;
  let headerIndex: number | null = null;
  for (const [index, row] of rows.entries()) {
    const first = row[0] ?? "";
    const match = REPORT_MONTH.exec(first);
    if (match !== null)
      month = monthKey(match.groups!.month, match.groups!.year);
    if (normalize(first) === "form number") {
      headerIndex = index;
      break;
    }
  }
  if (month === null) throw new ParseError("no line names the report's month");
  if (headerIndex === null)
    throw new ParseError("no header row starting with 'Form Number'");

  const fields = rows[headerIndex].map((heading) => {
    if (heading === "") return null;
    const field = Object.hasOwn(COLUMNS, normalize(heading))
      ? COLUMNS[normalize(heading)]
      : undefined;
    if (field === undefined)
      throw new ParseError(`unknown column ${repr(heading)}`);
    return field;
  });
  const missing = [...new Set(Object.values(COLUMNS))].filter(
    (field) => !fields.includes(field),
  );
  if (missing.length > 0)
    throw new ParseError(`no column for ${missing.sort().join(", ")}`);

  const forms: Record<string, Record<string, Row>> = {};
  let end = rows.length;
  for (let index = headerIndex + 1; index < rows.length; index++) {
    const row = rows[index];
    // the notes under the table
    if (
      row.length === 0 ||
      row[0] === "" ||
      normalize(row[0]).startsWith("notes")
    ) {
      end = index;
      break;
    }
    const cells: Record<string, string> = {};
    fields.forEach((field, i) => {
      if (field !== null && i < row.length) cells[field] = row[i];
    });
    if (row.slice(fields.length).some((cell) => cell !== "")) {
      throw new ParseError(
        `the row ${repr(row)} has more cells than the header`,
      );
    }
    const form = cells.form ?? "";
    if (!FORMS.includes(form))
      throw new ParseError(
        `unknown form ${repr(form)} in the row ${repr(row)}`,
      );
    const title = cells.title ?? "";
    const key = categoryKey(form, title);
    if (forms[form] !== undefined && key in forms[form]) {
      throw new ParseError(`${form} ${key} appears twice`);
    }
    const counts = Object.fromEntries(
      COUNT_FIELDS.map((field) => [field, parseCount(cells[field] ?? "")]),
    ) as Record<(typeof COUNT_FIELDS)[number], number>;
    forms[form] ??= {};
    forms[form][key] = {
      title,
      received: counts.received,
      approved: counts.approved,
      denied: counts.denied,
      pending: counts.pending,
      pendingOver6Months: counts.pendingOver6Months,
      averageMonths: parseMonths(cells.averageMonths ?? ""),
    };
  }
  const missingForms = FORMS.filter((form) => !(form in forms));
  if (missingForms.length > 0)
    throw new ParseError(`no row for ${missingForms.join(", ")}`);
  const notes = rows.slice(end).flatMap((row) => {
    const match = row.length > 0 ? NOTE.exec(row[0]) : null;
    return match !== null && Number(match.groups!.number) > STANDARD_NOTES
      ? [match.groups!.text.split(/\s+/).filter(Boolean).join(" ")]
      : [];
  });
  return [month, forms, notes];
}

// --- monthly.json -------------------------------------------------------------

async function loadData(): Promise<Data> {
  const file = Bun.file(DATA_PATH);
  if (!(await file.exists())) return { source: LISTING_URL, months: {} };
  return (await file.json()) as Data;
}

/** Months in order. */
async function saveData(data: Data): Promise<void> {
  data.months = Object.fromEntries(
    Object.entries(data.months).sort(([a], [b]) => (a < b ? -1 : 1)),
  );
  await writeJson(DATA_PATH, data);
}

/** Parse a report and add its month; the month. */
function addReport(
  data: Data,
  url: string,
  content: Uint8Array,
  expectedMonth?: string,
): string {
  const [month, forms, notes] = parseReport(content);
  if (expectedMonth !== undefined && month !== expectedMonth) {
    throw new ParseError(
      `the report listed for ${expectedMonth} is for ${month}`,
    );
  }
  data.months[month] = { url, forms };
  if (notes.length > 0) data.months[month].notes = notes;
  const rowCount = Object.values(forms).reduce(
    (sum, categories) => sum + Object.keys(categories).length,
    0,
  );
  console.log(`+ ${month}: ${rowCount} rows (${url})`);
  return month;
}

// --- fetching (--fetch) -------------------------------------------------------

/** Whether a response is a report rather than an error or block page */
function looksLikeReport(content: Uint8Array): boolean {
  const start = new TextDecoder().decode(content.slice(0, 4000)).toLowerCase();
  return !start.includes("<html") && start.includes("form number");
}

/** The body on HTTP 200 from www.uscis.gov, null otherwise */
export async function fetchUscis(url: string): Promise<Uint8Array | null> {
  let response: Response;
  let body: Uint8Array;
  try {
    response = await get(url, { headers: USCIS_HEADERS });
    body = new Uint8Array(await response.arrayBuffer());
  } catch (error) {
    console.log(`${url}: request failed: ${errorMessage(error)}`);
    return null;
  }
  if (response.status !== 200) {
    console.log(`${url}: HTTP ${response.status}`);
    return null;
  }
  return body;
}

/** href resolved against base, as Python's urljoin() does it for the links
 * on USCIS's pages: an absolute URL or path is taken as it is, with no
 * re-encoding. */
export function urljoin(base: string, href: string): string {
  if (/^[a-z][a-z0-9+.-]*:/i.test(href)) return href;
  const origin = new URL(base).origin;
  if (href.startsWith("//")) return `${new URL(base).protocol}${href}`;
  if (href.startsWith("/")) return `${origin}${href}`;
  return new URL(href, base).href;
}

/** The reports a listing page links to, as month -> URL */
export function listedReports(html: string): Map<string, string> {
  const listed = new Map<string, string>();
  for (const link of findAll(
    parseHtml(html),
    (element) => element.tagName === "a" && attr(element, "href") !== undefined,
  )) {
    const match = LINK_TEXT.exec(normalizedText(link));
    if (match === null) continue;
    let month: string;
    try {
      month = monthKey(match.groups!.month, match.groups!.year);
    } catch (error) {
      if (!(error instanceof ParseError)) throw error;
      console.log(
        `::warning::a report is listed for an unknown month: ${repr(text(link))}`,
      );
      continue;
    }
    if (!listed.has(month))
      listed.set(month, urljoin(USCIS, attr(link, "href")!));
  }
  return listed;
}

/** The reports USCIS's list links to, as month -> URL, or null when no
 * source serves the list. */
async function fetchListing(): Promise<Map<string, string> | null> {
  const content = await fetchUscis(LISTING_URL);
  let html = content === null ? null : new TextDecoder().decode(content);
  if (html === null || listedReports(html).size === 0) {
    // blocked: have the archive fetch the list for us, so that a newly
    // published report is found the same day
    const timestamp = await savePageNow(LISTING_URL);
    const response =
      timestamp === null
        ? null
        : await waybackGet(waybackUrl(timestamp, LISTING_URL));
    html = response === null ? null : response.text;
  }
  const listed =
    html === null ? new Map<string, string>() : listedReports(html);
  if (listed.size === 0) return null;
  console.log(
    `USCIS lists ${listed.size} monthly reports, the newest for ${[...listed.keys()].sort().at(-1)}`,
  );
  return listed;
}

export function nextMonth(month: string): string {
  const year = Number(month.slice(0, 4));
  const number = Number(month.slice(5));
  return `${year + Math.floor(number / 12)}-${String((number % 12) + 1).padStart(2, "0")}`;
}

/** The report from uscis.gov or the Wayback Machine, or null when no source
 * serves it. */
async function fetchReport(
  url: string,
  month: string,
): Promise<Uint8Array | null> {
  const content = await fetchUscis(url);
  if (content !== null && looksLikeReport(content)) return content;
  // the archive redirects to its capture nearest to the start of the month
  // after the report's, around when USCIS publishes it
  const near = `${nextMonth(month).replace("-", "")}01`;
  let response = await waybackGet(waybackUrl(near, url));
  if (response !== null && looksLikeReport(response.body)) return response.body;
  const timestamp = await savePageNow(url);
  if (timestamp !== null) {
    response = await waybackGet(waybackUrl(timestamp, url));
    if (response !== null && looksLikeReport(response.body))
      return response.body;
  }
  return null;
}

async function fetchNew(data: Data): Promise<number> {
  const listed = await fetchListing();
  if (listed === null) {
    console.log("::warning::No source serves USCIS's list of monthly reports");
    return 0;
  }
  const wanted = [...listed.keys()]
    .filter((month) => !(month in data.months))
    .sort();
  console.log(
    `Newest month in monthly.json: ${newestMonth(data)}; fetching ${repr(wanted)}`,
  );

  const added: string[] = [];
  const problems: string[] = [];
  for (const month of wanted) {
    const url = listed.get(month)!;
    const content = await fetchReport(url, month);
    if (content === null) {
      console.log(
        `::warning::No source serves the report for ${month}: ${url}`,
      );
      continue;
    }
    try {
      addReport(data, url, content, month);
    } catch (error) {
      if (!(error instanceof ParseError)) throw error;
      problems.push(`${month} (${url}): ${error.message}`);
      continue;
    }
    added.push(month);
    await sleep(FETCH_DELAY_MS);
  }

  if (added.length > 0) {
    await saveData(data);
    console.log(`Wrote ${DATA_PATH}: added ${added.join(", ")}`);
    if (added.length <= MAX_SAVES) {
      for (const month of added) await savePageNow(data.months[month].url);
    }
  }
  if (problems.length > 0) {
    for (const problem of problems) {
      console.error(
        `::error::A monthly report was served but does not parse: ${problem}`,
      );
    }
    return 1;
  }
  if (added.length === 0) {
    console.log(
      `::notice::No new monthly report; the newest is ${newestMonth(data)}`,
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
      url: { type: "string" },
    },
  });
  const data = await loadData();
  const fromFile = values["from-file"];
  if (fromFile === undefined) return fetchNew(data);

  const url = values.url;
  if (url === undefined || !url.startsWith(`${USCIS}/`)) {
    console.error(`--from-file needs --url, the report's address on ${USCIS}`);
    return 2;
  }
  try {
    const content = new Uint8Array(await Bun.file(fromFile).arrayBuffer());
    const [month] = parseReport(content);
    if (month in data.months) {
      console.log(`monthly.json already has the report for ${month}`);
      return 0;
    }
    addReport(data, url, content);
  } catch (error) {
    console.error(`ERROR: ${fromFile}: ${errorMessage(error)}`);
    return 1;
  }
  await saveData(data);
  return 0;
}

if (import.meta.main) process.exit(await main());
