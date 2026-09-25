import type {
  Form,
  FormQuarter,
  OfficeCategory,
  OfficeQuarter,
  Period,
  QuarterCounts,
  UscisData,
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
  /** When `approximate`, the lowest and highest approval rate the withheld
   * count allows (WITHHELD_RANGE); null when the rate is exact, or when the
   * withheld count is not known to be that small (both withheld, or a report
   * whose "D" can stand for hundreds) */
  approvalRange: [number, number] | null;
  /** USCIS's own median processing time in months, per category of the form
   * (Variant.key) */
  processingTimes: Record<string, number>;
  /** Whether the pending count follows from the quarter before's and this
   * quarter's filings and decisions (see flowCheck): "unknown" when a count
   * is missing, and for an office, whose pile also changes as USCIS moves
   * cases between offices */
  flow: "consistent" | "inconsistent" | "unknown";
  /** Whether the pending count is out of line with its neighbours: the odd
   * one out of a dip or spike that the next quarter undoes, or a jump that
   * filings and decisions do not explain. The charts mark it; it is still
   * what USCIS reported. */
  suspect: boolean;
  /** Whether the counts come from the national totals of USCIS's per-office
   * report, for a category the all-forms report did not split out yet */
  fromOfficeReport: boolean;
}

/** How many quarters the charts show at first: the last six years. */
export const CHART_QUARTERS = 24;

/** What a count USCIS withheld as too small to disclose ("D") is counted as:
 * in its N-400 and I-485 office reports these come to 1 to 9. Some quarters
 * of the I-130 office reports leave far more unaccounted for per "D"
 * (QuarterCounts.withheld), so the figures worked out from it are shown as
 * approximate ("~"), and only decisions are ever estimated. */
export const WITHHELD_ESTIMATE = 5;

/** The smallest and largest count a "D" stands for where the report adds up
 * (the N-400 and I-485 office reports). */
export const WITHHELD_RANGE: [number, number] = [1, 9];

/** Forms whose per-office reports leave far more than WITHHELD_RANGE
 * unaccounted for per "D" in some quarters, so that a withheld count has no
 * known bound there. */
export const UNBOUNDED_WITHHELD_FORMS = ["I-130"];

/** How far a pending count may land from the quarter before's plus the
 * quarter's filings minus its decisions before the change is called out of
 * line: 8% of the larger of the two pending counts, and at least 100 cases.
 * Withdrawals, reopened cases and corrections move a pile by a few percent
 * (half of the all-forms report's series-quarters land within 1.5% of the
 * flow, three in four within 5%); USCIS's I-130 count of Apr–Jun 2024 came
 * in 9% (all categories) and 16% (all other relatives) below it, and the
 * next quarter's count put back what had gone missing. */
const FLOW_TOLERANCE = 0.08;
const FLOW_MIN_GAP = 100;

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

/** How far a pending count lands from where the earlier count and the
 * filings and decisions of the quarters since (`steps`, oldest first) would
 * put it, or null when a count is missing. */
function flowGap(
  before: number | null,
  steps: { received: number | null; completions: number | null }[],
  after: number | null,
): number | null {
  if (before === null || after === null) return null;
  let expected = before;
  for (const { received, completions } of steps) {
    if (received === null || completions === null) return null;
    expected += received - completions;
  }
  return after - expected;
}

function outOfLine(
  gap: number | null,
  before: number | null,
  after: number | null,
): boolean | null {
  if (gap === null || before === null || after === null) return null;
  return (
    Math.abs(gap) >= FLOW_MIN_GAP &&
    Math.abs(gap) > FLOW_TOLERANCE * Math.max(before, after)
  );
}

/** Marks each point's pending count as in or out of line with the quarter
 * before's count and the quarter's filings and decisions. A dip or spike
 * that the next quarter undoes (both steps out of line, the two together in
 * line: the I-765's other categories went 606k, 1,324k, 964k in 2024-2025
 * with the flow putting Jan–Mar 2025 at 855k) makes only the odd quarter
 * `suspect`: the next quarter's count is fine, though its change from the
 * odd one is not. */
function flowCheck(points: QuarterPoint[]): QuarterPoint[] {
  const steps = points.map((point, index) => {
    const previous = points[index - 1];
    if (previous === undefined) return null;
    return outOfLine(
      flowGap(previous.pending, [point], point.pending),
      previous.pending,
      point.pending,
    );
  });
  const odd = points.map((point, index) => {
    const previous = points[index - 1];
    const next = points[index + 1];
    if (
      previous === undefined ||
      next === undefined ||
      steps[index] !== true ||
      steps[index + 1] !== true
    )
      return false;
    return (
      outOfLine(
        flowGap(previous.pending, [point, next], next.pending),
        previous.pending,
        next.pending,
      ) === false
    );
  });
  return points.map((point, index) => ({
    ...point,
    flow:
      steps[index] === null
        ? "unknown"
        : steps[index]
        ? "inconsistent"
        : "consistent",
    suspect: odd[index] || (steps[index] === true && !odd[index - 1]),
  }));
}

/** Whether the change in the pending count since the quarter before can be
 * read as USCIS catching up or falling behind: not when the quarter's
 * filings and decisions do not account for it (QuarterPoint.flow). */
export function pendingChangeReliable(point: QuarterPoint): boolean {
  return point.flow !== "inconsistent";
}

/** The points of a series, one per period from its first quarter with data
 * to its last; quarters without data in between come out as nulls so the
 * charts show the gap. `checkFlow` checks each pending count against the
 * quarter's filings and decisions (flowCheck; not for an office, whose pile
 * also changes as USCIS moves cases between offices); `boundedWithheld`
 * says a withheld count is within WITHHELD_RANGE; `fromOfficeReport` lists
 * the quarters whose counts come from the per-office report's national
 * totals. */
export function toPoints(
  periods: Period[],
  counts: Record<string, QuarterCounts & { variants?: Variant[] }>,
  {
    checkFlow = true,
    boundedWithheld = true,
    fromOfficeReport = [],
  }: {
    checkFlow?: boolean;
    boundedWithheld?: boolean;
    fromOfficeReport?: readonly string[];
  } = {},
): QuarterPoint[] {
  const quarters = Object.keys(counts).sort();
  if (quarters.length === 0) return [];
  const first = quarters[0];
  const last = quarters[quarters.length - 1];
  const points = periods
    .filter((period) => period.quarter >= first && period.quarter <= last)
    .map((period): QuarterPoint => {
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
      const approximate =
        completions !== null && (approved === null || denied === null);
      const [low, high] = WITHHELD_RANGE;
      const approvalRange: [number, number] | null =
        !approximate || !boundedWithheld
          ? null
          : approved === null && denied !== null
          ? [low / (low + denied), high / (high + denied)]
          : approved !== null && denied === null
          ? approved === 0
            ? [0, 0]
            : [approved / (approved + high), approved / (approved + low)]
          : null;
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
        approximate,
        waitMonths:
          completions === null || completions === 0 || pending === null
            ? null
            : pending / (completions / 3),
        // an approximate rate only where the withheld count has a bound,
        // and then as the range
        approvalRate:
          completions === null ||
          completions === 0 ||
          approvedCount === null ||
          (approximate && approvalRange === null)
            ? null
            : approvedCount / completions,
        approvalRange,
        processingTimes,
        flow: "unknown",
        suspect: false,
        fromOfficeReport: fromOfficeReport.includes(period.quarter),
      };
    });
  return checkFlow ? flowCheck(points) : points;
}

/** Of the series (form categories) with a USCIS median in both a quarter
 * and the one before, at least this share repeating the one before to the
 * last digit means USCIS published the quarter before's medians again: in
 * Apr–Jun 2024, 37 of 44 did, against at most 4 of 38 in any other quarter
 * since FY2021. */
const REPUBLISHED_MEDIAN_SHARE = 0.5;
const REPUBLISHED_MEDIAN_MIN_SERIES = 10;

/** The quarters whose all-forms report repeats the quarter before's medians
 * (REPUBLISHED_MEDIAN_SHARE): those medians say nothing about the quarter,
 * and the pages treat them as not published. */
export function republishedMedianQuarters(forms: Form[]): string[] {
  const quarters = [
    ...new Set(forms.flatMap((form) => Object.keys(form.quarters))),
  ].sort();
  return quarters.filter((quarter, index) => {
    const previous = quarters[index - 1];
    if (previous === undefined) return false;
    let same = 0;
    let compared = 0;
    for (const form of forms) {
      const before = new Map(
        (form.quarters[previous]?.variants ?? []).map((variant) => [
          variant.key,
          variant.processingTime,
        ]),
      );
      for (const variant of form.quarters[quarter]?.variants ?? []) {
        const earlier = before.get(variant.key);
        if (
          variant.processingTime === null ||
          earlier === null ||
          earlier === undefined
        )
          continue;
        compared += 1;
        if (variant.processingTime === earlier) same += 1;
      }
    }
    return (
      compared >= REPUBLISHED_MEDIAN_MIN_SERIES &&
      same >= REPUBLISHED_MEDIAN_SHARE * compared
    );
  });
}

/** A pending count of 0 in a quarter that received applications is USCIS's
 * "-" in its pending column: for the I-870 and I-899 (worksheets it keeps
 * no pile of) and the I-956G and I-956H it means it did not count them, not
 * that none are waiting. forms.py reads "-" that way; forms.json has it as 0
 * for the quarters it read before. */
function unknownPending<T extends QuarterCounts>(counts: T): T {
  return counts.pending === 0 && (counts.received ?? 0) > 0
    ? { ...counts, pending: null }
    : counts;
}

const cleaned = new WeakMap<UscisData, UscisData>();

/** forms.json as the pages read it: a pending count of "-" as unknown
 * (unknownPending), and no medians for a quarter whose report repeats the
 * quarter before's (republishedMedianQuarters). Memoized per data object;
 * callers must not modify the result. */
export function cleanData(data: UscisData): UscisData {
  const known = cleaned.get(data);
  if (known !== undefined) return known;
  const republished = republishedMedianQuarters(data.forms);
  const result: UscisData = {
    ...data,
    forms: data.forms.map((form) => ({
      ...form,
      quarters: Object.fromEntries(
        Object.entries(form.quarters).map(
          ([quarter, counts]): [string, FormQuarter] => [
            quarter,
            {
              ...unknownPending(counts),
              variants: counts.variants.map((variant) => ({
                ...unknownPending(variant),
                processingTime: republished.includes(quarter)
                  ? null
                  : variant.processingTime,
              })),
            },
          ],
        ),
      ),
    })),
  };
  cleaned.set(data, result);
  return result;
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

/** A quarter's approval rate as the pages show it: "78%", or with a count
 * withheld as too small, the range it allows ("57-92%"), or "n/a" when that
 * range is unknown. */
export function formatApprovalRate(point: QuarterPoint): string {
  if (point.approvalRange !== null) {
    const [low, high] = point.approvalRange.map((share) =>
      Math.round(share * 100),
    );
    return low === high ? `${low}%` : `${low}-${high}%`;
  }
  return formatPercent(point.approvalRate);
}

/** A figure worked out from a count USCIS withheld (QuarterPoint.approximate)
 * as "~41 months"; unknown ones stay "n/a". */
export function approximately(text: string, approximate: boolean): string {
  return approximate && text !== "n/a" ? `~${text}` : text;
}

/** Below this many decisions (or pending cases, for the pending count) in
 * either quarter, a change between them says nothing: the I-589's 281
 * decisions of Jan–Mar 2026 made the next quarter's "+7,159%", and 10
 * decisions of the I-956 a "+29 pts" approval rate. */
export const MIN_CHANGE_BASE = 100;

/** Below this share of the average of the four quarters before it, a
 * quarter's decisions had nearly stopped: USCIS decided 281 I-589s in
 * Jan–Mar 2026, against 8,000 to 18,000 in each of the four quarters
 * before. */
export const STALLED_RATIO = 0.25;

/** Whether USCIS had nearly stopped deciding the cases of the point at
 * `index` (STALLED_RATIO), going by the four points before it, all of which
 * must be known. A change from such a quarter ("+7,159%" decided, "240+"
 * months to clear) says nothing about the pace. */
export function stalled(points: QuarterPoint[], index: number): boolean {
  const point = points[index];
  const before = points.slice(Math.max(0, index - 4), index);
  if (
    point === undefined ||
    point.completions === null ||
    before.length < 4 ||
    before.some(({ completions }) => completions === null)
  )
    return false;
  const average =
    before.reduce((sum, { completions }) => sum + (completions ?? 0), 0) / 4;
  return average > 0 && point.completions < STALLED_RATIO * average;
}

/** The relative change between two quarters as "+12%" / "−8%", or null when
 * either side is missing or zero, or below `minimum`. */
export function formatChange(
  previous: number | null | undefined,
  current: number | null | undefined,
  minimum = 1,
): string | null {
  if (
    previous === null ||
    previous === undefined ||
    current === null ||
    current === undefined ||
    previous === 0 ||
    previous < minimum ||
    current < minimum
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

/** Whether two quarters' approval rates can be compared: both exact, and on
 * at least MIN_CHANGE_BASE decisions each. */
export function approvalRatesComparable(
  previous: QuarterPoint | undefined,
  current: QuarterPoint,
  previousStalled = false,
): boolean {
  return (
    previous !== undefined &&
    !previousStalled &&
    !previous.approximate &&
    !current.approximate &&
    (previous.completions ?? 0) >= MIN_CHANGE_BASE &&
    (current.completions ?? 0) >= MIN_CHANGE_BASE
  );
}

/** Beyond this many months, the time to clear a backlog is off the pages'
 * scale ("240+ months"), and a change in it means nothing. */
export const CLEARING_SCALE_MONTHS = 240;

/** Which way the time to clear the backlog moved since the quarter before:
 * more than 10% either way counts. Null when either side is unknown, or
 * both are off the scale (CLEARING_SCALE_MONTHS): 4,288 to 2,268 months is
 * no easing anyone waits for. */
export function backlogTrend(
  previous: number | null | undefined,
  current: number | null,
): "rising" | "steady" | "easing" | null {
  if (
    previous === null ||
    previous === undefined ||
    current === null ||
    previous === 0 ||
    (previous >= CLEARING_SCALE_MONTHS && current >= CLEARING_SCALE_MONTHS)
  )
    return null;
  const change = (current - previous) / previous;
  if (change > 0.1) return "rising";
  if (change < -0.1) return "easing";
  return "steady";
}

/** A signed count: "+1,234" / "−567". */
function formatSigned(count: number): string {
  return `${count >= 0 ? "+" : "−"}${formatCount(Math.abs(count))}`;
}

/** The quarter-over-quarter summary shown above the charts. `moved` says the
 * pending count jumped because USCIS moved cases between offices ("in" or
 * "out"), so the sentences do not read like the office fell behind or caught
 * up; a pending count whose change filings and decisions do not explain
 * (pendingChangeReliable) is not read as either. `what` is plural: "I-130
 * (Immediate Relative) applications". */
export function highlight(
  points: QuarterPoint[],
  subject: string,
  what: string,
  moved: "in" | "out" | null = null,
): string {
  const current = points[points.length - 1];
  const previous = points[points.length - 2];
  if (current === undefined) return "";
  const sentences: string[] = [];
  const pendingChange = formatChange(previous?.pending, current.pending);
  const reliable = pendingChangeReliable(current);
  // no trend in the time to clear against a quarter of almost no decisions
  const comparable = reliable && !stalled(points, points.length - 2);
  if (current.pending !== null) {
    const grew = pendingChange?.startsWith("+") ?? false;
    if (
      !reliable &&
      moved === null &&
      pendingChange !== null &&
      previous?.pending !== null &&
      previous?.pending !== undefined &&
      current.received !== null &&
      current.completions !== null
    )
      sentences.push(
        `The count of pending ${what} at ${subject} went from ${formatCount(
          previous.pending,
        )} to ${formatCount(current.pending)} in ${
          current.label
        } (${pendingChange}), but that quarter's filings minus its decisions come to ${formatSigned(
          current.received - current.completions,
        )}: the count is out of line with USCIS's own numbers, so we don't read it as USCIS catching up or falling behind.`,
      );
    else
      sentences.push(
        `The pile of pending ${what} at ${subject} ${
          pendingChange === null
            ? "stood at"
            : pendingChange === "unchanged"
            ? "stayed at"
            : grew
            ? `grew ${pendingChange.slice(1)} to`
            : `shrank ${pendingChange.slice(1)} to`
        } ${formatCount(current.pending)} in ${current.label}${
          moved === "in"
            ? " as USCIS moved or routed cases here from elsewhere"
            : moved === "out"
            ? " as USCIS moved cases to other offices"
            : ""
        }.`,
      );
  }
  if (current.waitMonths !== null) {
    const clearing = `${current.approximate ? "about " : ""}${formatMonths(
      current.waitMonths,
    )}`;
    if (moved !== null)
      sentences.push(
        `At that quarter's pace of decisions, clearing it, ${
          moved === "in"
            ? "cases moved or routed in included"
            : "without the cases moved out"
        }, would take ${clearing}; the quarter before is not comparable.`,
      );
    else {
      const trend = comparable
        ? backlogTrend(previous?.waitMonths, current.waitMonths)
        : null;
      const previousWait =
        previous?.waitMonths === null || previous?.waitMonths === undefined
          ? ""
          : trend === "rising"
          ? `, up from ${formatMonths(previous.waitMonths)}`
          : trend === "easing"
          ? `, down from ${formatMonths(previous.waitMonths)}`
          : trend === "steady"
          ? formatMonths(previous.waitMonths) ===
            formatMonths(current.waitMonths)
            ? ", the same as the quarter before"
            : `, about the same as the quarter before (${formatMonths(
                previous.waitMonths,
              )})`
          : comparable &&
            formatMonths(previous.waitMonths) ===
              formatMonths(current.waitMonths)
          ? ", as in the quarter before"
          : "";
      sentences.push(
        `At that quarter's pace of decisions, clearing it would take ${clearing}${previousWait}.`,
      );
    }
  }
  if (sentences.length === 0 && current.completions !== null)
    sentences.push(
      `USCIS decided ${current.approximate ? "about " : ""}${formatCount(
        current.completions,
      )} ${what}${subject === "USCIS" ? "" : ` at ${subject}`} in ${
        current.label
      }${
        current.pending === null
          ? "; it did not publish how many were pending"
          : ""
      }.`,
    );
  return sentences.join(" ");
}

/** One line of USCIS's median processing time on the wait chart. */
export interface ProcessingTimeSeries {
  /** The category, the key into `processingTimes` */
  key: string;
  /** Short legend label */
  label: string;
}

/** A quarter from which a chart's numbers mean something else: USCIS split
 * a form by category, started reporting a category's median on its own, or
 * moved cases between offices. The charts draw a line at it. */
export interface ChartBreak {
  quarter: string;
  /** A word or two on the line: "split by category" */
  label: string;
  /** The sentence under the chart that explains it */
  text: string;
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
  "I-765": {
    all: "All categories",
    "adjustment-of-status": "Adjustment of Status",
    "all-other": "Other Categories",
  },
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

/** The newest quarter with a USCIS median in the lines a chart draws, when
 * the newest quarter has none: USCIS stopped publishing one (the I-730
 * after Jul–Sep 2025). Null when the newest quarter has one, or no quarter
 * does. */
export function lastMedianLabel(
  points: QuarterPoint[],
  keys?: readonly string[],
): string | null {
  const has = (point: QuarterPoint) =>
    Object.keys(point.processingTimes).some(
      (key) => keys === undefined || keys.includes(key),
    );
  const current = points[points.length - 1];
  if (current === undefined || has(current)) return null;
  const last = [...points].reverse().find(has);
  return last === undefined ? null : last.label;
}

/** Where a form's median changes meaning within the points: the quarter from
 * which USCIS splits a form it reported as one row ("all") by category, and
 * the quarter from which categories it gave the very same median (the
 * N-400's military and civilian, Jul–Sep 2022 to Jul–Sep 2024: one median
 * for both) get medians of their own. */
export function medianBreaks(
  points: QuarterPoint[],
  form: Pick<Form, "form" | "title" | "quarters">,
): ChartBreak[] {
  const breaks: ChartBreak[] = [];
  const variantsOf = (quarter: string) =>
    form.quarters[quarter]?.variants ?? [];
  points.forEach((point, index) => {
    const previous = points[index - 1];
    if (previous === undefined) return;
    const before = variantsOf(previous.quarter);
    const now = variantsOf(point.quarter);
    if (
      before.length === 1 &&
      before[0].key === "all" &&
      now.length > 1 &&
      now.every(({ key }) => key !== "all")
    )
      breaks.push({
        quarter: point.quarter,
        label: "split by category",
        text: `From ${point.label}, USCIS reports the ${form.form} by category; before, one row covered all of them.`,
      });
  });
  // runs of quarters in which every category's median was the same figure
  const same = points.map((point) => {
    const medians = Object.values(point.processingTimes);
    return medians.length >= 2 && medians.every((m) => m === medians[0]);
  });
  const withMedians = points.filter(
    (point) => Object.keys(point.processingTimes).length >= 2,
  );
  withMedians.forEach((point, index) => {
    const previous = withMedians[index - 1];
    const earlier = withMedians[index - 2];
    if (
      previous === undefined ||
      earlier === undefined ||
      same[points.indexOf(point)] ||
      !same[points.indexOf(previous)] ||
      !same[points.indexOf(earlier)]
    )
      return;
    const names = variantsOf(point.quarter)
      .filter(({ processingTime }) => processingTime !== null)
      .map((variant) =>
        categoryName(variant, form, variantsOf(point.quarter).length),
      );
    breaks.push({
      quarter: point.quarter,
      label: "separate medians",
      text: `Until ${previous.label}, USCIS gave the ${new Intl.ListFormat(
        "en-US",
      ).format(names)} ${
        form.form
      } the same median, one figure for both; from ${
        point.label
      } each has its own.`,
    });
  });
  return breaks;
}

/** The categories (Variant.key, per form) a form's page leads with, over the
 * one with the most applications received: the one most of the form's
 * visitors are in. Most I-765s are the "all other" catch-all (students,
 * H-4 and L-2 spouses, TPS, ...) with a 3-month median, while green-card
 * applicants' work permits, a category of their own, took twice that; the
 * I-526 legacy category takes no new petitions. Immediate relatives of
 * citizens for the I-130, family-based for the I-485, advance parole for the
 * I-131 and civilians for the N-400 are also the most received, but say so,
 * so the page does not change its subject when the receipts shift. */
export const HEADLINE_CATEGORY: Record<string, string> = {
  "I-130": "immediate-relative",
  "I-131": "advance-parole",
  "I-485": "family",
  "I-526": "standalone",
  "I-765": "adjustment-of-status",
  "N-400": "civilian",
};

/** The key of all of a form's categories together, on its page, and of all
 * of a per-office report's categories together */
export const ALL_CATEGORIES = "total";

/** The numbers of one category of a form nationally (or, for
 * ALL_CATEGORIES, of all of them together), as a form page shows them. */
export interface FormView {
  key: string;
  /** "Immediate Relative", or "All categories" */
  name: string;
  points: QuarterPoint[];
  /** USCIS's median lines on the wait chart */
  processingTimeSeries: ProcessingTimeSeries[];
  /** The quarter of the last median of those lines, when USCIS has stopped
   * publishing one */
  lastMedian: string | null;
  breaks: ChartBreak[];
  /** The quarter from which the counts come from the all-forms report, when
   * the ones before it come from the per-office report's national totals */
  splitLabel: string | null;
}

/** One category's counts nationally: the all-forms report's row for it, or,
 * in quarters before that report split the form by category, the per-office
 * report's national totals for the same category, where the two mean the
 * same (NATIONAL_OFFICE_CATEGORIES). Each quarter carries the all-forms
 * report's rows, for their medians. */
export function categoryCounts(
  form: Form,
  key: string,
): {
  counts: Record<string, QuarterCounts & { variants: Variant[] }>;
  fromOfficeReport: string[];
} {
  const counts: Record<string, QuarterCounts & { variants: Variant[] }> = {};
  const fromOfficeReport: string[] = [];
  const inOfficeReport = (NATIONAL_OFFICE_CATEGORIES[form.form] ?? []).includes(
    key,
  );
  for (const [quarter, formQuarter] of Object.entries(form.quarters)) {
    const variant = formQuarter.variants.find(
      (candidate) => candidate.key === key,
    );
    const officeCounts = inOfficeReport
      ? form.officeTotals[quarter]?.categories?.[key]
      : undefined;
    if (variant !== undefined)
      counts[quarter] = { ...variant, variants: formQuarter.variants };
    else if (officeCounts !== undefined) {
      counts[quarter] = { ...officeCounts, variants: formQuarter.variants };
      fromOfficeReport.push(quarter);
    }
  }
  return { counts, fromOfficeReport };
}

/** The category a form's page is about: the form's HEADLINE_CATEGORY when
 * the newest quarter has it, otherwise the one received the most of. Null
 * for a form with one category. */
export function focusCategory(form: Form, latest: string): string | null {
  const variants = form.quarters[latest]?.variants ?? [];
  if (variants.length <= 1) return null;
  const preferred = HEADLINE_CATEGORY[form.form];
  if (variants.some(({ key }) => key === preferred)) return preferred;
  return variants.reduce((best, variant) =>
    (variant.received ?? 0) > (best.received ?? 0) ? variant : best,
  ).key;
}

/** The views of a form's page: one per category of its newest quarter, the
 * one it is about (focusCategory) first, then all categories together; just
 * the latter for a form with one category. */
export function formViews(periods: Period[], form: Form): FormView[] {
  const quarters = Object.keys(form.quarters).sort();
  const latest = quarters[quarters.length - 1];
  const variants = form.quarters[latest]?.variants ?? [];
  const focus = focusCategory(form, latest);
  const totalPoints = toPoints(periods, form.quarters);
  const total: FormView = {
    key: ALL_CATEGORIES,
    name: "All categories",
    points: totalPoints,
    processingTimeSeries: processingTimeSeries(totalPoints, form),
    lastMedian: null,
    breaks: medianBreaks(totalPoints, form),
    splitLabel: null,
  };
  total.lastMedian = lastMedianLabel(
    totalPoints,
    total.processingTimeSeries.map(({ key }) => key),
  );
  if (focus === null) return [total];
  const ordered = [
    ...variants.filter(({ key }) => key === focus),
    ...variants.filter(({ key }) => key !== focus),
  ];
  const views = ordered.map((variant): FormView => {
    const { counts, fromOfficeReport } = categoryCounts(form, variant.key);
    const points = toPoints(periods, counts, { fromOfficeReport });
    const name = categoryName(variant, form, variants.length);
    // the category's own median, and before USCIS split the form, the one
    // it gave all categories together
    const before = points.some(
      (point) =>
        point.processingTimes[variant.key] === undefined &&
        point.processingTimes.all !== undefined,
    );
    const series: ProcessingTimeSeries[] = points.some(
      (point) => point.processingTimes[variant.key] !== undefined,
    )
      ? [{ key: variant.key, label: before ? name : "" }]
      : [];
    if (before)
      series.push({
        key: "all",
        label: `${categoryName(
          { key: "all", title: form.title },
          form,
          2,
        )} (before the split)`,
      });
    const firstSplit = points.find((point) => !point.fromOfficeReport);
    const breaks = medianBreaks(points, form).filter(
      // a category's own median before separate medians is the shared one
      ({ label }) => label !== "separate medians" || series.length > 0,
    );
    return {
      key: variant.key,
      name,
      points,
      processingTimeSeries: series,
      lastMedian: lastMedianLabel(
        points,
        series.map(({ key }) => key),
      ),
      breaks,
      splitLabel:
        fromOfficeReport.length > 0 && firstSplit !== undefined
          ? firstSplit.label
          : null,
    };
  });
  return [...views, total];
}

/** The per-office report's category that the office pages of a form lead
 * with, the one most of their visitors are in: immediate relatives of US
 * citizens for the I-130, family-based for the I-485 (except at offices that
 * handle few of those, or almost never approve them: openingOfficeCategory).
 * The office pages of other forms show the total alone. */
export const LEADING_OFFICE_CATEGORY: Record<string, string> = {
  "I-130": "immediate-relative",
  "I-485": "family",
};

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

/** How an office's quarters read as points: no flow check (its pile also
 * changes as USCIS moves cases between offices), and withheld counts
 * bounded unless the form's per-office report leaves more unaccounted for
 * (UNBOUNDED_WITHHELD_FORMS). */
export function officePointOptions(form: string): {
  checkFlow: boolean;
  boundedWithheld: boolean;
} {
  return {
    checkFlow: false,
    boundedWithheld: !UNBOUNDED_WITHHELD_FORMS.includes(form),
  };
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
      points: toPoints(
        periods,
        officeCategoryCounts(quarters, category.key),
        officePointOptions(form.form),
      ),
    }))
    .filter(({ points }) => points.length > 0);
}

/** An office approves almost none of a category when fewer than this share
 * of at least RARELY_APPROVES_DECISIONS decisions were approvals: the
 * Vermont Service Center approved 5 of the 317 family-based I-485s it
 * decided in Apr–Jun 2026. Such an office screens or holds those cases; its
 * approval rate and its pace say nothing about a case's wait. */
const RARELY_APPROVES_SHARE = 0.1;
const RARELY_APPROVES_DECISIONS = 30;

/** Whether an office almost never approves the cases of a quarter's point
 * (RARELY_APPROVES_SHARE), going by exact counts. */
export function rarelyApproves(point: QuarterPoint | undefined): boolean {
  return (
    point !== undefined &&
    !point.approximate &&
    point.approvalRate !== null &&
    (point.completions ?? 0) >= RARELY_APPROVES_DECISIONS &&
    point.approvalRate < RARELY_APPROVES_SHARE
  );
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
 * in its newest quarter (`total`'s) and the office approves some of them,
 * otherwise the category the office decided the most cases of then (among
 * those it approves some of), or, if it decided none, the one with the most
 * cases pending. The I-485 service centers handle almost only
 * employment-based and "other" cases; a page leading with their few
 * family-based ones would describe a queue nobody there is in, and the
 * Vermont Service Center's pile of family-based I-485s is one it almost
 * never approves from (rarelyApproves). Nor does a page open on a category
 * with no decisions while another has some: a pile nobody is working
 * through (Potomac's 34 "other" I-485s in Apr-Jun 2026, none decided,
 * against 19 employment-based decisions) says nothing about the office's
 * pace. */
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
  const decided = (point: QuarterPoint) => point.completions ?? 0;
  const anyDecided = newest.some(({ point }) => decided(point) > 0);
  const lead = newest.find(({ key }) => key === leading)?.point;
  if (
    lead !== undefined &&
    !rarelyApproves(lead) &&
    (decided(lead) > 0 || !anyDecided) &&
    (share(lead.pending, current.pending) >= MAIN_CATEGORY_SHARE ||
      share(lead.completions, current.completions) >= MAIN_CATEGORY_SHARE ||
      decided(lead) >= MAIN_CATEGORY_DECISIONS)
  )
    return leading;
  // the most decisions, then the most pending, of the categories the office
  // approves some of
  const candidates = newest.filter(({ point }) => !rarelyApproves(point));
  const largest = (candidates.length > 0 ? candidates : newest).reduce<{
    key: string;
    point: QuarterPoint;
  } | null>(
    (best, category) =>
      best === null ||
      decided(category.point) > decided(best.point) ||
      (decided(category.point) === decided(best.point) &&
        (category.point.pending ?? 0) > (best.point.pending ?? 0))
        ? category
        : best,
    null,
  );
  return largest?.key ?? ALL_CATEGORIES;
}
