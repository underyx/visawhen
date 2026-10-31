// Read State's monthly visa issuance PDFs into the consulate pages' tables.
//
//     bun data/consulates/visa_issuances.ts            # list, download, read, write dump/
//     bun data/consulates/visa_issuances.ts --offline  # read the PDFs in pdfs/ alone
//
// State publishes, every month, two PDFs of the visas each post issued by
// class: one for immigrant visas (IV), one for nonimmigrant visas (NIV). This
// lists them on travel.state.gov, downloads the ones pdfs/ does not hold yet
// (gitignored, cached between workflow runs), reads every table row from
// them, merges the visa codes that stand for one category and writes the
// tables to dump/, the committed copy of the data, which
// scripts/load-consulates-db.ts (`bun run ensure-db`) loads into
// consulates.sqlite before every build:
//
// * post_slugs: each post's name by its slug.
// * visa_slugs: each visa class's name, IV or NIV, and description by its
//   slug.
// * backlogs: issuances per post, visa class and month, 0 for a month
//   without a row. The name is from when the table also held a pre-COVID
//   backlog estimate; the site and data/freshness.py read it as "backlogs".
//
// The listing pages and the PDFs come from, in order:
//
// 1. travel.state.gov. It sits behind Cloudflare, which answers HTTP 403 to
//    scripts.
// 2. The same page on adoption.state.gov, which State serves without
//    Cloudflare in front of it. It is not advertised and could go away, so
//    it is only the second choice.
// 3. The Wayback Machine: its newest capture of the listing page, and its
//    captures of the PDFs.
//
// When no source lists the PDFs, this changes nothing and exits 0, so the
// workflow has nothing to commit instead of failing or writing a partial
// dataset. A PDF that is listed but cannot be downloaded fails the run.
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { getDocumentProxy } from "unpdf";
import { decodeText, parseCsv } from "../lib/csv";
import { attr, find, findAll, hasClass, parseHtml, text } from "../lib/html";
import { errorMessage, get, sleep, withParams } from "../lib/http";

const HERE = import.meta.dir;
const PDFS_DIR = join(HERE, "pdfs");
const DUMP_DIR = process.env.CONSULATES_DUMP_DIR ?? join(HERE, "dump");

const TRAVEL_STATE_GOV = "https://travel.state.gov";
const STATE_MIRROR = "https://adoption.state.gov";
const WAYBACK = "https://web.archive.org";
const CDX_TIMEOUT_MS = 30_000;
const WAYBACK_ATTEMPTS = 5;
// Downloads at a time from the Wayback Machine, which throttles more
const WAYBACK_DOWNLOADS = 4;
const DIRECT_DOWNLOADS = 8;

const IV_LISTING_PATH =
  "/content/travel/en/legal/visa-law0/visa-statistics/immigrant-visa-statistics/monthly-immigrant-visa-issuances.html";
const NIV_LISTING_PATH =
  "/content/travel/en/legal/visa-law0/visa-statistics/nonimmigrant-visa-statistics/monthly-nonimmigrant-visa-issuances.html";

// --- fetching -----------------------------------------------------------------

/** GET a web.archive.org URL, retrying on the archive's frequent 429/5xx
 * hiccups and timeouts; throws when every attempt failed. */
async function fetchWayback(
  url: string,
  options: { params?: Record<string, string>; timeoutMs?: number } = {},
): Promise<Uint8Array> {
  const fullUrl = withParams(url, options.params);
  for (let attempt = 0; attempt < WAYBACK_ATTEMPTS; attempt++) {
    let reason: string;
    try {
      const response = await get(fullUrl, { timeoutMs: options.timeoutMs });
      const body = new Uint8Array(await response.arrayBuffer());
      if (response.status === 200) return body;
      reason = `HTTP ${response.status}`;
    } catch (error) {
      reason = errorMessage(error);
    }
    console.log(
      `wayback attempt ${attempt + 1}/${WAYBACK_ATTEMPTS} failed (${reason}): ${fullUrl}`,
    );
    if (attempt < WAYBACK_ATTEMPTS - 1) await sleep(5000 * 2 ** attempt);
  }
  throw new Error(
    `Wayback Machine did not serve ${fullUrl} after ${WAYBACK_ATTEMPTS} attempts`,
  );
}

/** Scheme-less, unquoted, lowercased URL, for matching listing links to CDX
 * rows. */
export function normalizeUrl(url: string): string {
  const withoutScheme = url.includes("://")
    ? url.slice(url.indexOf("://") + 3)
    : url;
  let unquoted: string;
  try {
    unquoted = decodeURIComponent(withoutScheme);
  } catch {
    unquoted = withoutScheme;
  }
  return unquoted.toLowerCase();
}

type Captures = Map<string, [timestamp: string, original: string]>;

/** The newest HTTP 200 capture of every URL matching the pattern (a `*`
 * wildcard may end it), by normalizeUrl(). */
async function waybackCaptures(
  urlPattern: string,
  extra: Record<string, string> = {},
): Promise<Captures> {
  const body = await fetchWayback(`${WAYBACK}/cdx/search/cdx`, {
    params: {
      url: urlPattern.replace(/^[a-z]+:\/\//i, ""),
      output: "json",
      fl: "timestamp,original",
      filter: "statuscode:200",
      ...extra,
    },
    timeoutMs: CDX_TIMEOUT_MS,
  });
  const answer = new TextDecoder().decode(body);
  const captures: Captures = new Map();
  const rows = answer.trim() ? (JSON.parse(answer) as string[][]).slice(1) : [];
  for (const [timestamp, original] of rows) {
    const key = normalizeUrl(original);
    const known = captures.get(key);
    if (known === undefined || timestamp > known[0])
      captures.set(key, [timestamp, original]);
  }
  return captures;
}

const captureUrl = (timestamp: string, original: string) =>
  `${WAYBACK}/web/${timestamp}id_/${original}`;

/** href resolved against base, as Python's urljoin() does it for these
 * links: an absolute URL or path is taken as it is. */
function urljoin(base: string, href: string): string {
  if (/^[a-z][a-z0-9+.-]*:/i.test(href)) return href;
  if (href.startsWith("//")) return `${new URL(base).protocol}${href}`;
  if (href.startsWith("/")) return `${new URL(base).origin}${href}`;
  return new URL(href, base).href;
}

interface PdfLink {
  // whitespace-normalized link text, e.g. "March 2019 - IV Issuances by Post and Visa Class"
  text: string;
  url: string;
}

/** The PDF links in the listing page's content body, resolved against url. */
export function pdfLinks(url: string, html: string): PdfLink[] {
  const content = find(parseHtml(html), (element) =>
    hasClass(element, "contentbody"),
  );
  if (content === undefined) return [];
  return findAll(
    content,
    (element) =>
      element.tagName === "a" && (attr(element, "href") ?? "").endsWith(".pdf"),
  ).map((link) => ({
    text: text(link).split(/\s+/).filter(Boolean).join(" "),
    url: urljoin(url, attr(link, "href")!),
  }));
}

/** [PDF links, the live HTTP status, the Wayback timestamp the links came
 * from or null]. The links point to the host whose page they came from. */
async function listPdfs(
  path: string,
): Promise<[PdfLink[], number, string | null]> {
  let status = 0;
  for (const host of [TRAVEL_STATE_GOV, STATE_MIRROR]) {
    const url = `${host}${path}`;
    let response: Response;
    let html: string;
    try {
      response = await get(url);
      html = await response.text();
    } catch (error) {
      console.log(`${host} failed (${errorMessage(error)}) for ${path}`);
      continue;
    }
    const links = response.status === 200 ? pdfLinks(url, html) : [];
    if (links.length > 0) {
      console.log(`using ${host} for ${path}: ${links.length} PDF links`);
      return [links, response.status, null];
    }
    // keep travel.state.gov's status for the warning in main()
    status ||= response.status;
    console.log(
      `${host} returned HTTP ${response.status} with ${links.length} PDF links for ${path}`,
    );
  }

  console.log(`trying the Wayback Machine for ${path}`);
  const url = `${TRAVEL_STATE_GOV}${path}`;
  const captures = await waybackCaptures(url, { limit: "-1" });
  if (captures.size === 0) return [[], status, null];
  const [timestamp, original] = [...captures.values()]
    .sort(([a, b], [c, d]) => (a === c ? (b < d ? -1 : 1) : a < c ? -1 : 1))
    .at(-1)!;
  const links = pdfLinks(
    url,
    new TextDecoder().decode(
      await fetchWayback(captureUrl(timestamp, original)),
    ),
  );
  console.log(
    `using Wayback capture ${timestamp} of ${path}: ${links.length} PDF links`,
  );
  return [links, status, timestamp];
}

const MONTHS = [
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
const MONTH = new RegExp(
  String.raw`(?<!\S)(${MONTHS.join("|")})\s+(\d{4})(?!\S)`,
  "i",
);

/** {"IV-2026-03": PDF URL, "NIV-2026-03": ...} for the by-post-and-class
 * reports. */
export function urlsByMonth(links: PdfLink[]): Map<string, string> {
  const result = new Map<string, string>();
  for (const link of links) {
    // some titles use an en dash, e.g. "February 2021 – NIV ..."
    const linkText = link.text.replaceAll("–", "-");
    const separator = linkText.indexOf(" - ");
    const month = separator === -1 ? linkText : linkText.slice(0, separator);
    const category =
      separator === -1
        ? ""
        : linkText.slice(separator + 3).replace("Visa Cass", "Visa Class");
    let kind: string;
    if (category.includes("NIV Issuances by Post and Visa Class")) kind = "NIV";
    else if (category.includes("IV Issuances by Post and Visa Class"))
      kind = "IV";
    else continue;
    const match = MONTH.exec(month);
    if (match === null)
      throw new Error(`cannot read the month of ${JSON.stringify(link.text)}`);
    const number = MONTHS.indexOf(match[1].toLowerCase()) + 1;
    result.set(
      `${kind}-${match[2]}-${String(number).padStart(2, "0")}`,
      link.url,
    );
  }
  return result;
}

/** Save one PDF to PDFS_DIR, from the Wayback Machine when captures is
 * given. */
async function downloadPdf(
  monthKey: string,
  url: string,
  captures: Captures | null,
): Promise<void> {
  const outfile = join(PDFS_DIR, `${monthKey}.pdf`);
  console.log(`downloading ${outfile}`);
  let content: Uint8Array;
  let source = url;
  if (captures !== null) {
    const capture = captures.get(normalizeUrl(url));
    if (capture === undefined) {
      throw new Error(
        `${url} is listed but has no Wayback capture; refusing to build a dataset with holes`,
      );
    }
    source = captureUrl(...capture);
    content = await fetchWayback(source);
  } else {
    const response = await get(url);
    content = new Uint8Array(await response.arrayBuffer());
    if (response.status !== 200)
      throw new Error(`${url} answered HTTP ${response.status}`);
  }
  if (new TextDecoder().decode(content.subarray(0, 4)) !== "%PDF")
    throw new Error(`${source} did not return a PDF`);
  writeFileSync(outfile, content);
}

/** Run tasks, at most limit at a time; throws the first failure once all
 * have settled. */
async function inPool(
  tasks: (() => Promise<void>)[],
  limit: number,
): Promise<void> {
  let next = 0;
  const failures: unknown[] = [];
  const worker = async () => {
    while (next < tasks.length) {
      const task = tasks[next++];
      try {
        await task();
      } catch (error) {
        failures.push(error);
      }
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(limit, tasks.length) }, worker),
  );
  if (failures.length > 0) throw failures[0];
}

// --- reading the PDFs ---------------------------------------------------------

// Every table row is "<Post> <Visa Class> <Issuances>" in the PDF's text
// layer. The page header ("Immigrant Visa Issuances by Post ...") is
// sometimes glued onto the end of a row, hence the optional non-digit tail
// after the number.
const ROW =
  /^(?<post>.+?)\s+(?<cls>[A-Z][A-Z0-9/-]*)\s+(?<n>\d[\d,]*)(?:\D.*)?$/;
const HEADER_POST = "Post Visa Class";

export type IssuanceRow = [post: string, visaClass: string, issuances: number];

/** The table rows of a text layer's lines. */
export function rowsOfLines(lines: string[]): IssuanceRow[] {
  const rows: IssuanceRow[] = [];
  for (const line of lines) {
    const match = ROW.exec(line.trim());
    if (match === null) continue;
    const post = match.groups!.post;
    if (post === "GRAND" || post.startsWith(HEADER_POST)) continue;
    rows.push([
      post,
      match.groups!.cls,
      Number(match.groups!.n.replaceAll(",", "")),
    ]);
  }
  return rows;
}

/** The PDF's text lines, in the order of its content, broken where pdf.js
 * sees a line end: a row's number sits up to half a point off the row's
 * baseline, so lines grouped by their height would split rows. */
async function pdfTextLines(content: Uint8Array): Promise<string[]> {
  const pdf = await getDocumentProxy(content, { verbosity: 0 });
  const lines: string[] = [];
  try {
    for (let number = 1; number <= pdf.numPages; number++) {
      const page = await pdf.getPage(number);
      let line = "";
      for (const item of (await page.getTextContent()).items) {
        if (!("str" in item)) continue;
        line += item.str;
        if (item.hasEOL) {
          lines.push(line);
          line = "";
        }
      }
      if (line) lines.push(line);
      page.cleanup();
    }
  } finally {
    await pdf.cleanup();
  }
  return lines;
}

interface Issuance {
  post: string;
  visaType: "IV" | "NIV";
  visaClass: string;
  // "2026-03-01"
  month: string;
  issuances: number;
}

/** Every row of every PDF in pdfs/: by month, then IV before NIV, then in
 * the PDF's order. */
async function readPdfs(): Promise<Issuance[]> {
  const names = readdirSync(PDFS_DIR)
    .filter((name) => name.endsWith(".pdf"))
    .sort();
  const all: Issuance[] = [];
  for (const name of names) {
    const [, visaType, month] = /^(N?IV)-(\d{4}-\d{2})\.pdf$/.exec(name) ?? [];
    if (visaType === undefined) throw new Error(`unexpected file pdfs/${name}`);
    const lines = await pdfTextLines(
      new Uint8Array(readFileSync(join(PDFS_DIR, name))),
    );
    for (const [post, visaClass, issuances] of rowsOfLines(lines)) {
      all.push({
        post,
        visaType: visaType as "IV" | "NIV",
        visaClass,
        month: `${month}-01`,
        issuances,
      });
    }
  }
  return all.sort((a, b) =>
    a.month < b.month ? -1 : a.month > b.month ? 1 : 0,
  );
}

// --- merging ------------------------------------------------------------------

const classes = (name: string, ...codes: string[]) =>
  Object.fromEntries(codes.map((code) => [code, name]));
const withSuffixes = (codes: string[]) =>
  codes.flatMap((code) => ["", "1", "2", "3"].map((n) => `${code}${n}`));

// Immigrant visa (IV) classes, keyed by the codes in State's PDFs. Until
// January 2021 State reported principals and their families under separate
// codes (DV1 for the lottery winner, DV2 for the spouse, DV3 for a child);
// since then mostly one code per category (DV). Both eras map onto the
// categories State reports now, so that every series runs across the change.
// The old codes are listed in
// https://travel.state.gov/content/dam/visas/Statistics/Immigrant-Statistics/MonthlyIVIssuances/Immigrant%20Visa%20Symbols.pdf
// (C = conditional residence; X = exempt from the per-country limit; B =
// self-petition).
//
// Some of the new IV codes are also nonimmigrant (NIV) codes with another
// meaning: IV E1, E2 and E3 are the first three employment preferences, but
// NIV E1, E2 and E3 are treaty traders, treaty investors and Australian
// professionals; IV F1 is the first family preference, NIV F1 a student; IV
// T5 is an investor, NIV T5 a trafficking victim's sibling. Every IV
// category therefore gets a name that no NIV class uses, and mergeClasses()
// checks that it stays that way. Codes not listed here (IR5, SB1, GV1, ...)
// keep their own name; so does E4 (15 visas in 2021-22), which State's list
// does not define. A code that comes with and without a trailing 1, 2 or 3
// (principal, spouse, child) belongs in one class here, or its series breaks
// where State switched between them.
export const IV_CLASSES: Record<string, string> = {
  ...classes("CR1/IR1", "CR1", "IR1"),
  ...classes("CR2/IR2", "CR2", "IR2"),
  ...classes("IW", "IW", "IW1", "IW2"),
  // IB3, children of IB1 self-petitioners, is reported under IB1 since 2021:
  // IB3 went from about 200 a year to none just as IB1 went from about 35 to
  // about 200.
  ...classes("IB1", "IB1", "IB3"),
  ...classes("DV", "DV", "DV1", "DV2", "DV3"),
  ...classes("F1 (family)", "F1", "F11", "F12"),
  ...classes(
    "F2A",
    ...["F2A", "F21", "F22", "F23"],
    ...["C2A", "C21", "C22", "C23"],
    ...["FX", "FX1", "FX2", "FX3"],
    ...["CX", "CX1", "CX2", "CX3"],
  ),
  ...classes("F2B", "F2B", "F24", "F25", "C24", "C25"),
  ...classes("F3", "F3", "F31", "F32", "F33", "C31", "C32", "C33"),
  ...classes("F4", "F4", "F41", "F42", "F43"),
  ...classes("EB-1", "E1", "E11", "E12", "E13", "E14", "E15"),
  ...classes("EB-2", "E2", "E21", "E22", "E23"),
  ...classes("EB-3", "E3", "E31", "E32", "E34", "E35"),
  ...classes("EW", "EW", "EW3", "EW4", "EW5"),
  // EB-5 is one class, with the set-asides of the EB-5 Reform and Integrity
  // Act of 2022 counted in it: State's codes for those came in from August
  // 2024 (NU and RU unreserved, NR and RR rural, NH and RH high unemployment,
  // RI infrastructure), each with a 1, 2 or 3 for principal, spouse and child
  // from February 2025. The Visa Bulletin groups them the same way ("5th
  // Unreserved (including C5, T5, I5, R5, NU, RU)", "Rural (20%, including
  // NR, RR)", ...), e.g.
  // https://travel.state.gov/content/travel/en/legal/visa-law0/visa-bulletin/2026/visa-bulletin-for-september-2026.html
  ...classes(
    "EB-5",
    ...withSuffixes([
      "I5",
      "C5",
      "T5",
      "R5",
      "NU",
      "RU",
      "NR",
      "RR",
      "NH",
      "RH",
      "RI",
    ]),
  ),
  ...Object.fromEntries(
    ["AM", "BC", "BX", "SD", "SE", "SI", "SK", "SQ", "SR"].flatMap((code) =>
      withSuffixes([code]).map((suffixed) => [suffixed, code]),
    ),
  ),
  // Afghan special immigrants admitted as conditional permanent residents:
  // one code (CQ) from August 2021, then CQ1, CQ2 and CQ3 from July 2022. See
  // https://www.uscis.gov/save/whats-new/afghan-special-immigrant-conditional-permanent-resident-status-and-non-si-parolees
  ...classes("CQ", "CQ", "CQ1", "CQ2", "CQ3"),
  ...classes("SU", "SU", "SU2", "SU3", "SU5"),
  ...classes("B2A", "B2A", "B21", "B22", "B23"),
  ...classes("B2B", "B2B", "B24", "B25"),
};

// Nonimmigrant visa (NIV) classes: every code is its own class but these.
export const NIV_CLASSES: Record<string, string> = {
  ...classes("B1/B2", "B1", "B2"),
  ...classes("BBBCC/BBBCV", "BBBCC", "BBBCV"),
};

// One name per post
const POST_NAMES: Record<string, string> = {
  "AIT Taipei": "Taipei",
  "Dar Es Salaam": "Dar es Salaam",
  "Mumbai (Bombay)": "Mumbai",
  Guatemala: "Guatemala City",
  Panama: "Panama City",
  Kuwait: "Kuwait City",
  "Port Au Prince": "Port-au-Prince",
  "Port Of Spain": "Port of Spain",
  "Rio De Janeiro": "Rio de Janeiro",
  "Tijuana Tpf": "Tijuana",
  "Chennai ( Madras)": "Chennai",
  "Chennai (Madras)": "Chennai",
  // Kazakhstan's capital was called Nur-Sultan from 2019 to 2022, and the
  // embassy's rows carry that name for exactly those months.
  "Nur-Sultan": "Astana",
  // Belize's embassy is in Belmopan; "Belize" has one month of rows (11 visas).
  Belize: "Belmopan",
};

const lookup = (table: Record<string, string>, key: string) =>
  Object.hasOwn(table, key) ? table[key] : key;

/** As Python's slugify here did: lowercased, whitespace and underscores as
 * dashes, anything but letters, digits, underscores and dashes left out. */
export function slugify(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[\s_]/g, "-")
    .replace(/[^\p{L}\p{N}_-]/gu, "");
}

interface Merged extends Issuance {
  postSlug: string;
  visaClassSlug: string;
}

/** State's codes mapped onto IV_CLASSES and NIV_CLASSES and posts onto one
 * name each, the rows of one post, class and month summed, in the order
 * each first appears, with the slugs the pages are keyed by. */
export function mergeClasses(all: Issuance[]): Merged[] {
  // A code with and without a trailing digit, such as CQ and CQ1, is one
  // category that State reported in one code, then apart for principals and
  // their families (or the other way round). Counted apart, its series stops
  // where the other one starts.
  const ivCodes = new Set(
    all.filter((row) => row.visaType === "IV").map((row) => row.visaClass),
  );
  const split = [...ivCodes]
    .flatMap((code) =>
      [..."0123456789"].map((digit) => [code, `${code}${digit}`]),
    )
    .filter(
      ([code, suffixed]) =>
        ivCodes.has(suffixed) &&
        lookup(IV_CLASSES, suffixed) !== lookup(IV_CLASSES, code),
    )
    .map(([, suffixed]) => suffixed)
    .sort();
  if (split.length > 0) {
    console.log(
      `::warning::the immigrant visa codes ${JSON.stringify(split)} are counted apart from the same code without the last digit: map both onto one class in IV_CLASSES`,
    );
  }

  const merged = new Map<string, Merged>();
  const typesPerClass = new Map<string, Set<string>>();
  for (const row of all) {
    const visaClass = lookup(
      row.visaType === "IV" ? IV_CLASSES : NIV_CLASSES,
      row.visaClass,
    );
    const post = lookup(POST_NAMES, row.post);
    if (!typesPerClass.has(visaClass)) typesPerClass.set(visaClass, new Set());
    typesPerClass.get(visaClass)!.add(row.visaType);
    const key = JSON.stringify([post, row.visaType, visaClass, row.month]);
    const known = merged.get(key);
    if (known !== undefined) known.issuances += row.issuances;
    else
      merged.set(key, {
        ...row,
        post,
        visaClass,
        postSlug: slugify(post),
        visaClassSlug: slugify(visaClass),
      });
  }
  const shared = [...typesPerClass]
    .filter(([, types]) => types.size > 1)
    .map(([visaClass]) => visaClass);
  if (shared.length > 0) {
    throw new Error(
      `immigrant and nonimmigrant visas share the classes ${JSON.stringify(shared.sort())}: give the immigrant ones their own name in IV_CLASSES`,
    );
  }
  return [...merged.values()];
}

// --- the tables ---------------------------------------------------------------

// Descriptions for the classes this script names or merges are kept in the
// repository; the others come from a sheet the site's owner keeps.
const VISA_DESCRIPTIONS_PATH = join(HERE, "visa_descriptions.csv");
const VISA_DESCRIPTIONS_SHEET_URL =
  "https://docs.google.com/spreadsheets/d/1GLtqb3PVXFriG7lanunfYJrpUE7_e0_L-PEN2spBQbY/export?format=csv";
// The cells pandas read as missing, as the Python version read the sheets with it
const MISSING = new Set([
  "",
  "#N/A",
  "#N/A N/A",
  "#NA",
  "-1.#IND",
  "-1.#QNAN",
  "-NaN",
  "-nan",
  "1.#IND",
  "1.#QNAN",
  "<NA>",
  "N/A",
  "NA",
  "NULL",
  "NaN",
  "None",
  "n/a",
  "nan",
  "null",
]);

/** A description sheet's descriptions by slug, the first one for a slug,
 * missing ones left out. */
export function descriptionsOf(csv: string): Map<string, string> {
  const [header, ...rows] = parseCsv(csv).filter((row) => row.length > 0);
  const slugColumn = header.indexOf("Visa Class Slug");
  const descriptionColumn = header.indexOf("Description");
  if (slugColumn === -1 || descriptionColumn === -1)
    throw new Error("no Visa Class Slug or Description column");
  const descriptions = new Map<string, string>();
  for (const row of rows) {
    const slug = row[slugColumn] ?? "";
    const description = row[descriptionColumn] ?? "";
    if (!MISSING.has(description) && !descriptions.has(slug))
      descriptions.set(slug, description);
  }
  return descriptions;
}

type Value = string | number | null;

/** The post_slugs, visa_slugs and backlogs tables' rows. */
export function tables(
  merged: Merged[],
  committed: Map<string, string>,
  sheet: Map<string, string>,
): Record<"post_slugs" | "visa_slugs" | "backlogs", Value[][]> {
  const unique = (rows: Value[][]) => [
    ...new Map(rows.map((row) => [JSON.stringify(row), row])).values(),
  ];
  const postSlugs = unique(merged.map((row) => [row.postSlug, row.post]));

  const visaSlugs = unique(
    merged.map((row) => [row.visaClassSlug, row.visaClass, row.visaType]),
  );
  const slugs = visaSlugs.map(([slug]) => slug as string);
  const duplicated = [
    ...new Set(slugs.filter((slug, i) => slugs.indexOf(slug) !== i)),
  ].sort();
  if (duplicated.length > 0)
    throw new Error(
      `these slugs stand for more than one class: ${JSON.stringify(duplicated)}`,
    );
  const unused = [...committed.keys()]
    .filter((slug) => !slugs.includes(slug))
    .sort();
  if (unused.length > 0)
    console.log(
      `::warning::visa_descriptions.csv describes unknown classes ${JSON.stringify(unused)}`,
    );
  for (const row of visaSlugs) {
    const slug = row[0] as string;
    row.push(committed.get(slug) ?? sheet.get(slug) ?? null);
  }

  // A row per (post, visa class) in first-seen order and a month for every
  // month of the whole period, 0 where the PDFs had no row.
  const months = merged.map((row) => row.month).sort();
  const range: string[] = [];
  for (
    let date = new Date(`${months[0]}T00:00:00Z`);
    ;
    date.setUTCMonth(date.getUTCMonth() + 1)
  ) {
    const month = date.toISOString().slice(0, 10);
    if (month > months.at(-1)!) break;
    range.push(month);
  }
  const sums = new Map<string, number>();
  const pairs = new Map<string, [string, string]>();
  for (const row of merged) {
    const pair = JSON.stringify([row.postSlug, row.visaClassSlug]);
    if (!pairs.has(pair)) pairs.set(pair, [row.postSlug, row.visaClassSlug]);
    const key = `${pair}${row.month}`;
    sums.set(key, (sums.get(key) ?? 0) + row.issuances);
  }
  const backlogs: Value[][] = [];
  for (const [pair, [postSlug, visaClassSlug]] of pairs) {
    for (const month of range) {
      backlogs.push([
        postSlug,
        visaClassSlug,
        `${month} 00:00:00`,
        sums.get(`${pair}${month}`) ?? 0,
      ]);
    }
  }
  return { post_slugs: postSlugs, visa_slugs: visaSlugs, backlogs };
}

const METADATA = {
  backlogs: {
    name: "backlogs",
    columns: ["Post Slug", "Visa Class Slug", "Month", "Issuances"],
    schema:
      'CREATE TABLE "backlogs" (\n"Post Slug" TEXT,\n  "Visa Class Slug" TEXT,\n  "Month" TIMESTAMP,\n  "Issuances" INTEGER\n)',
  },
  post_slugs: {
    name: "post_slugs",
    columns: ["Post Slug", "Post"],
    schema: 'CREATE TABLE "post_slugs" (\n"Post Slug" TEXT,\n  "Post" TEXT\n)',
  },
  visa_slugs: {
    name: "visa_slugs",
    columns: ["Visa Class Slug", "Visa Class", "Visa Type", "Description"],
    schema:
      'CREATE TABLE "visa_slugs" (\n"Visa Class Slug" TEXT,\n  "Visa Class" TEXT,\n  "Visa Type" TEXT,\n  "Description" TEXT\n)',
  },
};

/** A row as sqlite-diffable wrote it with Python's json.dumps(): ", "
 * between values, non-ASCII escaped. */
export function ndjsonLine(row: Value[]): string {
  const json = `[${row.map((value) => JSON.stringify(value)).join(", ")}]`;
  return json.replace(
    /[\u0080-￿]/g,
    (char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, "0")}`,
  );
}

/** The tables as dump/ holds them: per table, <table>.metadata.json and
 * <table>.ndjson, which for backlogs (1.3M+ rows, past GitHub's 100 MB file
 * limit as plain text) is gzipped. The gzip header carries no name or time,
 * so the same data gives the same bytes. */
function writeDump(rows: ReturnType<typeof tables>): void {
  mkdirSync(DUMP_DIR, { recursive: true });
  for (const [table, metadata] of Object.entries(METADATA) as [
    keyof typeof METADATA,
    (typeof METADATA)["backlogs"],
  ][]) {
    writeFileSync(
      join(DUMP_DIR, `${table}.metadata.json`),
      JSON.stringify(metadata, null, 4),
    );
    const ndjson = rows[table].map((row) => `${ndjsonLine(row)}\n`).join("");
    if (table === "backlogs")
      writeFileSync(
        join(DUMP_DIR, "backlogs.ndjson.gz"),
        gzipSync(ndjson, { level: 9 }),
      );
    else writeFileSync(join(DUMP_DIR, `${table}.ndjson`), ndjson);
    console.log(`${table}: ${rows[table].length} rows`);
  }
}

async function fetchSheet(): Promise<string> {
  const response = await get(VISA_DESCRIPTIONS_SHEET_URL);
  if (response.status !== 200)
    throw new Error(`the descriptions sheet answered HTTP ${response.status}`);
  return decodeText(new Uint8Array(await response.arrayBuffer()));
}

async function main(): Promise<number> {
  const offline = process.argv.includes("--offline");
  mkdirSync(PDFS_DIR, { recursive: true });
  if (!offline) {
    const [ivLinks, ivStatus, ivWayback] = await listPdfs(IV_LISTING_PATH);
    const [nivLinks, nivStatus, nivWayback] = await listPdfs(NIV_LISTING_PATH);
    if (ivLinks.length === 0 || nivLinks.length === 0) {
      console.log(
        `::warning::travel.state.gov returned HTTP ${ivLinks.length > 0 ? nivStatus : ivStatus}; upstream is blocking automated access, leaving existing data unchanged`,
      );
      return 0;
    }
    const usingWayback = ivWayback !== null || nivWayback !== null;
    const urls = urlsByMonth([...ivLinks, ...nivLinks]);
    const missing = [...urls.keys()].filter(
      (key) => !existsSync(join(PDFS_DIR, `${key}.pdf`)),
    );
    console.log(
      `${urls.size} months listed, ${missing.length} not downloaded yet`,
    );

    let captures: Captures | null = null;
    if (usingWayback) {
      captures = new Map();
      // one CDX query per PDF directory (5-15 s each, occasionally much
      // slower), so skipped on the usual day when the restored pdfs/ cache is
      // complete
      if (missing.length > 0) {
        for (const directory of new Set(
          [...urls.values()].map((url) => url.slice(0, url.lastIndexOf("/"))),
        )) {
          for (const [key, capture] of await waybackCaptures(`${directory}/*`))
            captures.set(key, capture);
        }
        console.log(
          `${captures.size} files are available from the Wayback Machine`,
        );
      }
    }
    await inPool(
      missing.map((key) => () => downloadPdf(key, urls.get(key)!, captures)),
      usingWayback ? WAYBACK_DOWNLOADS : DIRECT_DOWNLOADS,
    );
  }

  const merged = mergeClasses(await readPdfs());
  const committed = descriptionsOf(
    readFileSync(VISA_DESCRIPTIONS_PATH, "utf8"),
  );
  const rows = tables(merged, committed, descriptionsOf(await fetchSheet()));
  writeDump(rows);
  return 0;
}

if (import.meta.main) process.exit(await main());
