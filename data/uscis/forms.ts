// Build forms.json: quarterly receipts, approvals, denials and pending
// applications for every USCIS form, nationwide and (for the forms USCIS
// breaks down that way) per field office.
//
// USCIS publishes two kinds of quarterly reports on its Immigration and
// Citizenship Data page, as CSV, PDF or (since FY2024) XLSX:
//
// * "All USCIS Application and Petition Form Types": for every form (and for
//   some, per category, e.g. I-130 immediate relatives vs. other relatives)
//   the forms received, approved and denied in the quarter, the ones pending
//   at its end and, since FY2022, USCIS's median processing time. Since
//   FY2014.
// * Per-office reports for N-400, I-485 and I-130 (all since FY2014): the
//   same four counts per field office or service center, per category (I-130
//   immediate relatives vs. other relatives, I-485 family, employment,
//   humanitarian and other, N-400 civilian vs. military) and in total.
//
// Sources, in order:
//
// 1. www.uscis.gov directly. It sits behind Akamai, which answers HTTP 403 to
//    non-browser clients most of the time.
// 2. The Wayback Machine, whose crawler *is* let through: the CDX index for
//    the reports it already has, and Save Page Now for the listing page and
//    for reports it has not captured yet, so a freshly published quarter
//    still shows up here within a day. The CDX index is often down for days
//    (HTTP 503); discovery then goes on without it, since the cache and the
//    listing page cover what it would find.
//
// Downloaded reports are cached in reports/ (gitignored, cached between
// workflow runs) under their URL's path, so a report USCIS republishes under
// a new name (a "_v2" or "_final" file) is downloaded rather than taken for
// the one already cached; the parsed dataset is written to forms.json.
//
// Exit codes: 0 when the dataset was (re)built; 1 when a report cannot be
// fetched from any source or no longer parses (a layout change), so that the
// workflow fails loudly instead of silently publishing a hole in the history.
// Numbers that parse but look wrong (offices that do not add up to the
// report's total, a national count far from the per-office report's) are
// printed as GitHub Actions warnings instead, since USCIS's own reports have
// such defects.
//
//     bun data/uscis/forms.ts                # discover, download, rebuild
//     bun data/uscis/forms.ts --offline      # rebuild from the cached reports alone
//     bun data/uscis/forms.ts --check-cache  # exit 1 unless every cited report is cached
//
// `--offline` skips discovery and rebuilds the dataset from the cached
// reports alone, for iterating on the parsers.
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { decodeText, parseCsv } from "../lib/csv";
import { attr, findAll, parseHtml } from "../lib/html";
import { errorMessage, get, sleep, withParams } from "../lib/http";
import { pdfPages, plumberWords, type Word } from "../lib/pdf";
import { xlsxRows } from "../lib/xlsx";

const HERE = import.meta.dir;
const REPORTS_DIR = join(HERE, "reports");
const OUTPUT_PATH = process.env.USCIS_FORMS_PATH ?? join(HERE, "forms.json");

const USCIS = "https://www.uscis.gov";
const LISTING_URL = `${USCIS}/tools/reports-and-studies/immigration-and-citizenship-data`;
const WAYBACK = "https://web.archive.org";
const CDX_URL = `${WAYBACK}/cdx/search/cdx`;
const DOCUMENT_DIRS = [
  "www.uscis.gov/sites/default/files/document/data/",
  "www.uscis.gov/sites/default/files/document/reports/",
];

const TIMEOUT_MS = 60_000;
// CDX queries usually answer in 5-15 s but occasionally hang
const CDX_TIMEOUT_MS = 90_000;
const SAVE_TIMEOUT_MS = 180_000;
const WAYBACK_ATTEMPTS = 6;
// USCIS publishes a quarter's reports no sooner than this many days after
// the quarter ends (FY2026 Q3, which ended June 30, appeared in early
// September), so until then a failed discovery cannot have missed a new
// quarter.
const EARLIEST_PUBLICATION_DAYS = 45;

// A browser's user agent: Akamai lets it through more often than a bot's
export const USCIS_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
    "(KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
  "Accept-Language": "en-US,en;q=0.9",
};

/** One series of quarterly reports. */
interface ReportFamily {
  // Which form's per-office reports these are, or null for the all-forms report
  form: string | null;
  // Prefixes of the report file names (the CDX index matches them case-insensitively)
  filePrefixes: string[];
  // Full-text search on the listing page that finds the family's newest reports
  listingQuery: string;
  // Below this many rows, a report is considered misparsed
  minRows: number;
  // Per-office reports: the labels of the category column groups, each of
  // (Received, Approved, Denied, Pending), which a last "Total" group
  // follows. The CSV and XLSX reports name them in their header; the PDFs'
  // text layer does not keep the header's columns, so these are used there.
  categories: string[];
}

/** Column groups per office row: the categories and the total. */
const groupsOf = (family: ReportFamily) => family.categories.length + 1;

export const FAMILIES: Record<string, ReportFamily> = {
  all_forms: {
    form: null,
    filePrefixes: ["all_forms_performancedata", "quarterly_all_forms"],
    listingQuery: "All USCIS Application and Petition Form Types",
    minRows: 30,
    categories: [],
  },
  "N-400": {
    form: "N-400",
    filePrefixes: ["n400_perf"],
    listingQuery: "N-400 Naturalization",
    minRows: 60,
    categories: ["Naturalization", "Naturalization (Military)"],
  },
  "I-130": {
    form: "I-130",
    filePrefixes: ["i130_perf"],
    listingQuery: "I-130 Alien Relative",
    minRows: 20,
    categories: ["Immediate Relative", "All Other Relative"],
  },
  "I-485": {
    form: "I-485",
    filePrefixes: ["i485_perf"],
    listingQuery: "I-485 Adjustment of Status",
    minRows: 60,
    categories: [
      "Family-based",
      "Employment-based received at service center",
      "Humanitarian-based",
      "Others",
    ],
  },
};
// The listing page also links a CSV next to most PDFs and, for FY2013 and
// earlier, reports with other names and layouts; those are not handled.
const REPORT_FILENAME =
  /fy(?<fy>\d{4}|\d{2})_?q(?:tr)?(?<q>[1-4])(?:_final|_v\d+(?:\.\d+)?)?\.(?<ext>xlsx|csv|pdf)$/i;
// When USCIS published a quarter in several formats, prefer the most structured one.
const FORMAT_PRIORITY: Record<string, number> = { xlsx: 0, csv: 1, pdf: 2 };
// Reports for FY2013 and earlier have different names and layouts
const MIN_FISCAL_YEAR = 2014;

const STATES: Record<string, string> = {
  Alabama: "AL",
  Alaska: "AK",
  Arizona: "AZ",
  Arkansas: "AR",
  California: "CA",
  Colorado: "CO",
  Connecticut: "CT",
  Delaware: "DE",
  "District of Columbia": "DC",
  Florida: "FL",
  Georgia: "GA",
  Hawaii: "HI",
  Idaho: "ID",
  Illinois: "IL",
  Indiana: "IN",
  Iowa: "IA",
  Kansas: "KS",
  Kentucky: "KY",
  Louisiana: "LA",
  Maine: "ME",
  Maryland: "MD",
  Massachusetts: "MA",
  Michigan: "MI",
  Minnesota: "MN",
  Mississippi: "MS",
  Missouri: "MO",
  Montana: "MT",
  Nebraska: "NE",
  Nevada: "NV",
  "New Hampshire": "NH",
  "New Jersey": "NJ",
  "New Mexico": "NM",
  "New York": "NY",
  "North Carolina": "NC",
  "North Dakota": "ND",
  Ohio: "OH",
  Oklahoma: "OK",
  Oregon: "OR",
  Pennsylvania: "PA",
  "Rhode Island": "RI",
  "South Carolina": "SC",
  "South Dakota": "SD",
  Tennessee: "TN",
  Texas: "TX",
  Utah: "UT",
  Vermont: "VT",
  Virginia: "VA",
  Washington: "WA",
  "West Virginia": "WV",
  Wisconsin: "WI",
  Wyoming: "WY",
  "American Samoa": "AS",
  Guam: "GU",
  "Northern Mariana Islands": "MP",
  "Puerto Rico": "PR",
  "U.S. Virgin Islands": "VI",
  "Virgin Islands": "VI",
  "US Virgin Islands": "VI",
  "Washington, D.C.": "DC",
  "Washington DC": "DC",
};
const lettersOnly = (text: string) => text.toLowerCase().replace(/[^a-z]/g, "");
const STATES_BY_NORMALIZED_NAME = new Map(
  Object.keys(STATES).map((name) => [lettersOnly(name), name]),
);
// Office names the reports consistently misspell, and service centers, which
// the I-130 and I-485 reports list by their state's name alone
const NAME_FIXES: Record<string, string> = {
  OFM: "Fort Myers",
  WSC: "California Service Center",
  ESC: "Vermont Service Center",
  NSC: "Nebraska Service Center",
  SSC: "Texas Service Center",
  YSC: "Potomac Service Center",
};
// The FY2014-FY2015 reports list the service centers under a "Service
// Center" heading by their state's name alone, without a code
const SERVICE_CENTER_CODES: Record<string, string> = {
  California: "WSC",
  Vermont: "ESC",
  Nebraska: "NSC",
  Texas: "SSC",
  Potomac: "YSC",
};
const serviceCenterCode = (name: string) =>
  Object.hasOwn(SERVICE_CENTER_CODES, name) ? SERVICE_CENTER_CODES[name] : null;
const SERVICE_CENTER_HEADING = /^service\s*cent/i;
// Section headings, which some reports fill with zeros
const HEADING = /^(?:field office|service cent)/i;
// Immigrant visas (a State Department form) and immigration court
// adjustments: not USCIS adjudications, and only reported since FY2026
const SKIPPED_CATEGORIES = new Set(["Supplemental Processing"]);

// The form's name where the all-forms report has no row titled after the
// whole form: since FY2026 the I-131's rows are its categories, the largest
// of which is advance parole.
const FORM_TITLES: Record<string, string> = {
  "I-131":
    "Application for Travel Documents, Parole Documents, and Arrival/Departure Records",
};
// A stable key for each category row of the forms the all-forms report
// splits into categories, by the row's title (compared ignoring case and
// spacing), so that a category keeps its history when USCIS retitles its
// row. A form's only row in a quarter is "all" unless listed here. The I-130
// and I-765 rows from before USCIS split them by category ("all") cover
// every category and are deliberately not joined to any one of them.
const VARIANT_KEYS: Record<string, Record<string, string>> = {
  "I-130": {
    "Immediate and Preference Relatives": "all",
    "Petition for Alien Relative": "all",
    "Petition for Alien Relative (Immediate Relative)": "immediate-relative",
    "Petition for Alien Relative (All Other Relative)": "all-other-relative",
  },
  "I-131": {
    "Reentry Permit/Refugee Travel Document": "travel-document",
    "Application for Travel Document": "travel-document",
    "Application for Travel Documents, Parole Documents, and Arrival/Departure Records":
      "travel-document",
    "Advance Parole": "advance-parole",
    "Application for Travel Document (Advance Parole)": "advance-parole",
    "Application for Advance Parole Document for Aliens Inside the United States":
      "advance-parole",
    "Application for Travel Document (Parole-in-Place)": "parole-in-place",
    "Application for Travel Document, Parole Documents, and Arrival/Departure Records (Parole in Place)":
      "parole-in-place",
    "Application for Travel Documents, Parole Documents, and Arrival/Departure Records (Parole in Place)":
      "parole-in-place",
    "Application for Travel Document (Humanitarian Parole)":
      "humanitarian-parole",
    "Application for Initial Parole Document for Aliens Outside the United States":
      "initial-parole",
  },
  "I-485": {
    "Family-Based Adjustments": "family",
    "Employment-Based Adjustments": "employment",
    "Asylum Adjustments": "asylum",
    "Refugee Adjustments": "refugee",
    "Cuban Adjustment Act": "cuban",
    "Indo Chinese Adjustments": "indo-chinese",
    "Other Adjustments of Status": "other",
    "Application to Register Permanent Residence or Adjust Status (Family)":
      "family",
    "Application to Register Permanent Residence or Adjust Status (Employment)":
      "employment",
    "Application to Register Permanent Residence or Adjust Status (Asylum)":
      "asylum",
    "Application to Register Permanent Residence or Adjust Status (Refugee)":
      "refugee",
    "Application to Register Permanent Residence or Adjust Status (Cuban)":
      "cuban",
    "Application to Register Permanent Residence or Adjust Status (Indo-Chinese)":
      "indo-chinese",
    "Application to Register Permanent Residence or Adjust Status (Other)":
      "other",
  },
  // Petitions filed before the EB-5 Reform and Integrity Act of 2022, which
  // USCIS has reported as "Legacy" since it split off standalone investors
  "I-526": {
    "Petitions by Entrepreneurs": "legacy",
    "Immigrant Petition by Alien Investor": "legacy",
    "Immigrant Petition by Alien Investor (Legacy)": "legacy",
    "Immigrant Petition by Standalone Investor": "standalone",
  },
  "I-765": {
    "Employment Authorization Documents": "all",
    "Application for Employment Authorization": "all",
    "Application for Employment Authorization (Asylum)": "asylum",
    "Application for Employment Authorization (Adjustment Of Status)":
      "adjustment-of-status",
    "Application for Employment Authorization (DACA)": "daca",
    "Application for Employment Authorization (All Other)": "all-other",
  },
  "N-400": {
    "Non-Military Naturalization": "civilian",
    "Application for Naturalization": "civilian",
    "Military Naturalization": "military",
    "Application for Naturalization (Military)": "military",
  },
};
// The per-office reports' categories, by a word of their label, first match
// first: [form, word, key]
const OFFICE_CATEGORY_KEYS: [string, string, string][] = [
  ["I-130", "immediate", "immediate-relative"],
  ["I-130", "other", "all-other-relative"],
  ["I-485", "family", "family"],
  ["I-485", "employment", "employment"],
  ["I-485", "humanitarian", "humanitarian"],
  ["I-485", "other", "other"],
  ["N-400", "military", "military"],
  ["N-400", "naturalization", "civilian"],
];
// National pending (all-forms report) vs. the per-office report's total,
// above which a quarter is flagged: the two reports come from separate
// queries and differ by up to 10% in a few quarters (I-130 in July-September
// 2019), but a misread report is further off (FY2024's fractional cells: 25%).
const NATIONAL_VS_OFFICES_TOLERANCE = 0.15;

const FIELDS = ["received", "approved", "denied", "pending"] as const;
type Field = (typeof FIELDS)[number];
// "D" is a count withheld for privacy, "H" one withheld so "D" cannot be
// derived; a decimal is a count USCIS apportioned between categories
const VALUE_TOKEN = /^(?:\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?|D|H|-|N\/?A)?$/;
const NUMBER = /^(?:\d{1,3}(?:,\d{3})+|\d{1,3})$/;
// A value, or a piece of one that PDF extraction split off ("1" ",925,486")
const NUMBER_FRAGMENT = /^(?:[\d,]+|\d+\.\d+|D|H|-|N\/?A)$/;
const DIGITS = /^[\d,.]+$/;
const OFFICE_CODE = /^[A-Z]{3}$/;
// A "Received" column header (with its footnote digit), as opposed to the
// "Employment-based received at service center" category label above it
const RECEIVED_HEADER = /\breceived\s*\d*$/i;
// A form number, possibly with a footnote digit or two glued on ("I-6007",
// "N-400 17"). I-90 is the only two-digit form, so "I-908" is I-90 with
// footnote 8 unless it is another form: see formNumber().
const FORM_KEY = /^(?<form>[A-Z]{1,4}-\d{2,3}[A-Z]{0,2})\s*\d{0,2}$/;
// The office name may itself contain a three-letter word ("Dover AFB DVD");
// the code is the last one before the counts.
const PDF_VALUES = String.raw`(?<values>(?:[\d,]+|D|H|-|N\/?A)(?:\s+(?:[\d,]+|D|H|-|N\/?A)){7,})`;
const PDF_OFFICE_LINE = new RegExp(
  String.raw`^(?<name>[A-Za-z][A-Za-z .'()-]*)\s+(?<code>[A-Z]{3})\s+${PDF_VALUES}\s*$`,
);
const PDF_TOTAL_LINE = /^(?:Grand\s+)?Total\s+(?<values>.+)$/i;
// Reports before FY2017 name the offices without a code
const PDF_CODELESS_OFFICE_LINE = new RegExp(
  String.raw`^(?<name>[A-Za-z][A-Za-z .'()-]*?)\s+${PDF_VALUES}\s*$`,
);
// What an office line that none of the above read looks like: a code and counts
const PDF_UNREAD_OFFICE_LINE = new RegExp(
  String.raw`\b[A-Z]{3}\s+${PDF_VALUES}\s*$`,
);
const PDF_FORM_LINE =
  /^(?<form>[A-Z]{1,4}-\d{2,3}[A-Z]{0,2})(?:\s\d{1,2})?\s+(?<rest>[A-Za-z(].*)$/;

// --- Python's string handling, which the reports' parsing was written for ------

// What Python's str.split() and str.strip() take for whitespace
const WHITESPACE =
  "[ \\t\\n\\r\\v\\f\\x1c-\\x1f\\x85\\xa0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000]";
const WHITESPACE_RUN = new RegExp(`${WHITESPACE}+`);
const EDGE_WHITESPACE = new RegExp(`^${WHITESPACE}+|${WHITESPACE}+$`, "g");
export const strip = (text: string) => text.replace(EDGE_WHITESPACE, "");
export const splitWords = (text: string) =>
  text.split(WHITESPACE_RUN).filter(Boolean);

/** Round half to even, as Python's round() does. */
export function roundHalfEven(value: number): number {
  const floor = Math.floor(value);
  const fraction = value - floor;
  if (fraction > 0.5) return floor + 1;
  if (fraction < 0.5) return floor;
  return floor % 2 === 0 ? floor : floor + 1;
}

const repr = (value: unknown) => JSON.stringify(value);
const formatCount = (value: number) => value.toLocaleString("en-US");

// --- reports ------------------------------------------------------------------

export interface Report {
  family: string;
  fiscalYear: number;
  fiscalQuarter: number;
  priority: number;
  url: string;
}

/** A report's URL without its query, over https: the Wayback Machine has
 * captured some files under http://, which must not pass for another file. */
export function canonicalUrl(url: string): string {
  return url
    .split("?")[0]
    .split("#")[0]
    .replace(/^http:\/\//i, "https://");
}

/** [host, path] of a URL, as urlsplit() splits them */
function splitUrl(url: string): [string, string] {
  const match = /^[a-z][a-z0-9+.-]*:\/\/([^/?#]*)([^?#]*)/i.exec(url);
  return match === null ? ["", url] : [match[1], match[2]];
}

export function reportFromUrl(rawUrl: string): Report | null {
  const url = canonicalUrl(rawUrl);
  const [host, path] = splitUrl(url);
  if (host !== "www.uscis.gov" || path.includes("..")) return null;
  const filename = path.split("/").at(-1)!.toLowerCase();
  const family = Object.keys(FAMILIES).find((name) =>
    FAMILIES[name].filePrefixes.some((prefix) => filename.startsWith(prefix)),
  );
  const match = REPORT_FILENAME.exec(filename);
  if (family === undefined || match === null) return null;
  let fiscalYear = Number(match.groups!.fy);
  if (fiscalYear < 100) fiscalYear += 2000;
  if (fiscalYear < MIN_FISCAL_YEAR) return null;
  return {
    family,
    fiscalYear,
    fiscalQuarter: Number(match.groups!.q),
    priority: FORMAT_PRIORITY[match.groups!.ext.toLowerCase()],
    url,
  };
}

const extOf = (report: Report) => report.url.split(".").at(-1)!.toLowerCase();

/** The downloaded file: reports/ mirrors the URL's path, so every file USCIS
 * publishes has its own. */
const cachePath = (report: Report) =>
  join(REPORTS_DIR, splitUrl(report.url)[1].replace(/^\/+/, ""));

type SortKey = (boolean | number | string)[];

function compareKeys(a: SortKey, b: SortKey): number {
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    if (a[i] < b[i]) return -1;
    if (a[i] > b[i]) return 1;
  }
  return a.length - b.length;
}

const reportOrder = (report: Report): SortKey => [
  report.family,
  report.fiscalYear,
  report.fiscalQuarter,
  report.priority,
  report.url,
];

/** How to choose among the files for one family and quarter, best (smallest)
 * first.
 *
 * A complete report before a state-only or territory-only extract (for
 * FY2023 Q3 USCIS published an I-130 report that ends at Wisconsin next to
 * the complete one), a republished version ("_v2", "_v1.1") before the one
 * it corrects, a "_final" before a draft, then the most structured format.
 * The URL only breaks ties, so the choice is stable. */
function rank(report: Report): SortKey {
  const name = report.url.split("/").at(-1)!.toLowerCase();
  const version = /_v(\d+)(?:\.(\d+))?\.\w+$/.exec(name);
  return [
    /_(?:state|territory)_/.test(name),
    version ? -Number(version[1]) : 0,
    version ? -Number(version[2] ?? 0) : 0,
    !name.includes("_final"),
    report.priority,
    report.url,
  ];
}

/** The best file (rank) for each family and quarter, in chronological order
 * per family. */
export function bestReports(reports: Iterable<Report>): Report[] {
  const candidates = new Map<string, Report[]>();
  for (const report of reports) {
    const key = JSON.stringify([
      report.family,
      report.fiscalYear,
      report.fiscalQuarter,
    ]);
    if (!candidates.has(key)) candidates.set(key, []);
    candidates.get(key)!.push(report);
  }
  const best: Report[] = [];
  const groups = [...candidates.values()].sort((a, b) =>
    compareKeys(reportOrder(a[0]).slice(0, 3), reportOrder(b[0]).slice(0, 3)),
  );
  for (const group of groups) {
    group.sort((a, b) => compareKeys(rank(a), rank(b)));
    const chosen = group[0];
    const others = group
      .slice(1)
      .filter((report) => extOf(report) === extOf(chosen));
    if (others.length > 0) {
      console.log(
        `${chosen.family} FY${chosen.fiscalYear} Q${chosen.fiscalQuarter}: using ${chosen.url}, not ${others.map((r) => r.url).join(", ")}`,
      );
    }
    best.push(chosen);
  }
  return best.sort((a, b) => compareKeys(reportOrder(a), reportOrder(b)));
}

const isoDate = (date: Date) => date.toISOString().slice(0, 10);

/** [key like "2025-Q3", first day, last day] of a fiscal quarter's calendar
 * quarter. Fiscal quarter 1 is October-December of the previous calendar
 * year. */
export function calendarQuarter(
  fiscalYear: number,
  fiscalQuarter: number,
): [string, Date, Date] {
  const firstMonth = { 1: 10, 2: 1, 3: 4, 4: 7 }[
    fiscalQuarter as 1 | 2 | 3 | 4
  ];
  const year = fiscalQuarter === 1 ? fiscalYear - 1 : fiscalYear;
  const start = new Date(Date.UTC(year, firstMonth - 1, 1));
  const end = new Date(Date.UTC(year, firstMonth + 2, 0));
  return [`${year}-Q${Math.floor((firstMonth - 1) / 3) + 1}`, start, end];
}

/** Received, approved, denied and pending; null for a count USCIS withheld
 * or did not publish. */
export interface Counts {
  values: [number | null, number | null, number | null, number | null];
  // Which of them USCIS withheld as too small to disclose ("D": where the
  // N-400 and I-485 offices add up to the report's total, the remainder
  // usually works out at 1 to 9 per "D"), as opposed to ones it did not
  // publish ("N/A", blank) or withheld so a "D" cannot be worked out ("H",
  // any size)
  withheld: Set<Field>;
}

type CountsJson = Partial<Record<Field, number | null>> & {
  withheld?: Field[];
};

function countsJson(counts: Counts): CountsJson {
  const result: CountsJson = {};
  FIELDS.forEach((name, i) => {
    result[name] = counts.values[i];
  });
  if (counts.withheld.size > 0)
    result.withheld = FIELDS.filter((name) => counts.withheld.has(name));
  return result;
}

interface OfficeRow {
  state: string | null;
  name: string;
  code: string | null;
  // the total over the report's categories
  counts: Counts;
  // per category of the report (OfficeReport.categories), null where the
  // row has no numbers for it
  categories: (Counts | null)[];
}

interface OfficeReport {
  offices: OfficeRow[];
  // Every "Total" row found: the grand total at the top, and in FY2017-FY2020
  // reports also a subtotal at the end of the international offices section.
  totals: OfficeRow[];
  // The labels of the report's categories, without their footnote digits
  categories: string[];
}

/** The report's grand total, or null when no trustworthy one was found.
 *
 * The grand total is the largest total row; it is dropped when it comes out
 * smaller than the field offices it sums (a PDF whose digits split apart). */
function grandTotal(report: OfficeReport): OfficeRow | null {
  const receivedSum = report.offices.reduce(
    (sum, row) => sum + (row.counts.values[0] ?? 0),
    0,
  );
  let best: OfficeRow | null = null;
  for (const row of report.totals) {
    const received = row.counts.values[0] ?? 0;
    if (
      received >= 0.9 * receivedSum &&
      (best === null || received > (best.counts.values[0] ?? 0))
    )
      best = row;
  }
  return best;
}

/** One line of an all-forms report, for one fiscal quarter. */
interface FormRow {
  fiscalYear: number;
  fiscalQuarter: number;
  form: string;
  title: string;
  category: string | null;
  counts: Counts;
  processingTime: number | null;
}

// --- fetching -----------------------------------------------------------------

/** GET a web.archive.org URL, retrying on the archive's frequent 429/5xx
 * hiccups and resets; throws when every attempt failed. */
async function fetchWayback(
  url: string,
  options: {
    params?: Record<string, string>;
    timeoutMs?: number;
    redirect?: RequestRedirect;
  } = {},
): Promise<{ response: Response; body: Uint8Array }> {
  const fullUrl = withParams(url, options.params);
  for (let attempt = 0; attempt < WAYBACK_ATTEMPTS; attempt++) {
    let reason: string;
    try {
      const response = await get(fullUrl, {
        headers: USCIS_HEADERS,
        timeoutMs: options.timeoutMs ?? TIMEOUT_MS,
        redirect: options.redirect,
      });
      const body = new Uint8Array(await response.arrayBuffer());
      if (response.status === 200 || response.status === 302)
        return { response, body };
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

/** Newest HTTP 200 capture timestamp of every archived URL starting with
 * urlPrefix. */
async function waybackCaptures(
  urlPrefix: string,
): Promise<Map<string, string>> {
  // Not collapsed on urlkey: that keeps only each URL's *oldest* capture,
  // which would pin a report USCIS corrected in place to its first version.
  const { body } = await fetchWayback(CDX_URL, {
    params: {
      url: `${urlPrefix}*`,
      output: "json",
      fl: "timestamp,original",
      filter: "statuscode:200",
    },
    timeoutMs: CDX_TIMEOUT_MS,
  });
  let rows: string[][];
  try {
    rows = JSON.parse(new TextDecoder().decode(body)) as string[][];
  } catch {
    // an empty answer, or the archive's "Temporarily Offline" page, both
    // with HTTP 200; no captures at all is "[]"
    throw new Error(
      `the Wayback Machine's CDX index answered without JSON for ${urlPrefix}`,
    );
  }
  const captures = new Map<string, string>();
  for (const [timestamp, original] of rows.slice(1)) {
    const url = canonicalUrl(original);
    if (timestamp > (captures.get(url) ?? "")) captures.set(url, timestamp);
  }
  return captures;
}

/** The unmodified (`id_`) body of one Wayback capture. */
async function fetchCapture(
  timestamp: string,
  url: string,
): Promise<Uint8Array> {
  return (await fetchWayback(`${WAYBACK}/web/${timestamp}id_/${url}`)).body;
}

/** Ask the Wayback Machine to capture url right now; the new capture's
 * timestamp, or null. */
async function savePageNow(url: string): Promise<string | null> {
  console.log(`asking the Wayback Machine to capture ${url}`);
  let response: Response;
  try {
    ({ response } = await fetchWayback(`${WAYBACK}/save/${url}`, {
      timeoutMs: SAVE_TIMEOUT_MS,
      redirect: "manual",
    }));
  } catch (error) {
    console.log(`::warning::${errorMessage(error)}`);
    return null;
  }
  const match = /\/web\/(\d{14})/.exec(
    response.headers.get("Location") || response.url,
  );
  if (match === null) {
    console.log(`::warning::Save Page Now did not return a capture for ${url}`);
    return null;
  }
  return match[1];
}

function looksLike(ext: string, content: Uint8Array): boolean {
  if (ext === "xlsx") return content[0] === 0x50 && content[1] === 0x4b;
  if (ext === "pdf")
    return new TextDecoder().decode(content.subarray(0, 4)) === "%PDF";
  const text = new TextDecoder()
    .decode(content.subarray(0, 4000))
    .toLowerCase();
  return !text.includes("<html") && text.includes("received");
}

/** GET a www.uscis.gov URL directly; null when Akamai blocks us. */
async function fetchUscis(url: string): Promise<Uint8Array | null> {
  let response: Response;
  let body: Uint8Array;
  try {
    response = await get(url, { headers: USCIS_HEADERS });
    body = new Uint8Array(await response.arrayBuffer());
  } catch (error) {
    console.log(`uscis.gov request failed (${errorMessage(error)}): ${url}`);
    return null;
  }
  if (response.status !== 200) {
    console.log(`uscis.gov answered HTTP ${response.status}: ${url}`);
    return null;
  }
  return body;
}

async function downloadReport(
  report: Report,
  captures: Map<string, string>,
): Promise<Uint8Array> {
  const path = cachePath(report);
  if (existsSync(path)) return new Uint8Array(readFileSync(path));
  console.log(`downloading ${report.url}`);
  const ext = extOf(report);
  let content = await fetchUscis(report.url);
  if (content === null || !looksLike(ext, content)) {
    const timestamp =
      captures.get(report.url) ?? (await savePageNow(report.url));
    if (timestamp === null)
      throw new Error(
        `${report.url} is blocked and the Wayback Machine has no capture of it`,
      );
    content = await fetchCapture(timestamp, report.url);
  }
  if (!looksLike(ext, content))
    throw new Error(`${report.url} did not come back as a ${ext} file`);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
  return content;
}

// --- discovery ----------------------------------------------------------------

export function listingReports(html: string): Map<string, Report> {
  const reports = new Map<string, Report>();
  for (const link of findAll(
    parseHtml(html),
    (element) => element.tagName === "a" && attr(element, "href") !== undefined,
  )) {
    let href = attr(link, "href")!;
    if (href.startsWith("/")) href = USCIS + href;
    const report = reportFromUrl(href);
    if (report !== null) reports.set(report.url, report);
  }
  return reports;
}

const listingUrl = (family: ReportFamily) =>
  `${LISTING_URL}?query=${encodeURIComponent(family.listingQuery)}&items_per_page=100`;

/** Every report file found (see bestReports for the ones used) and the
 * Wayback captures of report files. */
async function discoverReports(): Promise<
  [Map<string, Report>, Map<string, string>]
> {
  const captures = new Map<string, string>();
  const prefixes = DOCUMENT_DIRS.flatMap((directory) =>
    Object.values(FAMILIES).flatMap((family) =>
      family.filePrefixes.map((prefix) => `https://${directory}${prefix}`),
    ),
  );
  for (const urlPrefix of prefixes) {
    try {
      for (const [url, timestamp] of await waybackCaptures(urlPrefix))
        captures.set(url, timestamp);
    } catch (error) {
      // The CDX index answers HTTP 503 for days at a time (late September
      // 2026). The cache holds every report used before, the listing page
      // finds new ones, and checkHistory fails the run if a quarter goes
      // missing, so carry on without the index; the other prefixes would
      // only fail the same way, after minutes of retries.
      console.log(
        `::warning::${errorMessage(error)}; going on without the Wayback Machine's index of report files`,
      );
      break;
    }
  }
  const reports = new Map<string, Report>();
  for (const url of captures.keys()) {
    const report = reportFromUrl(url);
    if (report !== null) reports.set(report.url, report);
  }
  console.log(`${reports.size} report files in the Wayback Machine's index`);

  for (const family of Object.values(FAMILIES)) {
    const url = listingUrl(family);
    const content = await fetchUscis(url);
    let html = content === null ? null : new TextDecoder().decode(content);
    if (html === null || listingReports(html).size === 0) {
      // The listing page is blocked too; have the archive fetch it for us so
      // newly published reports are discovered the same day.
      const timestamp = await savePageNow(url);
      html = timestamp
        ? new TextDecoder().decode(await fetchCapture(timestamp, url))
        : null;
    }
    const listed = html ? listingReports(html) : new Map<string, Report>();
    const fresh = [...listed.keys()].filter((key) => !reports.has(key)).length;
    console.log(
      `${repr(family.listingQuery)}: ${listed.size} report files listed, ${fresh} new`,
    );
    for (const [key, report] of listed) reports.set(key, report);
  }
  return [reports, captures];
}

// --- parsing helpers ----------------------------------------------------------

/** One cell: a count, 0 for "-" (represents zero), null for withheld ("D",
 * "H"), "N/A" and blanks.
 *
 * Since FY2024 some XLSX cells are fractions (USCIS apportions some counts
 * between categories, e.g. 59172.344 I-131 advance parole approvals): they
 * are rounded, not dropped. */
export function parseValue(raw: string): number | null {
  const text = strip(raw).replaceAll(",", "");
  if (text === "-") return 0;
  if (/^\d+(?:\.\d+)?$/.test(text)) return roundHalfEven(Number(text));
  return null;
}

/** Received, approved, denied and pending, or null when these cells are not
 * a data row.
 *
 * With dashPendingUnknown (the all-forms report), a pending "-" in a quarter
 * that received applications is unknown, not zero: USCIS puts "-" in the
 * pending column of forms it keeps no pile of (the I-870 and I-899
 * worksheets, the I-956G and I-956H), whose applications do not all get
 * decided in the quarter they come in. */
export function parseCounts(
  rawCells: string[],
  dashPendingUnknown = false,
): Counts | null {
  const cells = rawCells.map(strip);
  if (
    cells.length !== 4 ||
    !cells.some(Boolean) ||
    !cells.every((cell) => VALUE_TOKEN.test(cell))
  )
    return null;
  const [received, approved, denied, pending] = cells.map(parseValue);
  return {
    values: [
      received,
      approved,
      denied,
      dashPendingUnknown && cells[3] === "-" && received !== 0 ? null : pending,
    ],
    withheld: new Set(FIELDS.filter((_, i) => cells[i] === "D")),
  };
}

/** A processing time in months; 0 and N/A both mean USCIS did not publish
 * one. */
export function parseMonths(text: string): number | null {
  const value = strip(text).replaceAll(",", "");
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(value))
    return null;
  const months = Number(value);
  return months > 0 ? months : null;
}

const stateName = (text: string) =>
  STATES_BY_NORMALIZED_NAME.get(lettersOnly(text)) ?? null;

const isTotalLabel = (text: string) =>
  ["total", "grandtotal", "totalallforms"].includes(lettersOnly(text));

/** A header label without the footnote number glued to it ("Immediate Relative1"). */
const withoutFootnote = (label: string) => strip(label.replace(/\s*\d+$/, ""));

/** Some reports write their zeros with a Unicode hyphen or dash. */
export const normalizeDashes = (text: string) => text.replace(/[‐‑‒–—−]/g, "-");

/** The FY2020 Q2 I-130 PDF's text layer has every "x" replaced by "N/A"
 * ("TeN/Aas", "PhoeniN/A PHO", "MEN/A"); a real "N/A" stands on its own. */
export function restoreX(line: string): string {
  return line.replace(
    /(?<=[A-Za-z])N\/A|N\/A(?=[a-z])/g,
    (_, offset: number) => {
      const before = offset > 0 ? line[offset - 1] : "";
      return before !== "" &&
        before === before.toLowerCase() &&
        before !== before.toUpperCase()
        ? "x"
        : "X";
    },
  );
}

/** A CSV or XLSX report as rows of stripped cell strings. */
export function gridOf(ext: string, content: Uint8Array): string[][] {
  // The older CSVs are Windows-1252 ("Fiancé(e)" is the only non-ASCII text)
  const rows =
    ext === "csv" ? parseCsv(decodeText(content)) : xlsxRows(content);
  return rows.map((row) =>
    row.map((cell) => normalizeDashes(splitWords(cell).join(" "))),
  );
}

/** The text lines of a PDF, with the numbers its text layer split apart
 * ("1" ",925,486") joined back.
 *
 * The fragments of one number touch (no horizontal gap between them), while
 * words and columns are at least a couple of points apart. */
export async function pdfLines(content: Uint8Array): Promise<string[]> {
  const joinWords = (unsorted: Word[]) => {
    const words = [...unsorted].sort((a, b) => a.x0 - b.x0);
    let text = words[0].text;
    for (let i = 1; i < words.length; i++) {
      const touching = words[i].x0 - words[i - 1].x1 < 1;
      const numeric =
        DIGITS.test(words[i - 1].text) && DIGITS.test(words[i].text);
      text += (touching && numeric ? "" : " ") + words[i].text;
    }
    return text;
  };
  const lines: string[] = [];
  for (const pieces of await pdfPages(content)) {
    let line: Word[] = [];
    for (const word of plumberWords(pieces).sort((a, b) => a.top - b.top)) {
      if (line.length > 0 && word.top - line[0].top > 3) {
        lines.push(joinWords(line));
        line = [];
      }
      line.push(word);
    }
    if (line.length > 0) lines.push(joinWords(line));
  }
  return lines.map((line) => restoreX(normalizeDashes(strip(line))));
}

/** A value as a number, or as the [low, high] range a withheld/unavailable
 * one may be. */
function parseAddend(text: string): [number, number] {
  const value = parseValue(text);
  return value === null ? [0, 9] : [value, value];
}

/** Whether addends can add up to total, given that withheld ("D") values are
 * small. */
export function sumsTo(addends: string[], total: string): boolean {
  const value = parseValue(total);
  if (value === null) return true;
  const parsed = addends.map(parseAddend);
  const low = parsed.reduce((sum, [l]) => sum + l, 0);
  const high = parsed.reduce((sum, [, h]) => sum + h, 0);
  return low <= value && value <= high;
}

/** Whether, in one column (0 received ... 3 pending), a per-office row's
 * category groups add up to its total group. */
function columnSumsToTotal(
  values: string[],
  groups: number,
  column: number,
): boolean {
  return sumsTo(
    Array.from({ length: groups - 1 }, (_, g) => values[4 * g + column]),
    values[4 * (groups - 1) + column],
  );
}

/** A per-office row is consistent when, per column, the category groups add
 * up to the total group. */
const groupsSumToTotal = (values: string[], groups: number) =>
  [0, 1, 2, 3].every((column) => columnSumsToTotal(values, groups, column));

/** Undo the digit splitting of PDF text ("1 ,925,486", "3 3,077") given how
 * many values there must be.
 *
 * Adjacent tokens are merged wherever that is the only way to end up with
 * count well-formed values that pass the consistent check (the report's own
 * arithmetic); null when there is no way or more than one. */
export function rejoinNumbers(
  tokens: string[],
  count: number,
  consistent: (values: string[]) => boolean = () => true,
): string[] | null {
  const solutions = (tokens: string[], count: number): string[][] => {
    if (count === 0) return tokens.length === 0 ? [[]] : [];
    if (tokens.length === 0 || tokens.length < count) return [];
    const found: string[][] = [];
    for (let take = 1; take < tokens.length - count + 2; take++) {
      const value = tokens.slice(0, take).join("");
      if (
        VALUE_TOKEN.test(value) &&
        value &&
        !(take > 1 && !NUMBER.test(value))
      ) {
        for (const rest of solutions(tokens.slice(take), count - 1))
          found.push([value, ...rest]);
        if (found.length > 500) break;
      }
    }
    return found;
  };
  if (tokens.length === count && consistent(tokens)) return tokens;
  const found = solutions(tokens, count).filter(consistent);
  return found.length === 1 ? found[0] : null;
}

/** Whether the tokens are already exactly count well-formed values, which
 * is then the only way to read them: merging any two would leave too few. */
const unsplitTokens = (tokens: string[], count: number) =>
  tokens.length === count &&
  tokens.every((token) => token && VALUE_TOKEN.test(token));

// --- per-office reports -------------------------------------------------------

/** The label of each column group: the nearest cell above the "Received"
 * header row within the group's four columns ("Immediate Relative1",
 * "Total"). */
function groupLabels(
  grid: string[][],
  header: number,
  starts: number[],
): string[] {
  return starts.map((start) => {
    let label = "";
    for (const row of grid.slice(Math.max(0, header - 4), header).reverse()) {
      const cells = row.slice(start, start + 4).filter(Boolean);
      if (cells.length > 0) {
        label = cells[0];
        break;
      }
    }
    return withoutFootnote(label);
  });
}

/** Parse the CSV/XLSX layout: label columns, then per category (Received,
 * Approved, Denied, Pending), the last category being the total. */
export function parseOfficeGrid(grid: string[][]): OfficeReport {
  let header = -1;
  let starts: number[] = [];
  for (const [i, row] of grid.entries()) {
    const received = row.flatMap((cell, j) =>
      RECEIVED_HEADER.test(cell) ? [j] : [],
    );
    if (received.length >= 2) {
      header = i;
      starts = received;
      break;
    }
  }
  if (header === -1) throw new Error("no header row with 'Received' columns");
  const firstColumn = starts[0];
  const labels = groupLabels(grid, header, starts);
  if (!isTotalLabel(labels.at(-1)!))
    throw new Error(
      `the last column group is ${repr(labels.at(-1))}, not the total`,
    );

  const offices: OfficeRow[] = [];
  const totals: OfficeRow[] = [];
  let state: string | null = null;
  let serviceCenters = false;
  // the international offices (FY2017-FY2020), which are not USCIS field offices
  let international = false;
  for (const row of grid.slice(header + 1)) {
    const cells = [
      ...row,
      ...Array<string>(Math.max(0, starts.at(-1)! + 4 - row.length)).fill(""),
    ];
    const rowLabels = cells.slice(0, firstColumn);
    const code = rowLabels.find((cell) => OFFICE_CODE.test(cell)) ?? null;
    const names = rowLabels.filter((cell) => cell && cell !== code);
    if (names.length === 0) continue;
    const name = names.at(-1)!;
    const groups = starts.map((start) =>
      parseCounts(cells.slice(start, start + 4)),
    );
    const counts = groups.at(-1)!;
    if (counts === null) {
      // A heading: a state, a country in the international offices section,
      // "Service Centers", or a label like "Field Office by State". Only
      // checked on rows without counts, as the Washington field office (in
      // DC) shares its name with the state.
      if (rowLabels[0]) {
        state = stateName(name);
        serviceCenters = SERVICE_CENTER_HEADING.test(name);
        international =
          international || name.toLowerCase().includes("international");
      }
      continue;
    }
    const line: OfficeRow = {
      state,
      name,
      code,
      counts,
      categories: groups.slice(0, -1),
    };
    if (isTotalLabel(name)) {
      totals.push(line);
    } else if (code !== null) {
      offices.push(line);
    } else if (serviceCenters && !rowLabels[0]) {
      // FY2014-FY2015: the service centers by their state's name alone
      offices.push({ ...line, state: null, code: serviceCenterCode(name) });
    } else if (rowLabels[0] || state === null) {
      // No office code and either the name sits in the state column or it is
      // under a country heading: an international office (code "N/A" in
      // later reports) or a stray line, not a field office.
      if (rowLabels[0] && stateName(name) !== null) {
        state = stateName(name);
      } else if (
        !international &&
        !HEADING.test(name) &&
        counts.values.some(Boolean)
      ) {
        console.log(
          `::warning::skipped a row that is not a known office: ${repr(row)}`,
        );
      }
    } else {
      offices.push(line);
    }
  }
  return { offices, totals, categories: labels.slice(0, -1) };
}

/** Parse the PDF layout from its text layer: one office per line, followed
 * by its counts per category. */
export function parseOfficeLines(
  lines: string[],
  family: ReportFamily,
): OfficeReport {
  const groups = groupsOf(family);
  const count = 4 * groups;
  const offices: OfficeRow[] = [];
  const totals: OfficeRow[] = [];
  let state: string | null = null;
  let serviceCenters = false;

  const valuesOf = (line: string, text: string): (Counts | null)[] | null => {
    // Digits often come out split ("1 94,819"); the per-category counts must
    // add up to the total ones, which settles most of the ambiguity.
    const tokens = splitWords(text);
    let values = rejoinNumbers(tokens, count, (values) =>
      groupsSumToTotal(values, groups),
    );
    if (values === null && unsplitTokens(tokens, count)) {
      // Nothing to rejoin, but the categories do not add up to the total: a
      // mistake in USCIS's arithmetic, or a withheld ("D") count larger than
      // usual. Kept when only one column is off.
      const off = [0, 1, 2, 3].filter(
        (column) => !columnSumsToTotal(tokens, groups, column),
      );
      if (off.length === 1) {
        console.log(
          `::warning::the categories' ${FIELDS[off[0]]} do not add up to the total in ${repr(line)}; kept as published`,
        );
        values = tokens;
      }
    }
    if (values === null) return null;
    return Array.from({ length: groups }, (_, g) =>
      parseCounts(values.slice(4 * g, 4 * g + 4)),
    );
  };

  for (const line of lines) {
    let match: RegExpExecArray | null;
    let known: string | null;
    if ((match = PDF_TOTAL_LINE.exec(line)) !== null) {
      const parsed = valuesOf(line, match.groups!.values);
      const total = parsed?.at(-1) ?? null;
      if (parsed !== null && total !== null) {
        totals.push({
          state: null,
          name: "Total",
          code: null,
          counts: total,
          categories: parsed.slice(0, -1),
        });
      }
    } else if ((match = PDF_OFFICE_LINE.exec(line)) !== null) {
      const parsed = valuesOf(line, match.groups!.values);
      const counts = parsed?.at(-1) ?? null;
      if (parsed !== null && counts !== null) {
        offices.push({
          state,
          name: match.groups!.name,
          code: match.groups!.code,
          counts,
          categories: parsed.slice(0, -1),
        });
      } else {
        console.log(`::warning::cannot read the numbers of ${repr(line)}`);
      }
    } else if (
      (match = PDF_CODELESS_OFFICE_LINE.exec(line)) !== null &&
      (serviceCenters || state !== null)
    ) {
      // Reports before FY2017: offices without codes, and service centers by
      // their state's name alone (checked before the state headings, as
      // "California 224 25,046 ..." would read as one)
      const parsed = valuesOf(line, match.groups!.values);
      const counts = parsed?.at(-1) ?? null;
      if (parsed !== null && counts !== null) {
        const name = match.groups!.name;
        offices.push(
          serviceCenters
            ? {
                state: null,
                name,
                code: serviceCenterCode(name),
                counts,
                categories: parsed.slice(0, -1),
              }
            : {
                state,
                name,
                code: null,
                counts,
                categories: parsed.slice(0, -1),
              },
        );
      } else {
        console.log(`::warning::cannot read the numbers of ${repr(line)}`);
      }
    } else if ((known = stateName(line)) !== null) {
      state = known;
      serviceCenters = false;
    } else if (/^[A-Za-z][A-Za-z .'&-]+$/.test(line)) {
      // a heading that is not a state: a country in the international
      // offices section, or "Service Center"
      state = null;
      serviceCenters = SERVICE_CENTER_HEADING.test(line);
    } else if (PDF_UNREAD_OFFICE_LINE.test(line)) {
      console.log(
        `::warning::skipped a line that looks like an office: ${repr(line)}`,
      );
    }
  }
  return { offices, totals, categories: [...family.categories] };
}

async function parseOfficeReport(
  report: Report,
  content: Uint8Array,
): Promise<OfficeReport> {
  const family = FAMILIES[report.family];
  const ext = extOf(report);
  const parsed =
    ext === "pdf"
      ? parseOfficeLines(await pdfLines(content), family)
      : parseOfficeGrid(gridOf(ext, content));
  if (parsed.offices.length < family.minRows) {
    throw new Error(
      `only ${parsed.offices.length} offices parsed from ${report.url}; the layout must have changed`,
    );
  }
  if (parsed.categories.length !== groupsOf(family) - 1) {
    console.log(
      `::warning::${report.url} has the categories ${repr(parsed.categories)}, expected ${repr(family.categories)}`,
    );
  }
  // The offices should add up to the report's own total: they do not when
  // rows were skipped, or in USCIS's own defective reports (the scrambled
  // FY2017 Q1 service center rows).
  const total = grandTotal(parsed);
  if (total !== null) {
    for (const index of [0, 3]) {
      const expected = total.counts.values[index];
      const summed = parsed.offices.reduce(
        (sum, row) => sum + (row.counts.values[index] ?? 0),
        0,
      );
      if (expected && Math.abs(summed - expected) > 0.1 * expected) {
        console.log(
          `::warning::${report.url}: the offices' ${FIELDS[index]} add up to ${formatCount(summed)}, the report's total is ${formatCount(expected)}`,
        );
      }
    }
  }
  return parsed;
}

// --- the all-forms report -----------------------------------------------------

interface ColumnGroup {
  fiscalQuarter: number;
  received: number;
  approved: number;
  denied: number;
  pending: number;
  processingTime: number | null;
}

/** The form number, with a footnote digit glued to "I-90" taken off: FY2016
 * Q1 lists I-90 with footnote 8 as "I-908". */
function formNumber(form: string, title: string): string {
  if (
    /^I-90\d$/.test(form) &&
    title.toLowerCase().includes("permanent resident card")
  )
    return "I-90";
  return form;
}

/** The column groups of an all-forms CSV/XLSX and the index of the first
 * data row.
 *
 * Until FY2019 Q2 a report had one group per quarter of the fiscal year so
 * far (and a year-to-date group); since then it has the quarter and
 * year-to-date. */
function allFormsGroups(
  grid: string[][],
  report: Report,
): [ColumnGroup[], number] {
  // the column header row always has "Pending"; the rows above it hold the
  // group labels ("2nd Quarter") and split words ("Forms" / "Received")
  const headerEnd = grid.findIndex((row) =>
    row.some((cell) => cell.toLowerCase().includes("pending")),
  );
  if (headerEnd === -1)
    throw new Error("no header row with a 'Pending' column");
  const headerRows = grid.slice(Math.max(0, headerEnd - 3), headerEnd + 1);
  const width = Math.max(...headerRows.map((row) => row.length));
  const labels = Array.from({ length: width }, (_, i) =>
    headerRows
      .filter((row) => i < row.length && row[i])
      .map((row) => row[i].toLowerCase())
      .join(" "),
  );
  const starts = labels.flatMap((label, i) =>
    RECEIVED_HEADER.test(label) ? [i] : [],
  );
  // the cumulative layout has a group per quarter plus year-to-date, the
  // single-quarter one just the quarter and year-to-date
  const cumulative = starts.length >= 3;
  const groups: ColumnGroup[] = [];
  for (const [index, start] of (cumulative
    ? starts.slice(0, 4)
    : starts.slice(0, 1)
  ).entries()) {
    const fiscalQuarter = cumulative ? index + 1 : report.fiscalQuarter;
    if (fiscalQuarter > report.fiscalQuarter) break;
    const pending = [start + 3, start + 4, start + 5].find((i) =>
      labels[i].includes("pending"),
    );
    if (pending === undefined)
      throw new Error(`no 'Pending' column after column ${start}`);
    const processingTime =
      [start + 3, start + 4, start + 5, start + 6].find(
        (i) => i < width && labels[i].includes("time"),
      ) ?? null;
    groups.push({
      fiscalQuarter,
      received: start,
      approved: start + 1,
      denied: start + 2,
      pending,
      processingTime,
    });
  }
  return [groups, headerEnd + 1];
}

export function parseAllFormsGrid(report: Report, grid: string[][]): FormRow[] {
  const [groups, firstDataRow] = allFormsGroups(grid, report);
  const firstColumn = groups[0].received;
  const width = Math.max(...groups.map((group) => group.pending)) + 3;
  const rows: FormRow[] = [];
  let category: string | null = null;
  for (const row of grid.slice(firstDataRow)) {
    const cells = [
      ...row,
      ...Array<string>(Math.max(0, width - row.length)).fill(""),
    ];
    const labels = cells.slice(0, firstColumn).filter(Boolean);
    if (labels.length === 0) continue;
    // a form row is "I-130, title" or "Family Based, I-130, title"; a
    // category heading is a lone label without counts
    const formIndex = labels.findIndex((cell) => FORM_KEY.test(cell));
    const hasValues = cells.slice(firstColumn).some(Boolean);
    if (formIndex === -1) {
      if (!hasValues && !isTotalLabel(labels[0])) category = labels[0];
      continue;
    }
    const formMatch = FORM_KEY.exec(labels[formIndex])!;
    if (formIndex > 0) category = labels[0];
    if (category !== null && SKIPPED_CATEGORIES.has(category)) continue;
    const title = labels.length > formIndex + 1 ? labels[formIndex + 1] : "";
    for (const group of groups) {
      const counts = parseCounts(
        [
          cells[group.received],
          cells[group.approved],
          cells[group.denied],
          cells[group.pending],
        ],
        true,
      );
      if (counts === null) continue;
      rows.push({
        fiscalYear: report.fiscalYear,
        fiscalQuarter: group.fiscalQuarter,
        form: formNumber(formMatch.groups!.form, title),
        title,
        category,
        counts,
        processingTime:
          group.processingTime === null
            ? null
            : parseMonths(cells[group.processingTime]),
      });
    }
  }
  return rows;
}

/** The PDF layouts (FY2019 Q3 - FY2021 Q3), digits often split by spaces.
 *
 * Until FY2020 a report had cumulative fiscal-year columns (four per quarter
 * so far, then year-to-date received and approved); from FY2021 it has the
 * quarter (received, approved, denied, completions, pending, processing
 * time) and, after the first quarter, the year-to-date (the same without
 * processing time). */
export function parseAllFormsLines(report: Report, lines: string[]): FormRow[] {
  const cumulative = !lines
    .slice(0, 8)
    .some((line) => line.toLowerCase().includes("processing time"));
  const quarters = report.fiscalQuarter;
  const valueCount = cumulative ? 4 * quarters + 2 : quarters === 1 ? 6 : 11;

  const consistent = (values: string[]): boolean => {
    if (cumulative) {
      // the year-to-date received and approved are the sums of the quarters'
      return [0, 1].every((c) =>
        sumsTo(
          Array.from({ length: quarters }, (_, q) => values[4 * q + c]),
          values[4 * quarters + c],
        ),
      );
    }
    const [received, approved, denied, completions] = values
      .slice(0, 4)
      .map(parseValue);
    if (
      approved !== null &&
      denied !== null &&
      completions !== null &&
      completions < approved + denied
    )
      return false;
    if (quarters === 1) return true;
    // the year-to-date received is at least the quarter's
    const yearToDate = parseValue(values[6]);
    return received === null || yearToDate === null || yearToDate >= received;
  };

  const rows: FormRow[] = [];
  let category: string | null = null;
  for (const line of lines) {
    const match = PDF_FORM_LINE.exec(line);
    if (match === null) {
      if (
        /^[A-Za-z][A-Za-z &/]+$/.test(line) &&
        !line.toLowerCase().startsWith("total")
      )
        category = line;
      continue;
    }
    if (category !== null && SKIPPED_CATEGORIES.has(category)) continue;
    const words = splitWords(match.groups!.rest);
    // the title is everything up to the first run of value-like tokens that reaches the end
    let split = words.length;
    while (split > 0 && NUMBER_FRAGMENT.test(words[split - 1])) split--;
    const title = words.slice(0, split).join(" ");
    const form = formNumber(match.groups!.form, title);
    const tokens = words.slice(split);
    let values = rejoinNumbers(tokens, valueCount, consistent);
    if (values === null && !cumulative && tokens.length === valueCount - 1) {
      // a blank processing time
      values = rejoinNumbers(
        [...tokens.slice(0, 5), "N/A", ...tokens.slice(5)],
        valueCount,
        consistent,
      );
    }
    if (values === null && cumulative && unsplitTokens(tokens, valueCount)) {
      // Nothing to rejoin, but USCIS's year-to-date received or approved is
      // not the sum of its quarters: kept when only one of the two is off.
      const off = [0, 1]
        .filter(
          (c) =>
            !sumsTo(
              Array.from({ length: quarters }, (_, q) => tokens[4 * q + c]),
              tokens[4 * quarters + c],
            ),
        )
        .map((c) => FIELDS[c]);
      if (off.length === 1) {
        console.log(
          `::warning::FY${report.fiscalYear} Q${report.fiscalQuarter}: the quarters' ${off[0]} of ${form} ${repr(title)} do not add up to the year to date; kept as published`,
        );
        values = tokens;
      }
    }
    if (values === null) {
      console.log(
        `::warning::FY${report.fiscalYear} Q${report.fiscalQuarter}: cannot read the numbers of ${form} ${repr(title)}: ${tokens.join(" ")}`,
      );
      continue;
    }
    if (!cumulative) {
      const counts = parseCounts(
        [values[0], values[1], values[2], values[4]],
        true,
      );
      if (counts !== null) {
        rows.push({
          fiscalYear: report.fiscalYear,
          fiscalQuarter: quarters,
          form,
          title,
          category,
          counts,
          processingTime: parseMonths(values[5]),
        });
      }
      continue;
    }
    for (let quarter = 1; quarter <= quarters; quarter++) {
      const counts = parseCounts(
        values.slice(4 * (quarter - 1), 4 * quarter),
        true,
      );
      if (counts !== null) {
        rows.push({
          fiscalYear: report.fiscalYear,
          fiscalQuarter: quarter,
          form,
          title,
          category,
          counts,
          processingTime: null,
        });
      }
    }
  }
  return rows;
}

async function parseAllFormsReport(
  report: Report,
  content: Uint8Array,
): Promise<FormRow[]> {
  const ext = extOf(report);
  const rows =
    ext === "pdf"
      ? parseAllFormsLines(report, await pdfLines(content))
      : parseAllFormsGrid(report, gridOf(ext, content));
  const current = rows.filter(
    (row) => row.fiscalQuarter === report.fiscalQuarter,
  );
  if (current.length < FAMILIES.all_forms.minRows) {
    throw new Error(
      `only ${current.length} form rows parsed from ${report.url}; the layout must have changed`,
    );
  }
  return rows;
}

// --- assembly -----------------------------------------------------------------

function normalizeName(text: string): string {
  return strip(
    text
      .toLowerCase()
      .replace(/[^a-z ]/g, "")
      .replace(/\b(saint|st)\b/g, "st")
      .replace(/\b(fort|ft)\b/g, "ft")
      .replace(/\s+/g, " "),
  );
}

export const slugify = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

type CountsTotal = Record<Field, number | null> & { withheld?: Field[] };

/** Per field, the sum of the rows that have it, or null when none does
 * (withheld when some row withheld it as too small to disclose). */
function sumCounts(rows: Counts[]): CountsTotal {
  const result = {} as CountsTotal;
  const withheld: Field[] = [];
  FIELDS.forEach((name, i) => {
    const values = rows
      .map((row) => row.values[i])
      .filter((value) => value !== null);
    result[name] =
      values.length > 0 ? values.reduce((sum, value) => sum + value, 0) : null;
    if (values.length === 0 && rows.some((row) => row.withheld.has(name)))
      withheld.push(name);
  });
  if (withheld.length > 0) result.withheld = withheld;
  return result;
}

/** The title without its trailing category, e.g. "(Immediate Relative)";
 * "Fiancé(e)" is not one. */
const baseTitle = (title: string) =>
  title.replace(/\s+\([^()]*(?:\([^()]*\)[^()]*)*\)\s*$/, "") || title;

const normalizeTitle = (title: string) =>
  strip(title.replace(/\s+/g, " ")).toLowerCase();

const NORMALIZED_VARIANT_KEYS = new Map(
  Object.entries(VARIANT_KEYS).map(([form, keys]) => [
    form,
    new Map(
      Object.entries(keys).map(([title, key]) => [normalizeTitle(title), key]),
    ),
  ]),
);

/** A stable key for each category row of a form in one quarter (see
 * VARIANT_KEYS). */
function variantKeys(form: string, titles: string[]): string[] {
  const known = NORMALIZED_VARIANT_KEYS.get(form) ?? new Map<string, string>();
  const keys: string[] = [];
  for (const title of titles) {
    let key = known.get(normalizeTitle(title));
    if (key === undefined) {
      if (titles.length === 1) {
        key = "all";
      } else {
        const category = /\s\(([^()]*(?:\([^()]*\)[^()]*)*)\)\s*$/.exec(title);
        key = slugify(category ? category[1] : title);
        console.log(
          `::warning::${form}: no category key for ${repr(title)}, so ${repr(key)}; add it to VARIANT_KEYS to keep the category's history joined across USCIS's renames`,
        );
      }
    }
    if (keys.includes(key)) {
      const unique = `${key}-${slugify(title)}`;
      console.log(
        `::warning::${form}: two rows of one quarter have the category key ${repr(key)}; ${repr(title)} gets ${repr(unique)}`,
      );
      key = unique;
    }
    keys.push(key);
  }
  return keys;
}

function officeCategoryKey(form: string, label: string): string {
  const found = OFFICE_CATEGORY_KEYS.find(
    ([keyForm, word]) => keyForm === form && label.toLowerCase().includes(word),
  );
  if (found !== undefined) return found[2];
  const key = slugify(label);
  console.log(
    `::warning::${form}: no category key for the per-office category ${repr(label)}, so ${repr(key)}; add it to OFFICE_CATEGORY_KEYS`,
  );
  return key;
}

type Quarter = CountsJson & { categories?: Record<string, CountsJson> };

/** An office's (or the report total's) counts, with its categories' when the
 * report has several. */
function officeQuarter(row: OfficeRow, keys: string[]): Quarter {
  const quarter: Quarter = countsJson(row.counts);
  if (keys.length > 1) {
    quarter.categories = {};
    keys.forEach((key, i) => {
      const counts = row.categories[i];
      if (counts !== null && counts !== undefined)
        quarter.categories![key] = countsJson(counts);
    });
  }
  return quarter;
}

interface Office {
  code: string;
  name: string;
  state: string | null;
  stateCode: string | null;
  slug: string;
  quarters: Record<string, Quarter>;
}

/** One form's office pages, its per-quarter totals, the report each quarter
 * came from and the reports' categories. */
function buildOffices(
  family: ReportFamily,
  reports: [Report, OfficeReport][],
): [
  Office[],
  Record<string, Quarter>,
  Record<string, string>,
  { key: string; label: string }[],
] {
  const form = family.form!;
  // Reports before FY2017 name the offices without their codes; resolve those
  // names against every report that has both, most specific match first.
  const codesByName = new Map<string, string>();
  const nameKey = (state: string | null, name: string) =>
    JSON.stringify([state, normalizeName(name)]);
  for (const [, parsed] of reports) {
    for (const row of parsed.offices) {
      if (row.code === null) continue;
      for (const key of [
        nameKey(row.state, row.name),
        nameKey(null, row.name),
      ]) {
        if (!codesByName.has(key)) codesByName.set(key, row.code);
      }
    }
  }

  const offices = new Map<string, Office>();
  const totals: Record<string, Quarter> = {};
  const sources: Record<string, string> = {};
  // key -> label, the newest report's
  const categories = new Map<string, string>();
  for (const [report, parsed] of reports) {
    const [quarter] = calendarQuarter(report.fiscalYear, report.fiscalQuarter);
    let labels = parsed.categories;
    let keys = labels.map((label) => officeCategoryKey(form, label));
    if (new Set(keys).size !== keys.length) {
      // the quarter's totals are still good: only its categories go
      console.log(
        `::warning::${report.url}: the categories ${repr(labels)} are not told apart; left out`,
      );
      keys = [];
      labels = [];
    }
    keys.forEach((key, i) => {
      categories.delete(key);
      categories.set(key, labels[i]);
    });
    const rows: OfficeRow[] = [];
    for (const row of parsed.offices) {
      const code =
        row.code ??
        codesByName.get(nameKey(row.state, row.name)) ??
        codesByName.get(nameKey(null, row.name)) ??
        null;
      if (code === null) {
        console.log(
          `::warning::${report.family} ${quarter}: no office code known for ${repr(row.name)} (${row.state}); skipped`,
        );
        continue;
      }
      rows.push(row);
      // The newest report a code appears in names it; reports are in chronological order.
      if (!offices.has(code)) {
        offices.set(code, {
          code,
          name: "",
          state: null,
          stateCode: null,
          slug: "",
          quarters: {},
        });
      }
      const office = offices.get(code)!;
      office.name = Object.hasOwn(NAME_FIXES, code)
        ? NAME_FIXES[code]
        : row.name;
      office.state = row.state;
      office.quarters[quarter] = officeQuarter(row, keys);
    }
    const total = grandTotal(parsed);
    if (total !== null) {
      totals[quarter] = officeQuarter(total, keys);
    } else {
      totals[quarter] = sumCounts(rows.map((row) => row.counts));
      if (keys.length > 1) {
        totals[quarter].categories = Object.fromEntries(
          keys.map((key, i) => [
            key,
            sumCounts(
              rows.flatMap((row) =>
                row.categories[i] ? [row.categories[i]] : [],
              ),
            ),
          ]),
        );
      }
    }
    sources[quarter] = report.url;
  }

  for (const office of offices.values()) {
    const stateCode = office.state ? (STATES[office.state] ?? null) : null;
    office.stateCode = stateCode;
    office.slug = slugify(`${office.name} ${stateCode ?? ""}`);
  }
  const slugs = [...offices.values()].map((office) => office.slug);
  if (new Set(slugs).size !== slugs.length) {
    const duplicates = [
      ...new Set(
        slugs.filter((slug) => slugs.indexOf(slug) !== slugs.lastIndexOf(slug)),
      ),
    ].sort();
    throw new Error(`duplicate office slugs: ${repr(duplicates)}`);
  }
  return [
    [...offices.values()].sort((a, b) =>
      a.code < b.code ? -1 : a.code > b.code ? 1 : 0,
    ),
    totals,
    sources,
    [...categories].map(([key, label]) => ({ key, label })),
  ];
}

interface Variant extends CountsJson {
  key: string;
  title: string;
  processingTime: number | null;
}

type NationalQuarter = CountsTotal & { variants: Variant[] };

interface FormEntry {
  form: string;
  slug: string;
  title?: string;
  category?: string | null;
  quarters: Record<string, NationalQuarter>;
  sources: Record<string, string>;
  offices?: Office[];
  officeTotals?: Record<string, Quarter>;
  officeSources?: Record<string, string>;
  officeCategories?: { key: string; label: string }[];
}

export interface Dataset {
  periods: {
    quarter: string;
    start: string;
    end: string;
    fiscalYear: number;
    fiscalQuarter: number;
  }[];
  republishedMedianQuarters: string[];
  forms: Required<FormEntry>[];
}

/** Warn when the all-forms report's pending count for a form is far from its
 * per-office report's total: one of the two was misread (FY2024's fractional
 * cells made the national I-485 count a third too low). */
function checkNationalVsOffices(entry: FormEntry): void {
  for (const quarter of Object.keys(entry.officeTotals ?? {}).sort()) {
    const national = entry.quarters[quarter]?.pending;
    const offices = entry.officeTotals![quarter].pending;
    if (
      national &&
      offices &&
      Math.abs(national / offices - 1) > NATIONAL_VS_OFFICES_TOLERANCE
    ) {
      console.log(
        `::warning::${entry.form} ${quarter}: ${formatCount(national)} pending nationwide in the all-forms report, ${formatCount(offices)} in the per-office report`,
      );
    }
  }
}

// Of the series (form categories) with a median in both a quarter and the
// one before, at least this share repeating the one before to the last digit
// means the report published the quarter before's medians again: the FY2024
// Q3 report (April-June 2024) repeated 37 of 44, against at most 4 of 38 in
// any other quarter since FY2021.
const REPUBLISHED_MEDIAN_SHARE = 0.5;
const REPUBLISHED_MEDIAN_MIN_SERIES = 10;

/** Drop the medians of a quarter whose report repeats the quarter before's
 * (REPUBLISHED_MEDIAN_SHARE): they say nothing about that quarter. Returns
 * those quarters, which forms.json lists, so that the pages can say why
 * they have no medians for them. */
function dropRepublishedMedians(forms: Map<string, FormEntry>): string[] {
  const quarters = [
    ...new Set(
      [...forms.values()].flatMap((entry) => Object.keys(entry.quarters)),
    ),
  ].sort();
  const republished: string[] = [];
  for (let i = 1; i < quarters.length; i++) {
    const [previous, quarter] = [quarters[i - 1], quarters[i]];
    let same = 0;
    let compared = 0;
    for (const entry of forms.values()) {
      const before = new Map(
        (entry.quarters[previous]?.variants ?? []).map((variant) => [
          variant.key,
          variant.processingTime,
        ]),
      );
      for (const variant of entry.quarters[quarter]?.variants ?? []) {
        const earlier = before.get(variant.key);
        if (
          variant.processingTime === null ||
          earlier === null ||
          earlier === undefined
        )
          continue;
        compared++;
        if (variant.processingTime === earlier) same++;
      }
    }
    if (
      compared >= REPUBLISHED_MEDIAN_MIN_SERIES &&
      same >= REPUBLISHED_MEDIAN_SHARE * compared
    ) {
      republished.push(quarter);
    }
  }
  for (const quarter of republished) {
    console.log(
      `::warning::the ${quarter} all-forms report repeats the quarter before's medians; not using them`,
    );
    for (const entry of forms.values()) {
      for (const variant of entry.quarters[quarter]?.variants ?? [])
        variant.processingTime = null;
    }
  }
  return republished;
}

export function buildDataset(
  allForms: [Report, FormRow[]][],
  officeReports: Map<string, [Report, OfficeReport][]>,
): Dataset {
  // Newer reports restate earlier quarters (the cumulative layout, and
  // post-adjudicative corrections); the newest report wins for each quarter.
  const rowsByQuarter = new Map<
    string,
    { form: string; fiscal: [number, number]; rows: FormRow[]; source: string }
  >();
  for (const [report, rows] of allForms) {
    for (const row of rows) {
      const key = JSON.stringify([row.form, row.fiscalYear, row.fiscalQuarter]);
      const existing = rowsByQuarter.get(key);
      if (existing === undefined || existing.source !== report.url) {
        // a key keeps its place in the order when a newer report replaces it
        rowsByQuarter.set(key, {
          form: row.form,
          fiscal: [row.fiscalYear, row.fiscalQuarter],
          rows: [],
          source: report.url,
        });
      }
      rowsByQuarter.get(key)!.rows.push(row);
    }
  }

  const forms = new Map<string, FormEntry>();
  const ordered = [...rowsByQuarter.values()].sort((a, b) =>
    compareKeys(a.fiscal, b.fiscal),
  );
  for (const { form, fiscal, rows, source } of ordered) {
    const [quarter] = calendarQuarter(...fiscal);
    if (!forms.has(form))
      forms.set(form, { form, slug: slugify(form), quarters: {}, sources: {} });
    const entry = forms.get(form)!;
    const keys = variantKeys(
      form,
      rows.map((row) => row.title),
    );
    entry.quarters[quarter] = {
      ...sumCounts(rows.map((row) => row.counts)),
      variants: rows.map((row, i) => ({
        key: keys[i],
        title: row.title,
        ...countsJson(row.counts),
        processingTime: row.processingTime,
      })),
    };
    entry.sources[quarter] = source;
    // the newest report names and categorizes the form
    let main = rows[0];
    for (const row of rows)
      if ((row.counts.values[0] ?? 0) > (main.counts.values[0] ?? 0))
        main = row;
    entry.title = Object.hasOwn(FORM_TITLES, form)
      ? FORM_TITLES[form]
      : baseTitle(main.title);
    entry.category = main.category;
  }
  const republished = dropRepublishedMedians(forms);

  for (const [familyName, reports] of officeReports) {
    const family = FAMILIES[familyName];
    const form = family.form!;
    const [offices, totals, sources, categories] = buildOffices(
      family,
      reports,
    );
    if (!forms.has(form))
      forms.set(form, { form, slug: slugify(form), quarters: {}, sources: {} });
    const entry = forms.get(form)!;
    entry.offices = offices;
    entry.officeTotals = totals;
    entry.officeSources = sources;
    entry.officeCategories = categories;
    checkNationalVsOffices(entry);
  }
  for (const entry of forms.values()) {
    entry.offices ??= [];
    entry.officeTotals ??= {};
    entry.officeSources ??= {};
    entry.officeCategories ??= [];
    entry.title ??= entry.form;
    entry.category ??= null;
  }
  const entries = [...forms.values()] as Required<FormEntry>[];

  // A form that drops out of the newest report stops having a page; say so,
  // as a misread form number ("I-908" for I-90) would look just like it.
  const nationalQuarters = [
    ...new Set(entries.flatMap((entry) => Object.keys(entry.quarters))),
  ].sort();
  const [previous, newest] = [null, null, ...nationalQuarters].slice(-2);
  const has = (entry: FormEntry, quarter: string | null) =>
    quarter !== null && Object.hasOwn(entry.quarters, quarter);
  const gone = entries
    .filter((entry) => has(entry, previous) && !has(entry, newest))
    .map((entry) => entry.form)
    .sort();
  const added = entries
    .filter((entry) => has(entry, newest) && !has(entry, previous))
    .map((entry) => entry.form)
    .sort();
  if (gone.length > 0) {
    console.log(
      `::warning::${gone.join(", ")} in the ${previous} report but not in the ${newest} one (new in it: ${added.join(", ") || "none"})`,
    );
  }

  const quarters = [
    ...new Set(
      entries.flatMap((entry) => [
        ...Object.keys(entry.quarters),
        ...Object.keys(entry.officeTotals),
      ]),
    ),
  ].sort();
  const periods = quarters.map((quarter) => {
    const [year, q] = quarter.split("-Q").map(Number);
    const [fiscalYear, fiscalQuarter] = q === 4 ? [year + 1, 1] : [year, q + 1];
    const [key, start, end] = calendarQuarter(fiscalYear, fiscalQuarter);
    if (key !== quarter)
      throw new Error(`the quarter ${quarter} came out as ${key}`);
    return {
      quarter,
      start: isoDate(start),
      end: isoDate(end),
      fiscalYear,
      fiscalQuarter,
    };
  });
  return {
    periods,
    // the quarters whose medians dropRepublishedMedians dropped
    republishedMedianQuarters: republished,
    forms: entries.sort((a, b) =>
      a.form < b.form ? -1 : a.form > b.form ? 1 : 0,
    ),
  };
}

function filesUnder(directory: string): string[] {
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { recursive: true, encoding: "utf8" })
    .map((name) => join(directory, name))
    .filter((path) => statSync(path).isFile());
}

/** Every report file in the cache. */
function cachedReports(): Map<string, Report> {
  const reports = new Map<string, Report>();
  for (const path of filesUnder(REPORTS_DIR)) {
    const report = reportFromUrl(
      `${USCIS}/${relative(REPORTS_DIR, path).split(sep).join("/")}`,
    );
    if (report !== null) reports.set(report.url, report);
  }
  return reports;
}

const readDataset = () =>
  JSON.parse(readFileSync(OUTPUT_PATH, "utf8")) as Dataset;

/** The URLs of the reports forms.json was built from. */
const citedUrls = (dataset: Dataset) => [
  ...new Set(
    dataset.forms.flatMap((form) => [
      ...Object.values(form.sources),
      ...Object.values(form.officeSources),
    ]),
  ),
];

/** The reports forms.json was built from. Discovery finds them through the
 * Wayback Machine's index, and the cache usually holds them, but with the
 * index down and a cache that lacks some (one restored from before a report
 * was added), they would be missed. */
function citedReports(): Map<string, Report> {
  const reports = new Map<string, Report>();
  if (!existsSync(OUTPUT_PATH)) return reports;
  for (const url of citedUrls(readDataset())) {
    const report = reportFromUrl(url);
    if (report !== null) reports.set(report.url, report);
  }
  return reports;
}

/** Fail when the new dataset lost a quarter of a form the previous one had:
 * the Wayback Machine's CDX index sometimes answers a query with only some
 * of the files it has (on one run, none of FY2014-FY2016's all-forms
 * reports), and USCIS does not withdraw published quarters. A form gone
 * altogether is only warned about, as a misread form number ("I-908") goes
 * that way when the parser is fixed. */
export function checkHistory(previous: Dataset, dataset: Dataset): void {
  const fresh = new Map(dataset.forms.map((form) => [form.form, form]));
  const lost: string[] = [];
  for (const form of previous.forms) {
    const now = fresh.get(form.form);
    if (now === undefined) {
      console.log(`::warning::${form.form} is no longer in forms.json`);
      continue;
    }
    for (const field of ["quarters", "officeTotals"] as const) {
      const missing = Object.keys(form[field])
        .filter((quarter) => !Object.hasOwn(now[field], quarter))
        .sort();
      if (missing.length > 0)
        lost.push(`${form.form} ${field} ${missing.join(", ")}`);
    }
  }
  if (lost.length > 0) {
    throw new Error(
      `quarters forms.json had are missing, so a report was not found: ${lost.join("; ")}`,
    );
  }
}

/** Whether USCIS may have published a quarter newer than forms.json's newest. */
export function newQuarterDue(today: Date, dataset: Dataset): boolean {
  const newest = dataset.periods.at(-1)!;
  let [fiscalYear, fiscalQuarter] = [
    newest.fiscalYear,
    newest.fiscalQuarter + 1,
  ];
  if (fiscalQuarter > 4) [fiscalYear, fiscalQuarter] = [fiscalYear + 1, 1];
  const [, , end] = calendarQuarter(fiscalYear, fiscalQuarter);
  return (
    isoDate(today) >=
    isoDate(new Date(end.getTime() + EARLIEST_PUBLICATION_DAYS * 86_400_000))
  );
}

/** Whether reports/ holds every report forms.json was built from. */
function cacheIsComplete(): boolean {
  return citedUrls(readDataset()).every((url) => {
    const report = reportFromUrl(url);
    return report !== null && existsSync(cachePath(report));
  });
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, sortKeys((value as Record<string, unknown>)[key])]),
    );
  }
  return value;
}

/** forms.json as the repository's formatter keeps it: keys sorted, indented,
 * but with a short list of strings on one line. */
export function toJson(dataset: unknown): string {
  const text = JSON.stringify(sortKeys(dataset), null, 2);
  return text.replace(
    /^(?<head> *(?:"[^"\n]*": )?)\[\n(?<items>(?: +"[^"\n]*",?\n)+) *\](?<comma>,?)$/gm,
    (whole, head: string, items: string, comma: string) => {
      const parts = items
        .split("\n")
        .filter(Boolean)
        .map((line) => strip(line).replace(/,$/, ""));
      const line = `${head}[${parts.join(", ")}]`;
      return line.length + comma.length <= 80 ? line + comma : whole;
    },
  );
}

async function main(): Promise<number> {
  // --check-cache: whether reports/ holds every report forms.json cites, for
  // the pull request check, which can only rebuild forms.json then
  if (process.argv.includes("--check-cache")) return cacheIsComplete() ? 0 : 1;
  const offline = process.argv.includes("--offline");
  let captures = new Map<string, string>();
  // The cache holds every report used before, so a report that discovery
  // misses (the Wayback Machine's index is patchy) is still used.
  const reports = cachedReports();
  if (!offline) {
    let discovered: Map<string, Report>;
    try {
      [discovered, captures] = await discoverReports();
    } catch (error) {
      // The Wayback Machine is down. With no new quarter due and every report
      // forms.json was built from already cached, there is nothing discovery
      // could add, so this is no reason to fail.
      if (newQuarterDue(new Date(), readDataset()) || !cacheIsComplete())
        throw error;
      console.log(
        `::warning::${errorMessage(error)}; no new quarter is due yet and every report is cached, so forms.json is left as it is`,
      );
      return 0;
    }
    for (const [url, report] of [...discovered, ...citedReports()])
      reports.set(url, report);
  }
  const allForms: [Report, FormRow[]][] = [];
  const officeReports = new Map<string, [Report, OfficeReport][]>();
  for (const report of bestReports(reports.values())) {
    const content = await downloadReport(report, captures);
    if (report.family === "all_forms") {
      const rows = await parseAllFormsReport(report, content);
      allForms.push([report, rows]);
      const current = rows.filter(
        (row) => row.fiscalQuarter === report.fiscalQuarter,
      ).length;
      console.log(
        `all forms FY${report.fiscalYear} Q${report.fiscalQuarter} (${extOf(report)}): ${current} form rows`,
      );
    } else {
      const parsed = await parseOfficeReport(report, content);
      if (!officeReports.has(report.family))
        officeReports.set(report.family, []);
      officeReports.get(report.family)!.push([report, parsed]);
      console.log(
        `${report.family} FY${report.fiscalYear} Q${report.fiscalQuarter} (${extOf(report)}): ${parsed.offices.length} offices,` +
          ` total ${grandTotal(parsed) ? "from report" : "summed"}`,
      );
    }
  }
  const dataset = buildDataset(allForms, officeReports);
  if (existsSync(OUTPUT_PATH)) checkHistory(readDataset(), dataset);
  writeFileSync(OUTPUT_PATH, `${toJson(dataset)}\n`);
  console.log(
    `wrote ${OUTPUT_PATH}: ${dataset.forms.length} forms over ${dataset.periods.length} quarters`,
  );
  return 0;
}

if (import.meta.main) process.exit(await main());
