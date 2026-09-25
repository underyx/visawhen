import type {
  Form,
  OfficeCategory,
  OfficeQuarter,
  Period,
  QuarterCounts,
  Variant,
} from "../api/uscis";

/** One quarter of a form's (or an office's) numbers, with the derived figures
 * the pages and charts show. */
export interface QuarterPoint extends QuarterCounts {
  quarter: string;
  /** "Jul–Sep 2025" */
  label: string;
  /** Decisions made in the quarter: approvals plus denials */
  completions: number | null;
  /** Whether `completions`, and the figures worked out from it, count a
   * number of approvals or denials that USCIS withheld as too small to
   * disclose as WITHHELD_ESTIMATE */
  approximate: boolean;
  /** Months it would take to decide every pending application at the
   * quarter's pace of decisions: the time to clear the backlog, not a wait */
  waitMonths: number | null;
  /** Share of the quarter's decisions that were approvals, 0-1 */
  approvalRate: number | null;
  /** USCIS's own median processing time in months, per category of the form
   * (Variant.key) */
  processingTimes: Record<string, number>;
}

/** How many quarters the charts show at first: the last six years. */
export const CHART_QUARTERS = 24;

/** What a count USCIS withheld as too small to disclose ("D") is counted as:
 * in its N-400 and I-485 office reports these come to 1 to 9. Some quarters
 * of the I-130 office reports leave far more unaccounted for per "D"
 * (QuarterCounts.withheld), so the figures worked out from it are shown as
 * approximate ("~"), and only decisions are ever estimated. */
export const WITHHELD_ESTIMATE = 5;

const monthFormatter = new Intl.DateTimeFormat("en-US", {
  month: "short",
  timeZone: "UTC",
});

export function quarterLabel(period: Period): string {
  const start = new Date(period.start);
  const end = new Date(period.end);
  return `${monthFormatter.format(start)}–${monthFormatter.format(
    end,
  )} ${end.getUTCFullYear()}`;
}

/** The points of a series, one per period from its first quarter with data
 * to its last; quarters without data in between come out as nulls so the
 * charts show the gap. */
export function toPoints(
  periods: Period[],
  counts: Record<string, QuarterCounts & { variants?: Variant[] }>,
): QuarterPoint[] {
  const quarters = Object.keys(counts).sort();
  if (quarters.length === 0) return [];
  const first = quarters[0];
  const last = quarters[quarters.length - 1];
  return periods
    .filter((period) => period.quarter >= first && period.quarter <= last)
    .map((period) => {
      const quarter = counts[period.quarter];
      const received = quarter?.received ?? null;
      const approved = quarter?.approved ?? null;
      const denied = quarter?.denied ?? null;
      const pending = quarter?.pending ?? null;
      // USCIS withholds counts too small to disclose; with the other one
      // known, the quarter's decisions are that and a few more
      const withheld = quarter?.withheld ?? [];
      const approvedCount =
        approved ?? (withheld.includes("approved") ? WITHHELD_ESTIMATE : null);
      const deniedCount =
        denied ?? (withheld.includes("denied") ? WITHHELD_ESTIMATE : null);
      const completions =
        approvedCount === null || deniedCount === null
          ? null
          : approvedCount + deniedCount;
      const processingTimes: Record<string, number> = {};
      for (const variant of quarter?.variants ?? [])
        if (variant.processingTime !== null)
          processingTimes[variant.key] = variant.processingTime;
      return {
        quarter: period.quarter,
        label: quarterLabel(period),
        received,
        approved,
        denied,
        pending,
        completions,
        approximate:
          completions !== null && (approved === null || denied === null),
        waitMonths:
          completions === null || completions === 0 || pending === null
            ? null
            : pending / (completions / 3),
        approvalRate:
          completions === null || completions === 0 || approvedCount === null
            ? null
            : approvedCount / completions,
        processingTimes,
      };
    });
}

/** Always in months: the time to clear a backlog put in years reads like a
 * wait, which it is not. */
export function formatMonths(months: number | null): string {
  if (months === null) return "n/a";
  if (months < 10) return `${months.toFixed(1)} months`;
  if (months < 240) return `${Math.round(months)} months`;
  return "240+ months";
}

export function formatCount(count: number | null): string {
  return count === null ? "n/a" : count.toLocaleString("en-US");
}

export function formatPercent(share: number | null): string {
  return share === null ? "n/a" : `${Math.round(share * 100)}%`;
}

/** A figure worked out from a count USCIS withheld (QuarterPoint.approximate)
 * as "~41 months"; unknown ones stay "n/a". */
export function approximately(text: string, approximate: boolean): string {
  return approximate && text !== "n/a" ? `~${text}` : text;
}

/** The relative change between two quarters as "+12%" / "−8%", or null when
 * either side is missing or zero. */
export function formatChange(
  previous: number | null | undefined,
  current: number | null | undefined,
): string | null {
  if (
    previous === null ||
    previous === undefined ||
    current === null ||
    current === undefined ||
    previous === 0
  )
    return null;
  const change = Math.round(((current - previous) / previous) * 100);
  if (change === 0) return "unchanged";
  return `${change > 0 ? "+" : "−"}${Math.abs(change)}%`;
}

/** The change between two quarters' shares, 0-1, in percentage points of the
 * rounded percentages the pages show, as "+3 pts" / "−6 pts" ("unchanged"
 * when those are equal), or null when either side is missing: a rate from
 * 84% to 78% is "−6 pts", where formatChange would give the relative change,
 * "−7%", which reads as a fall from 85%. */
export function formatPointChange(
  previous: number | null | undefined,
  current: number | null | undefined,
): string | null {
  if (
    previous === null ||
    previous === undefined ||
    current === null ||
    current === undefined
  )
    return null;
  const change = Math.round(current * 100) - Math.round(previous * 100);
  if (change === 0) return "unchanged";
  return `${change > 0 ? "+" : "−"}${Math.abs(change)} pts`;
}

/** The quarter-over-quarter summary shown above the charts. `casesMoved`
 * says the pending count jumped because USCIS moved cases between offices,
 * so the sentence does not read like the office fell behind or caught up. */
export function highlight(
  points: QuarterPoint[],
  subject: string,
  what: string,
  casesMoved = false,
): string {
  const current = points[points.length - 1];
  const previous = points[points.length - 2];
  if (current === undefined) return "";
  const sentences: string[] = [];
  const pendingChange = formatChange(previous?.pending, current.pending);
  if (current.pending !== null) {
    const grew = pendingChange?.startsWith("+") ?? false;
    const moved =
      casesMoved && pendingChange !== null && pendingChange !== "unchanged"
        ? grew
          ? " as USCIS moved cases in from other offices"
          : " as USCIS moved cases to other offices"
        : "";
    sentences.push(
      `The pile of pending ${what} at ${subject} ${
        pendingChange === null
          ? "stood at"
          : pendingChange === "unchanged"
          ? "stayed at"
          : grew
          ? `grew ${pendingChange.slice(1)} to`
          : `shrank ${pendingChange.slice(1)} to`
      } ${formatCount(current.pending)} in ${current.label}${moved}.`,
    );
  }
  if (current.waitMonths !== null) {
    const previousWait =
      previous?.waitMonths === null || previous?.waitMonths === undefined
        ? ""
        : formatMonths(previous.waitMonths) === formatMonths(current.waitMonths)
        ? ", the same as the quarter before"
        : `, ${
            current.waitMonths < previous.waitMonths ? "down" : "up"
          } from ${formatMonths(previous.waitMonths)}`;
    sentences.push(
      `At that quarter's pace of decisions, clearing it would take ${
        current.approximate ? "about " : ""
      }${formatMonths(current.waitMonths)}${previousWait}.`,
    );
  }
  return sentences.join(" ");
}

/** One line of USCIS's median processing time on the wait chart. */
export interface ProcessingTimeSeries {
  /** The category, the key into `processingTimes` */
  key: string;
  /** Short legend label */
  label: string;
}

/** A short name for a category of a form: the parenthetical of its row title
 * ("Immediate Relative"), or whatever the title adds to the form's own. */
export function variantLabel(title: string, formTitle: string): string {
  // a trailing parenthetical after a space; "Fiancé(e)" is not a category
  const parenthetical = /\s\(([^()]*)\)\s*$/.exec(title);
  if (parenthetical !== null) return parenthetical[1];
  const rest = title
    .replace(formTitle, "")
    .replace(/^[\s,:-]+/, "")
    .trim();
  return rest === "" ? "Standard" : rest;
}

/** Names for categories (Variant.key) whose row title has no short name in
 * it, per form. USCIS titles a form's main category after the form itself
 * ("Standard" by variantLabel), which says nothing next to the form's other
 * categories; the I-131 rows are all long titles; "All Other" reads like a
 * fragment. "all" is a form's only row, which for the I-130 and I-765 were
 * all categories together before USCIS split them. */
const CATEGORY_NAMES: Record<string, Record<string, string>> = {
  "I-130": { all: "All relatives" },
  "I-131": {
    "travel-document": "Other Travel Documents",
    "advance-parole": "Advance Parole",
    "parole-in-place": "Parole in Place",
    "humanitarian-parole": "Humanitarian Parole",
    "initial-parole": "Initial Parole (outside the US)",
  },
  "I-526": { legacy: "Legacy", standalone: "Standalone Investor" },
  "I-765": { "all-other": "Other Categories" },
  "N-400": { civilian: "Civilian", military: "Military" },
};

/** What the pages call a category of a form: the form number when the form
 * has only the one category in the quarter (`categoryCount`, counting every
 * row, with a median or not), otherwise a short name that tells it apart
 * from the others, falling back to the full row title. */
export function categoryName(
  variant: { key: string; title: string },
  form: { form: string; title: string },
  categoryCount: number,
): string {
  if (categoryCount === 1) return form.form;
  const named = CATEGORY_NAMES[form.form]?.[variant.key];
  if (named !== undefined) return named;
  if (variant.key === "all") return "All categories";
  const label = variantLabel(variant.title, form.title);
  return label === "Standard" ? variant.title : label;
}

/** The categories of a form whose USCIS median processing time is worth a
 * line on the chart: every category with a median in the quarters the chart
 * shows at first, those USCIS still publishes one for first, then those
 * with the most received, at most four so the legend stays readable. Lines
 * follow a category through USCIS's renames of its row (Variant.key); one
 * it stopped publishing, or merged into others, ends where it stopped. */
export function processingTimeSeries(
  points: QuarterPoint[],
  form: Pick<Form, "form" | "title" | "quarters">,
): ProcessingTimeSeries[] {
  // per category: the newest quarter with a median, and that quarter's row
  const newest = new Map<string, { index: number; variant: Variant }>();
  points.slice(-CHART_QUARTERS).forEach((point, index) => {
    for (const variant of form.quarters[point.quarter]?.variants ?? [])
      if (variant.processingTime !== null)
        newest.set(variant.key, { index, variant });
  });
  const series = [...newest.values()]
    .sort(
      (a, b) =>
        b.index - a.index ||
        (b.variant.received ?? 0) - (a.variant.received ?? 0),
    )
    .slice(0, 4);
  return series.map(({ variant }) => ({
    key: variant.key,
    label: series.length === 1 ? "" : categoryName(variant, form, 2),
  }));
}

/** The newest quarter with a USCIS median for any category, when the newest
 * quarter has none: USCIS stopped publishing one (the I-730 after
 * Jul–Sep 2025). Null when the newest quarter has one, or no quarter does. */
export function lastMedianLabel(points: QuarterPoint[]): string | null {
  const current = points[points.length - 1];
  if (current === undefined || Object.keys(current.processingTimes).length > 0)
    return null;
  const last = [...points]
    .reverse()
    .find((point) => Object.keys(point.processingTimes).length > 0);
  return last === undefined ? null : last.label;
}

/** The per-office report's category that the office pages of a form lead
 * with, the one most of their visitors are in: immediate relatives of US
 * citizens for the I-130, family-based for the I-485 (except at offices that
 * handle few of those: openingOfficeCategory). The office pages of other
 * forms show the total alone. */
export const LEADING_OFFICE_CATEGORY: Record<string, string> = {
  "I-130": "immediate-relative",
  "I-485": "family",
};

/** The key of all of a per-office report's categories together */
export const ALL_CATEGORIES = "total";

/** Short names and a line on who is in each per-office category, from the
 * reports' own footnotes. */
const OFFICE_CATEGORIES: Record<string, { name: string; who: string }> = {
  "immediate-relative": {
    name: "Immediate Relative",
    who: "Petitions by US citizens for their spouses, their unmarried children under 21 and, if they are 21 or older, their parents.",
  },
  "all-other-relative": {
    name: "All Other Relative",
    who: "Petitions for relatives in the family preference categories (F1 to F4), who also wait for a visa number.",
  },
  family: {
    name: "Family",
    who: "Applications based on a family relationship with a US citizen or permanent resident.",
  },
  employment: {
    name: "Employment",
    who: "Applications based on employment or on an investment in a new business.",
  },
  humanitarian: {
    name: "Humanitarian",
    who: "Applications of asylees and refugees, including Cuban and Indochinese refugees.",
  },
  other: {
    name: "Other",
    who: "All other applications, such as those of human trafficking or crime victims.",
  },
  civilian: {
    name: "Civilian",
    who: "Applications not based on military service.",
  },
  military: {
    name: "Military",
    who: "Applications based on service in the US armed forces.",
  },
};

export function officeCategoryName(category: OfficeCategory): string {
  return OFFICE_CATEGORIES[category.key]?.name ?? category.label;
}

export function officeCategoryWho(key: string): string | null {
  return OFFICE_CATEGORIES[key]?.who ?? null;
}

/** Forms whose service centers (and the National Benefits Center) hold much
 * of the pending pile: a field office's pace is compared with the other
 * field offices', not with a national total dominated by the centers. Until
 * USCIS moved the I-130 pile to the field offices in Apr-Jun 2026, nearly
 * every field office read "faster than the country as a whole". */
export const SERVICE_CENTER_FORMS = ["I-130", "I-485"];

/** Whether an office is a service center or the National Benefits Center
 * rather than a field office */
export function isServiceCenter(name: string): boolean {
  return /\bCenter$/.test(name);
}

/** Several offices' counts added up, quarter by quarter: each count is the
 * sum of those known, with a count withheld as too small counted as
 * WITHHELD_ESTIMATE, and null only when no office has it. */
export function sumCounts(
  counts: Record<string, QuarterCounts>[],
): Record<string, QuarterCounts> {
  const fields = ["received", "approved", "denied", "pending"] as const;
  const sums: Record<string, QuarterCounts> = {};
  for (const quarters of counts)
    for (const [quarter, quarterCounts] of Object.entries(quarters)) {
      const sum = (sums[quarter] ??= {
        received: null,
        approved: null,
        denied: null,
        pending: null,
      });
      for (const field of fields) {
        const value =
          quarterCounts[field] ??
          (quarterCounts.withheld?.includes(field) ? WITHHELD_ESTIMATE : null);
        if (value !== null) sum[field] = (sum[field] ?? 0) + value;
      }
    }
  return sums;
}

/** Per-office categories that mean the same as the all-forms report's
 * category with the same key, per form: the I-485 per-office report's
 * "Humanitarian" covers several national categories (asylum, refugee, ...). */
export const NATIONAL_OFFICE_CATEGORIES: Record<string, string[]> = {
  "I-130": ["immediate-relative", "all-other-relative"],
  "I-485": ["family", "employment", "other"],
};

/** One category's counts from per-office quarters (an office's, or the
 * report's national totals); all of them together for ALL_CATEGORIES. */
export function officeCategoryCounts(
  quarters: Record<string, OfficeQuarter>,
  key: string,
): Record<string, QuarterCounts> {
  if (key === ALL_CATEGORIES) return quarters;
  const counts: Record<string, QuarterCounts> = {};
  for (const [quarter, office] of Object.entries(quarters)) {
    const category = office.categories?.[key];
    if (category !== undefined) counts[quarter] = category;
  }
  return counts;
}

/** An office's points for each category of the per-office report that it
 * has numbers for, on forms whose office pages break them down
 * (LEADING_OFFICE_CATEGORY); none on other forms. */
export function officeCategoryPoints(
  periods: Period[],
  form: Pick<Form, "form" | "officeCategories">,
  quarters: Record<string, OfficeQuarter>,
): { category: OfficeCategory; points: QuarterPoint[] }[] {
  if (LEADING_OFFICE_CATEGORY[form.form] === undefined) return [];
  return (form.officeCategories ?? [])
    .map((category) => ({
      category,
      points: toPoints(periods, officeCategoryCounts(quarters, category.key)),
    }))
    .filter(({ points }) => points.length > 0);
}

/** A category is a real part of an office's work, not a few stray cases,
 * with at least this share of the office's pending cases or of its
 * decisions in a quarter, or at least MAIN_CATEGORY_DECISIONS decisions.
 * In Apr-Jun 2026, family-based I-485s came to 0-3% of both at the
 * California, Nebraska and Texas service centers (12% and 10% of Potomac's
 * few), and to more than a fifth of one or the other at every field
 * office. */
const MAIN_CATEGORY_SHARE = 0.15;
const MAIN_CATEGORY_DECISIONS = 100;

/** The per-office category (ALL_CATEGORIES for all of them together) that an
 * office's page opens with, and that the form's office list counts for it:
 * the form's leading category when it is a real part of the office's work
 * in its newest quarter (`total`'s), otherwise the category with the most
 * cases pending there. The I-485 service centers handle almost only
 * employment-based and "other" cases; a page leading with their few
 * family-based ones would describe a queue nobody there is in. */
export function openingOfficeCategory(
  form: string,
  total: QuarterPoint[],
  categories: { key: string; points: QuarterPoint[] }[],
): string {
  const leading = LEADING_OFFICE_CATEGORY[form];
  const current = total[total.length - 1];
  if (leading === undefined || current === undefined) return ALL_CATEGORIES;
  // each category's numbers in the office's newest quarter
  const newest = categories.flatMap(({ key, points }) => {
    const point = points.find(({ quarter }) => quarter === current.quarter);
    return point === undefined ? [] : [{ key, point }];
  });
  const share = (part: number | null, whole: number | null) =>
    part === null || whole === null || whole === 0 ? 0 : part / whole;
  const lead = newest.find(({ key }) => key === leading)?.point;
  if (
    lead !== undefined &&
    (share(lead.pending, current.pending) >= MAIN_CATEGORY_SHARE ||
      share(lead.completions, current.completions) >= MAIN_CATEGORY_SHARE ||
      (lead.completions ?? 0) >= MAIN_CATEGORY_DECISIONS)
  )
    return leading;
  const largest = newest.reduce<{ key: string; point: QuarterPoint } | null>(
    (best, category) =>
      (category.point.pending ?? 0) > (best?.point.pending ?? 0)
        ? category
        : best,
    null,
  );
  return largest?.key ?? ALL_CATEGORIES;
}
