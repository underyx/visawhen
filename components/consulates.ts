import type { PostActivity } from "../api/consulates";

// Whole numbers up to 999, then thousands with up to one decimal: "462",
// "1.5K", "57.8K".
const compactRateFormatter = new Intl.NumberFormat("en-US", {
  notation: "compact",
  maximumFractionDigits: 1,
});

/** An average monthly issuance rate for the list badges: "0.1/mo", "8.5/mo",
 * "462/mo", "1.5K/mo", "0/mo". */
export function formatMonthlyRate(issuances: number | undefined): string {
  const rate = issuances ?? 0;
  if (rate === 0) return "0/mo";
  if (rate < 9.95) return `${rate.toFixed(1)}/mo`;
  // Round to whole visas first, so 999.6 shows as "1K", not "1000".
  return `${compactRateFormatter.format(Math.round(rate))}/mo`;
}

// The months in the data are stored as UTC midnight on their first day;
// format them in UTC, or a visitor in an American time zone would see the
// previous month, and the client render would disagree with the prerendered
// HTML.
const shortMonthFormatter = new Intl.DateTimeFormat("en-US", {
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});
const longMonthFormatter = new Intl.DateTimeFormat("en-US", {
  month: "long",
  year: "numeric",
  timeZone: "UTC",
});

/** A month from the data, "2025-09-01T00:00:00.000Z", as "Sep 2025". */
export function formatMonth(month: string): string {
  return shortMonthFormatter.format(new Date(month));
}

/** A month from the data, "2025-09-01T00:00:00.000Z", as "September 2025". */
export function formatLongMonth(month: string): string {
  return longMonthFormatter.format(new Date(month));
}

/** A count of visas as "5,538". */
export function formatCount(count: number): string {
  return Math.round(count).toLocaleString("en-US");
}

/** Whole months from one month in the data to another:
 * ("2025-02-01T00:00:00.000Z", "2026-02-01T00:00:00.000Z") is 12. */
function monthsBetween(from: string, to: string): number {
  const [fromYear, fromMonth] = from.split("-").map(Number);
  const [toYear, toMonth] = to.split("-").map(Number);
  return toYear * 12 + toMonth - (fromYear * 12 + fromMonth);
}

/** For a post that looks closed, a sentence that says what the data shows:
 * that it issued no visas in the last 12 months of the data, whatever else
 * lists it, or, with `immigrant` (its own page and its immigrant visa class
 * pages), that it issued immigrant visas but none in the last 12 months,
 * when State's IV Scheduling Status Tool, which is months newer, does not
 * list it either. Null for every other post, including those that issued
 * other visas but never an immigrant one in the data: they handle
 * nonimmigrant visas only, which the interview-queue card already says. */
export function describeInactivity({
  postName,
  activity,
  dataStart,
  dataEnd,
  immigrant,
  listedInTool,
}: {
  postName: string;
  activity: PostActivity;
  /** The oldest and newest months in the data */
  dataStart: string;
  dataEnd: string;
  immigrant: boolean;
  /** Whether State's newest IV Scheduling Status Tool update lists the post */
  listedInTool: boolean;
}): string | null {
  const quiet = (month: string | null) =>
    month === null || monthsBetween(month, dataEnd) >= 12;
  const since = (visas: string, lastIssued: string) =>
    `${postName} has issued no ${visas} since ${formatLongMonth(
      lastIssued,
    )}, according to the State Department’s monthly figures, which run to ${formatLongMonth(
      dataEnd,
    )}.`;
  const { lastIssued, lastImmigrantIssued } = activity;
  if (quiet(lastIssued))
    return lastIssued === null
      ? `${postName} issued no visas in any month of the State Department’s figures, ${formatLongMonth(
          dataStart,
        )} to ${formatLongMonth(dataEnd)}.`
      : since("visas", lastIssued);
  if (
    immigrant &&
    !listedInTool &&
    lastImmigrantIssued !== null &&
    quiet(lastImmigrantIssued)
  )
    return since("immigrant visas", lastImmigrantIssued);
  return null;
}

/** The three columns of State's IV Scheduling Status Tool */
export type IvCategory = "relative" | "preference" | "employment";

export const IV_CATEGORIES: IvCategory[] = [
  "relative",
  "preference",
  "employment",
];

/** A post's line in one of State's monthly updates of its IV Scheduling
 * Status Tool: per category, the month of documentarily complete cases NVC
 * is scheduling interviews for, "2026-02", or null where State lists N/A. */
export interface IvSchedule extends Record<IvCategory, string | null> {
  /** The date of State's update, "2026-09-23" */
  asOf: string;
}

export const IV_SCHEDULE_URL =
  "https://travel.state.gov/content/travel/en/us-visas/visa-information-resources/iv-wait-times.html";

/** The visa classes each column of the tool covers */
const IV_CLASSES: Record<IvCategory, string[]> = {
  relative: ["cr1ir1", "cr2ir2", "ir5"],
  preference: ["f1-family", "f2a", "f2b", "f3", "f4"],
  employment: ["eb-1", "eb-2", "eb-3", "ew", "eb-5"],
};

/** The tool's column for each visa class it covers */
export const IV_CATEGORY_BY_CLASS: Partial<Record<string, IvCategory>> =
  Object.fromEntries(
    IV_CATEGORIES.flatMap((category) =>
      IV_CLASSES[category].map((slug) => [slug, category] as const),
    ),
  );

const FIANCE_NOTE =
  "The State Department publishes no interview-scheduling data for fiancé(e) visas.";
const K3_NOTE =
  "The State Department publishes no interview-scheduling data for K-3 and K-4 visas.";
const DV_NOTE = "Diversity visas are not covered by State’s scheduling tool.";

// The tool's page lists the visa categories it covers: immediate relatives,
// family preference, and EB-1, EB-2, EB-3 and EB-5. These are not among them.
function notListedNote(cases: string): string {
  return `State’s interview-scheduling tool does not list ${cases} among the categories it covers.`;
}
const ADOPTION_NOTE = notListedNote("adoption cases");
const WIDOW_NOTE = notListedNote(
  "widows and widowers of U.S. citizens or their children",
);
const SELF_PETITION_NOTE = notListedNote(
  "self-petitioners (VAWA) or their children",
);
const RETURNING_RESIDENT_NOTE = notListedNote("returning residents (SB-1)");
const SPECIAL_IMMIGRANT_NOTE = notListedNote("special immigrants");
const AMERASIAN_NOTE = notListedNote("Amerasian immigrants");
const U_VISA_FAMILY_NOTE = notListedNote("family members of U visa holders");

/** Why a visa class that goes through NVC has no column in State's IV
 * Scheduling Status Tool: the immigrant classes it does not cover, and the K
 * visas, which are nonimmigrant visas but go through NVC too */
export const CLASS_NOTES: Partial<Record<string, string>> = {
  k1: FIANCE_NOTE,
  k2: FIANCE_NOTE,
  k3: K3_NOTE,
  k4: K3_NOTE,
  dv: DV_NOTE,
  ir3: ADOPTION_NOTE,
  ir4: ADOPTION_NOTE,
  ih3: ADOPTION_NOTE,
  ih4: ADOPTION_NOTE,
  iw: WIDOW_NOTE,
  ib1: SELF_PETITION_NOTE,
  ib2: SELF_PETITION_NOTE,
  b2a: SELF_PETITION_NOTE,
  b2b: SELF_PETITION_NOTE,
  bx: SELF_PETITION_NOTE,
  sb1: RETURNING_RESIDENT_NOTE,
  bc: SPECIAL_IMMIGRANT_NOTE,
  sd: SPECIAL_IMMIGRANT_NOTE,
  se: SPECIAL_IMMIGRANT_NOTE,
  si: SPECIAL_IMMIGRANT_NOTE,
  sk: SPECIAL_IMMIGRANT_NOTE,
  sq: SPECIAL_IMMIGRANT_NOTE,
  cq: SPECIAL_IMMIGRANT_NOTE,
  sr: SPECIAL_IMMIGRANT_NOTE,
  am: AMERASIAN_NOTE,
  su: U_VISA_FAMILY_NOTE,
};

/** The nonimmigrant classes that go through NVC like immigrant visas: the K
 * visas for fiancé(e)s and spouses of U.S. citizens and their children */
export const NVC_NONIMMIGRANT_CLASSES = ["k1", "k2", "k3", "k4"];

/** For the nonimmigrant classes whose code State also uses for an immigrant
 * class, the slug of that immigrant class's page. Until the class split,
 * these pages counted both, e.g. Manila's E3 page mostly EB-3 visas, so they
 * point visitors who bookmarked them to the immigrant page. */
export const IMMIGRANT_COUNTERPARTS: Partial<Record<string, string>> = {
  e1: "eb-1",
  e2: "eb-2",
  e3: "eb-3",
  f1: "f1-family",
  t5: "eb-5",
  u1: "su",
  c2: "f2a",
};

/** How many months before State's update a month in its tool is:
 * ("2026-09-23", "2026-02") is 7. */
export function monthsBehind(asOf: string, cutoff: string): number {
  const [asOfYear, asOfMonth] = asOf.split("-").map(Number);
  const [cutoffYear, cutoffMonth] = cutoff.split("-").map(Number);
  return asOfYear * 12 + asOfMonth - (cutoffYear * 12 + cutoffMonth);
}

/** A month from State's IV Scheduling Status Tool, "2026-02", as
 * "February 2026". */
export function formatIvMonth(month: string): string {
  return formatLongMonth(`${month}-01T00:00:00.000Z`);
}

/** A month from State's IV Scheduling Status Tool, "2026-02", as
 * "Feb 2026". */
export function formatShortIvMonth(month: string): string {
  return formatMonth(`${month}-01T00:00:00.000Z`);
}
