import type { Form } from "../api/uscis";
import {
  categoryName,
  HEADLINE_CATEGORY,
  QuarterPoint,
  STALLED_RATIO,
} from "./uscis";

// How long someone filing a USCIS form today should plan for, and when not to
// say. Everything the range rests on is in this file: the calibration table,
// where it came from, and the rules that pick a row of it or suppress it.
//
// The range starts from USCIS's own median processing time for the visitor's
// category (the newest quarter's, which is one quarter old by the time anyone
// reads it) and multiplies it by how far real waits landed from that median in
// the past.
//
// Provenance: a backtest over USCIS's quarterly all-forms reports, FY2014 to
// FY2026, one row per category of a form per quarter ("series-quarter"). The
// realized wait of the people who filed in quarter t is the USCIS median of a
// later quarter t+k whose median case age is about 3k months, i.e. the cases
// filed in t. Each row below is the 10th/25th/50th/75th/90th percentile of
// realized wait ÷ the USCIS median published for the quarter before t, split
// by the pressure level in the quarter before t; n = 185 low, 272 typical
// and 159 high series-quarters (616 in all). The check below takes the level
// from quarter t itself instead, which is known for a slightly different set
// of rows: 618. Checked in-sample over those 618 series-quarters, the 50%
// band (p25-p75) held 50% of outcomes and the 80% band (p10-p90) 81%, but the
// 80% band held only 67% in the 49 quarters that trip the slowdown rule
// below, even with the high row applied; the pages say so. Only 3 of the 618
// had decisions below a quarter of their recent average, so the table says
// almost nothing about a category USCIS has all but stopped deciding. Any
// change to these numbers needs the backtest rerun.
//
// The backtest read forms.json as it was, before the pages learned to set
// aside two kinds of bad data (components/uscis.ts): the Apr–Jun 2024
// report repeated Jan–Mar 2024's medians for 37 of 44 series
// (republishedMedianQuarters), and a few pending counts are out of line with
// their quarter's filings and decisions (flowCheck). The repeated medians
// sit in the backtest as the base of the series-quarters filed in Jul–Sep
// 2024 and as the realized wait of some filed about a year before; each is
// the real median of the quarter before, one quarter stale, so they add
// noise rather than a bias, in about one series-quarter in 16. Pending
// counts only pick the pressure level, so an out-of-line count matters only
// where it changes the level: the I-130's Apr–Jun 2024 count, 9% short of
// its flow, put that quarter at the typical level where the flow puts it at
// high (the I-765's Jan–Mar 2025 spike was high either way). That is a
// handful of the 616 series-quarters, so the constants stand until the
// backtest is rerun on the cleaned data.
export const CALIBRATION = {
  low: [0.41, 0.58, 0.78, 0.96, 1.25],
  typical: [0.54, 0.75, 0.98, 1.26, 1.66],
  high: [0.61, 0.86, 1.13, 1.66, 3.1],
} as const;

export type PressureLevel = keyof typeof CALIBRATION;

/** The time to clear the backlog runs at about 1.75x USCIS's median in a
 * normal quarter; pressure is how far from that it is now. */
const TYPICAL_PILE_TO_MEDIAN = 1.75;

/** Which row of the calibration applies: how the time to clear the backlog at
 * the newest quarter's pace compares with USCIS's median, relative to the
 * usual 1.75x. More than 1.5x the usual is high, less than 1/1.5 of it low. */
export function pressureLevel(
  pileMonths: number | null,
  median: number,
): PressureLevel {
  if (pileMonths === null || median <= 0) return "typical";
  const pressure = pileMonths / median / TYPICAL_PILE_TO_MEDIAN;
  if (pressure > 1.5) return "high";
  if (pressure < 1 / 1.5) return "low";
  return "typical";
}

/** Whether decisions just collapsed: the newest quarter's decisions (the last
 * value) fell below 60% of the average of the four quarters before it. All
 * four have to be known. USCIS's median lags a slowdown by a quarter or two,
 * so the pages use the high row when this trips. `ratio` is the newest
 * quarter ÷ that average, or null when it cannot be computed. */
export function decisionShock(history: (number | null)[]): {
  shock: boolean;
  ratio: number | null;
} {
  const latest = history[history.length - 1];
  const previous = history.slice(-5, -1);
  if (
    latest === null ||
    latest === undefined ||
    previous.length < 4 ||
    previous.some((value) => value === null)
  )
    return { shock: false, ratio: null };
  const average =
    (previous as number[]).reduce((sum, value) => sum + value, 0) / 4;
  if (average === 0) return { shock: false, ratio: null };
  const ratio = latest / average;
  return { shock: ratio < 0.6, ratio };
}

/** The 10th, 25th, 50th, 75th and 90th percentile of the wait in months:
 * the median times each multiplier, unrounded. The pages round each value
 * once, where they show it (formatRangeMonths, and addMonths for the dates),
 * so that no range is rounded twice. */
export function planningRange(median: number, level: PressureLevel): number[] {
  return CALIBRATION[level].map((multiplier) => multiplier * median);
}

/** Categories (Variant.key, per form) whose wait depends on the visitor's
 * priority date and the Visa Bulletin, not on USCIS's pace, so a range from
 * the median would mislead. */
export const PRIORITY_DATE_CATEGORIES: Record<string, string[]> = {
  "I-130": ["all-other-relative"],
  "I-485": ["employment"],
};

/** What the "If you file today" table says instead of a range for a
 * priority-date category, per form and category: how USCIS goes about
 * them. Pending preference petitions are not approved yet; USCIS decides
 * them roughly as visa numbers for their priority dates come up, on its own
 * schedule, not in the order they were filed. */
export const PRIORITY_DATE_TEXT: Record<string, Record<string, string>> = {
  "I-130": {
    "all-other-relative":
      "USCIS decides these petitions roughly as visa numbers come up for their priority dates, on its own schedule, not in the order they were filed; until then they wait, unapproved. When your relative can immigrate depends on the priority date:",
  },
  "I-485": {
    employment:
      "USCIS can approve these only once the priority date is current, and decides them roughly as visa numbers come up. How long yours takes depends on your priority date:",
  },
};

/** Forms and their categories (Variant.key; "*" for every one) for which
 * USCIS offers premium processing: for an extra fee, it acts on a case
 * within a set number of days, far sooner than the median, which counts
 * premium and regular cases together. What to tell a visitor about it. */
export const PREMIUM_PROCESSING: Record<
  string,
  { categories: string[]; note: string }
> = {
  "I-129": {
    categories: ["*"],
    note: "Premium processing is available for most I-129 classifications: for an extra fee, USCIS acts on the petition within 15 business days. USCIS's median counts premium-processed petitions together with regular ones, so filed without it, expect the later end of the range, or longer.",
  },
  "I-140": {
    categories: ["*"],
    note: "Premium processing is available for most I-140 categories: for an extra fee, USCIS acts on the petition within 15 business days (45 for some, such as national interest waivers). USCIS's median counts premium-processed petitions together with regular ones, so filed without it, expect the later end of the range, or longer.",
  },
  "I-539": {
    categories: [],
    note: "Premium processing is available for some changes of status, such as to F, J or M: for an extra fee, USCIS acts on those within 30 days. USCIS's median counts them together with regular applications.",
  },
  "I-765": {
    categories: [],
    note: "Premium processing is available for some work permits, such as F-1 students' OPT and STEM OPT (among Other Categories): for an extra fee, USCIS acts on those within 30 days. USCIS's median counts them together with regular applications.",
  },
};

/** Whether all (or nearly all) of a category's cases can be
 * premium-processed (PREMIUM_PROCESSING), so its median mixes weeks-long
 * premium cases with regular ones. */
export function premiumCategory(form: string, key: string): boolean {
  const categories = PREMIUM_PROCESSING[form]?.categories ?? [];
  return categories.includes("*") || categories.includes(key);
}

/** Below this many decisions in a quarter, the median, and the time to clear
 * the backlog at the quarter's pace, are too noisy to plan on. */
const MIN_DECISIONS = 100;

// Below STALLED_RATIO of the four previous quarters' average, decisions
// have nearly stopped: the median then describes the few cases USCIS still
// decided, and the calibration has almost no past quarters like it.

/** Why a category gets no range. */
export type Suppression = "too few decisions" | "nearly stopped";

/** One category of a form, as the "If you file today" table and headline
 * show it. */
export interface CategoryRange {
  /** The category (Variant.key) */
  key: string;
  /** The all-forms report's row title */
  title: string;
  /** What to call the category: "Immediate Relative", "Advance Parole", or
   * the form number when the form has just the one category */
  name: string;
  received: number | null;
  /** USCIS's median processing time in months, newest quarter */
  median: number;
  level: PressureLevel;
  shock: boolean;
  /** Newest quarter's decisions ÷ the four quarters before, when known */
  shockRatio: number | null;
  /** Why there is no range, or null when there is one */
  suppressed: Suppression | null;
  /** Waits on the Visa Bulletin: no range */
  priorityDate: boolean;
  /** Its cases can be premium-processed (premiumCategory): the range is for
   * the median of premium and regular cases together */
  premium: boolean;
  /** The wait in months at the 10th, 25th, 50th, 75th and 90th percentile */
  q: number[];
}

/** The planning range for every category of the form that has a USCIS
 * median in the form's newest quarter, in the report's order. */
export function categoryRanges(form: Form): CategoryRange[] {
  const quarters = Object.keys(form.quarters).sort();
  const latest = quarters[quarters.length - 1];
  if (latest === undefined) return [];
  const variants = form.quarters[latest].variants;
  return variants
    .filter((variant) => variant.processingTime !== null)
    .map((variant) => {
      const median = variant.processingTime as number;
      const history = quarters.map((quarter) => {
        const same = form.quarters[quarter].variants.find(
          ({ key }) => key === variant.key,
        );
        return same === undefined ||
          same.approved === null ||
          same.denied === null
          ? null
          : same.approved + same.denied;
      });
      const completions = history[history.length - 1];
      const pileMonths =
        completions === null || completions === 0 || variant.pending === null
          ? null
          : variant.pending / (completions / 3);
      const { shock, ratio } = decisionShock(history);
      const premium = premiumCategory(form.form, variant.key);
      const pressure = pressureLevel(pileMonths, median);
      // A small pile for the median reads as USCIS catching up (the low
      // row), but where most cases can be premium-processed it is small
      // because premium cases clear in weeks: the I-129's 192,712 pending
      // in Apr–Jun 2026 took 3.2 months to clear against a 9.5-month
      // median, and the low row put the whole most likely range, 5.5-9.1
      // months, below that median. Such a category gets the typical row.
      const level = shock
        ? "high"
        : premium && pressure === "low"
        ? "typical"
        : pressure;
      return {
        key: variant.key,
        title: variant.title,
        name: categoryName(variant, form, variants.length),
        received: variant.received,
        median,
        level,
        shock,
        shockRatio: ratio,
        suppressed:
          completions === null || completions < MIN_DECISIONS
            ? "too few decisions"
            : ratio !== null && ratio < STALLED_RATIO
            ? "nearly stopped"
            : null,
        priorityDate: (PRIORITY_DATE_CATEGORIES[form.form] ?? []).includes(
          variant.key,
        ),
        premium,
        q: planningRange(median, level),
      };
    });
}

/** The range a page leads with: the category with the most applications
 * received, among those that have a range at all. Null when none does. */
export function headlineRange(
  ranges: CategoryRange[],
  form: string,
): CategoryRange | null {
  // the category most of the form's visitors are in, when it has a range;
  // no other category stands in for it
  const preferred = ranges.find(
    (range) => range.key === HEADLINE_CATEGORY[form],
  );
  if (preferred !== undefined)
    return !preferred.priorityDate && preferred.suppressed === null
      ? preferred
      : null;
  return ranges
    .filter((range) => !range.priorityDate && range.suppressed === null)
    .reduce<CategoryRange | null>(
      (best, range) =>
        best === null || (range.received ?? 0) > (best.received ?? 0)
          ? range
          : best,
      null,
    );
}

/** A range of months, "11-22 months" or "2.8-5.5 months": whole months,
 * but one decimal on both ends when the range starts below three months. */
export function formatRangeMonths(
  low: number,
  high: number,
  unit = "months",
): string {
  const format = (months: number) =>
    low < 3 ? months.toFixed(1) : String(Math.round(months));
  const from = format(low);
  const to = format(high);
  return from === to ? `about ${from} ${unit}` : `${from}-${to} ${unit}`;
}

/** USCIS's median as it publishes it, to a tenth of a month: "13.0 months". */
export function formatMedian(months: number): string {
  return `${months.toFixed(1)} months`;
}

export const TOO_FEW_DECISIONS = "too few decisions";

/** The fewest cases an office's pile has to change by to count as USCIS
 * moving cases (casesMovedQuarters). */
const MOVED_MIN_CASES = 100;

/** The quarters (QuarterPoint.quarter) in which an office's pending count
 * more than doubled or halved since the quarter before: USCIS moving cases
 * between offices, not the office speeding up or falling behind. Worked out
 * from all of the office's categories together (`total`) and applied to
 * every one of them: a small category's count swings that much on its own
 * (2 to 6), and a category that got fewer of the moved cases than the others
 * would read as the office falling behind (Jacksonville's I-130 immediate
 * relatives went from 3,237 to 6,299 in Apr-Jun 2026, its total from 3,383
 * to 16,206). A change of fewer than `minimum` cases (40 to 90 at a small
 * office) is no sign of a move either way. */
export function casesMovedQuarters(
  total: QuarterPoint[],
  minimum = MOVED_MIN_CASES,
): string[] {
  return total
    .filter((point, index) => {
      const previous = total[index - 1]?.pending ?? null;
      return (
        point.pending !== null &&
        previous !== null &&
        Math.abs(point.pending - previous) >= minimum &&
        (point.pending > 2 * previous || point.pending < 0.5 * previous)
      );
    })
    .map(({ quarter }) => quarter);
}

/** A category's own pile counts as cases moved or routed in or out when it
 * changed by at least this many cases, and either more than doubled or
 * halved, or grew by half while the category's receipts at least doubled:
 * new filings routed to the office. The Baltimore office's employment-based
 * I-485s went from 3,272 to 6,302 in Apr–Jun 2026 as its receipts of them
 * went from 1,167 to 3,766, while its total grew 20%. */
const MOVED_CATEGORY_MIN_CASES = 500;

/** The quarters in which USCIS moved (or routed) cases in or out of one
 * category of an office's (`points`): those of the office's total
 * (casesMovedQuarters), and those of the category's own pile
 * (MOVED_CATEGORY_MIN_CASES). */
export function categoryMovedQuarters(
  total: QuarterPoint[],
  points: QuarterPoint[],
): string[] {
  const own = points
    .filter((point, index) => {
      const previous = points[index - 1];
      if (
        previous === undefined ||
        point.pending === null ||
        previous.pending === null ||
        Math.abs(point.pending - previous.pending) < MOVED_CATEGORY_MIN_CASES
      )
        return false;
      const routed =
        point.received !== null &&
        previous.received !== null &&
        previous.received > 0 &&
        point.received >= 2 * previous.received;
      return (
        point.pending > 2 * previous.pending ||
        point.pending < 0.5 * previous.pending ||
        (routed && point.pending >= 1.5 * previous.pending)
      );
    })
    .map(({ quarter }) => quarter);
  return [...new Set([...casesMovedQuarters(total), ...own])].sort();
}

/** Whether cases moved in or out in a quarter of `moved`, going by the
 * points' pending count; null in other quarters. */
export function movedDirection(
  points: QuarterPoint[],
  moved: readonly string[],
  quarter: string,
): "in" | "out" | null {
  if (!moved.includes(quarter)) return null;
  const index = points.findIndex((point) => point.quarter === quarter);
  const current = points[index]?.pending ?? null;
  const previous = points[index - 1]?.pending ?? null;
  if (current === null || previous === null) return null;
  return current >= previous ? "in" : "out";
}

/** The quarters of `moved` in which the office's receipts also jumped, by
 * half or more and at least 100: new filings USCIS routed to the office,
 * not people filing there. In Apr–Jun 2026 the I-130 field offices together
 * received 159,365 petitions, up from 50,697, while USCIS received 166,322
 * nationwide, as many as the quarter before. */
export function routedQuarters(
  points: QuarterPoint[],
  moved: readonly string[],
): string[] {
  return points
    .filter((point, index) => {
      const previous = points[index - 1]?.received ?? null;
      return (
        moved.includes(point.quarter) &&
        point.received !== null &&
        previous !== null &&
        point.received >= 1.5 * previous &&
        point.received - previous >= 100
      );
    })
    .map(({ quarter }) => quarter);
}

/** Why the time to clear the backlog at one quarter's pace would mislead, or
 * null when it would not (or cannot be worked out at all): fewer than 100
 * decisions to divide by. In a quarter in which USCIS moved cases between
 * offices, the pages show it, saying the pile includes the cases moved. */
export function clearingSuppressed(point: QuarterPoint): string | null {
  if (point.completions === null) return null;
  if (point.completions < MIN_DECISIONS) return TOO_FEW_DECISIONS;
  return null;
}

/** The points with no time to clear the backlog for the quarters where
 * clearingSuppressed says it would mislead, so the charts, the cards and the
 * highlight all leave the same quarters out. */
export function withoutMisleadingClearing(
  points: QuarterPoint[],
): QuarterPoint[] {
  return points.map((point) =>
    point.waitMonths !== null && clearingSuppressed(point) !== null
      ? { ...point, waitMonths: null }
      : point,
  );
}

/** The time to clear a backlog at the pace of the four quarters to
 * `quarter`: its pending count ÷ the decisions of those four quarters per
 * month. Steadier than one quarter's pace, which the cards show. Null unless
 * the pending count and all four quarters' decisions, at least
 * MIN_DECISIONS of them, are known. */
export function fourQuarterClearing(
  points: QuarterPoint[],
  quarter: string,
): { months: number; approximate: boolean } | null {
  const index = points.findIndex((point) => point.quarter === quarter);
  if (index < 3) return null;
  const window = points.slice(index - 3, index + 1);
  const pending = window[3].pending;
  if (
    pending === null ||
    window.some(({ completions }) => completions === null)
  )
    return null;
  const decided = window.reduce(
    (sum, { completions }) => sum + (completions ?? 0),
    0,
  );
  if (decided < MIN_DECISIONS) return null;
  return {
    months: pending / (decided / 12),
    approximate: window.some(({ approximate }) => approximate),
  };
}

/** How far apart an office's time to clear its backlog and the national one
 * have to be, as a ratio, before the office page calls one longer or
 * shorter. A backtest over every quarter of the N-400 offices, and of the
 * I-130 (immediate relatives) and I-485 (family) offices' categories the
 * pages open with, scored each verdict against how long the backlogs really
 * took to clear. At ±20% on single quarters against the national totals,
 * "longer" was right 41% (N-400), 59% (I-130) and 49% (I-485) of the time,
 * and the verdict flipped in 37% to 43% of quarters. At 1.5 times on
 * four-quarter paces (fourQuarterClearing), with I-130 and I-485 field
 * offices compared with the field offices alone, "longer" was right 66%, 69%
 * and 71% of the time and "shorter" 83% to 85%, the office was on the side
 * the page said 86% to 97% of the time, and the verdict flipped in 12% to
 * 19% of quarters. */
export const CLEARING_COMPARISON_FACTOR = 1.5;

/** Whether an office's time to clear its backlog is clearly longer or
 * shorter than the national one, or too close to call */
export function compareClearing(
  office: number,
  national: number,
): "longer" | "shorter" | "close" {
  if (office > national * CLEARING_COMPARISON_FACTOR) return "longer";
  if (office * CLEARING_COMPARISON_FACTOR < national) return "shorter";
  return "close";
}
