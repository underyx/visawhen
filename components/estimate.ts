import type { Form } from "../api/uscis";
import { categoryName, QuarterPoint } from "./uscis";

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

/** A number to a tenth the way the calibration script (Python's round) does
 * it, so the pages can be checked against its output: on the exact value of
 * the floating-point number (9.5 x 3.1 is 29.4499..., so 29.4, where
 * Math.round(x * 10) would see 294.5 and round up), with exact ties going to
 * the even tenth (12.2 x 1.25 is exactly 15.25, so 15.2). */
function roundToTenth(x: number): number {
  const [whole, fraction] = x.toFixed(20).split(".");
  if (/^\d50*$/.test(fraction)) {
    const down = Number(`${whole}.${fraction[0]}`);
    return Number(fraction[0]) % 2 === 0
      ? down
      : Number((down + 0.1).toFixed(1));
  }
  return Number(x.toFixed(1));
}

/** The 10th, 25th, 50th, 75th and 90th percentile of the wait in months,
 * to a tenth of a month like USCIS's medians. The dates the pages show are
 * counted from these rounded values. */
export function planningRange(median: number, level: PressureLevel): number[] {
  return CALIBRATION[level].map((multiplier) =>
    roundToTenth(multiplier * median),
  );
}

/** Categories (Variant.key, per form) whose wait depends on the visitor's
 * priority date and the Visa Bulletin, not on USCIS's pace, so a range from
 * the median would mislead. */
export const PRIORITY_DATE_CATEGORIES: Record<string, string[]> = {
  "I-130": ["all-other-relative"],
  "I-485": ["employment"],
};

export const VISA_BULLETIN_URL =
  "https://travel.state.gov/content/travel/en/legal/visa-law0/visa-bulletin.html";

/** Below this many decisions in a quarter, the median, and the time to clear
 * the backlog at the quarter's pace, are too noisy to plan on. */
const MIN_DECISIONS = 100;

/** Below this share of the four previous quarters' average, decisions have
 * nearly stopped: the median then describes the few cases USCIS still
 * decided, and the calibration has almost no past quarters like it. */
const STALLED_RATIO = 0.25;

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
      const level = shock ? "high" : pressureLevel(pileMonths, median);
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
        q: planningRange(median, level),
      };
    });
}

/** The range a page leads with: the category with the most applications
 * received, among those that have a range at all. Null when none does. */
export function headlineRange(ranges: CategoryRange[]): CategoryRange | null {
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
export const CASES_MOVED = "USCIS moved cases between offices";

/** The quarters (QuarterPoint.quarter) in which an office's pending count
 * more than doubled or halved since the quarter before: USCIS moving cases
 * between offices, not the office speeding up or falling behind. Worked out
 * from all of the office's categories together (`total`) and applied to
 * every one of them: a small category's count swings that much on its own
 * (2 to 6), and a category that got fewer of the moved cases than the others
 * would read as the office falling behind (Jacksonville's I-130 immediate
 * relatives went from 3,237 to 6,299 in Apr-Jun 2026, its total from 3,383
 * to 16,206). */
export function casesMovedQuarters(total: QuarterPoint[]): string[] {
  return total
    .filter((point, index) => {
      const previous = total[index - 1]?.pending ?? null;
      return (
        point.pending !== null &&
        previous !== null &&
        (point.pending > 2 * previous || point.pending < 0.5 * previous)
      );
    })
    .map(({ quarter }) => quarter);
}

/** Why the time to clear the backlog at one quarter's pace would mislead, or
 * null when it would not (or cannot be worked out at all): an office's
 * quarter in which USCIS moved cases between offices (`moved`, from
 * casesMovedQuarters; checked first, as the pages then also say so about the
 * pending count), or fewer than 100 decisions to divide by. */
export function clearingSuppressed(
  point: QuarterPoint,
  moved: readonly string[] = [],
): string | null {
  if (moved.includes(point.quarter)) return CASES_MOVED;
  if (point.completions === null) return null;
  if (point.completions < MIN_DECISIONS) return TOO_FEW_DECISIONS;
  return null;
}

/** The points with no time to clear the backlog for the quarters where
 * clearingSuppressed says it would mislead, so the charts, the cards and the
 * highlight all leave the same quarters out. */
export function withoutMisleadingClearing(
  points: QuarterPoint[],
  moved: readonly string[] = [],
): QuarterPoint[] {
  return points.map((point) =>
    point.waitMonths !== null && clearingSuppressed(point, moved) !== null
      ? { ...point, waitMonths: null }
      : point,
  );
}

/** Why the time to clear the backlog in the newest of the points would
 * mislead, or null when it would not. */
export function officeEstimateSuppressed(
  points: QuarterPoint[],
  moved: readonly string[] = [],
): string | null {
  const current = points[points.length - 1];
  return current === undefined ? null : clearingSuppressed(current, moved);
}

/** Which way the time to clear the backlog moved since the quarter before:
 * more than 10% either way counts. Null when either side is unknown. */
export function backlogTrend(
  previous: number | null | undefined,
  current: number | null,
): "rising" | "steady" | "easing" | null {
  if (
    previous === null ||
    previous === undefined ||
    current === null ||
    previous === 0
  )
    return null;
  const change = (current - previous) / previous;
  if (change > 0.1) return "rising";
  if (change < -0.1) return "easing";
  return "steady";
}
