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
  preference: [
    "f11",
    "f12",
    "c21f21",
    "c22f22",
    "c23f23",
    "c24f24",
    "c25f25",
    "cx1fx1",
    "cx2fx2",
    "cx3fx3",
    "c31f31",
    "c32f32",
    "c33f33",
    "f41",
    "f42",
    "f43",
  ],
  employment: [
    "e11",
    "e12",
    "e13",
    "e14",
    "e15",
    "e2",
    "e3",
    "ew3",
    "ew4",
    "ew5",
    "c51",
    "c52",
    "c53",
    "t51",
    "t52",
    "t53",
    "i51",
    "i52",
    "i53",
    "r51",
    "r52",
    "r53",
  ],
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

/** Why an immigrant visa class has no column in State's IV Scheduling Status
 * Tool */
export const CLASS_NOTES: Partial<Record<string, string>> = {
  k1: FIANCE_NOTE,
  k2: FIANCE_NOTE,
  k3: K3_NOTE,
  k4: K3_NOTE,
  dv1: DV_NOTE,
  dv2: DV_NOTE,
  dv3: DV_NOTE,
  ir3: ADOPTION_NOTE,
  ir4: ADOPTION_NOTE,
  ih3: ADOPTION_NOTE,
  ih4: ADOPTION_NOTE,
  cw1iw1: WIDOW_NOTE,
  cw2iw2: WIDOW_NOTE,
  ib1: SELF_PETITION_NOTE,
  ib2: SELF_PETITION_NOTE,
  ib3: SELF_PETITION_NOTE,
  b21: SELF_PETITION_NOTE,
  b22: SELF_PETITION_NOTE,
  b23: SELF_PETITION_NOTE,
  b24: SELF_PETITION_NOTE,
  bx1: SELF_PETITION_NOTE,
  bx2: SELF_PETITION_NOTE,
  bx3: SELF_PETITION_NOTE,
  sb1: RETURNING_RESIDENT_NOTE,
  sd1: SPECIAL_IMMIGRANT_NOTE,
  sd2: SPECIAL_IMMIGRANT_NOTE,
  sd3: SPECIAL_IMMIGRANT_NOTE,
  se1: SPECIAL_IMMIGRANT_NOTE,
  se2: SPECIAL_IMMIGRANT_NOTE,
  se3: SPECIAL_IMMIGRANT_NOTE,
  si1: SPECIAL_IMMIGRANT_NOTE,
  si2: SPECIAL_IMMIGRANT_NOTE,
  si3: SPECIAL_IMMIGRANT_NOTE,
  sk1: SPECIAL_IMMIGRANT_NOTE,
  sk2: SPECIAL_IMMIGRANT_NOTE,
  sk3: SPECIAL_IMMIGRANT_NOTE,
  sq1: SPECIAL_IMMIGRANT_NOTE,
  sq2: SPECIAL_IMMIGRANT_NOTE,
  sq3: SPECIAL_IMMIGRANT_NOTE,
  sr1: SPECIAL_IMMIGRANT_NOTE,
  sr2: SPECIAL_IMMIGRANT_NOTE,
  sr3: SPECIAL_IMMIGRANT_NOTE,
  am1: AMERASIAN_NOTE,
  am2: AMERASIAN_NOTE,
  am3: AMERASIAN_NOTE,
};

/** For the classes whose pages also count a nonimmigrant visa that shares
 * their symbol (see DESCRIPTION_OVERRIDES in api/consulates.ts): which cases
 * the tool's employment queue is for. */
export const CLASS_QUEUE_SCOPES: Partial<Record<string, string>> = {
  e2: "The employment queue is for EB-2 immigrant visas only, not for the E-2 treaty investor visas this page also counts.",
  e3: "The employment queue is for EB-3 immigrant visas only, not for the E-3 Australian professional visas this page also counts.",
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
