import type { Period, QuarterCounts, Variant } from "../api/uscis";

/** One quarter of a form's (or an office's) numbers, with the derived figures
 * the pages and charts show. */
export interface QuarterPoint extends QuarterCounts {
  quarter: string;
  /** "Jul–Sep 2025" */
  label: string;
  /** Decisions made in the quarter: approvals plus denials */
  completions: number | null;
  /** Months it would take to decide every pending application at the
   * quarter's pace of decisions: the time to clear the backlog, not a wait */
  waitMonths: number | null;
  /** Share of the quarter's decisions that were approvals, 0-1 */
  approvalRate: number | null;
  /** USCIS's own median processing time in months, per category of the form */
  processingTimes: Record<string, number>;
}

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
      const completions =
        approved === null || denied === null ? null : approved + denied;
      const processingTimes: Record<string, number> = {};
      for (const variant of quarter?.variants ?? [])
        if (variant.processingTime !== null)
          processingTimes[variant.title] = variant.processingTime;
      return {
        quarter: period.quarter,
        label: quarterLabel(period),
        received,
        approved,
        denied,
        pending,
        completions,
        waitMonths:
          completions === null || completions === 0 || pending === null
            ? null
            : pending / (completions / 3),
        approvalRate:
          completions === null || completions === 0 || approved === null
            ? null
            : approved / completions,
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
      `At that quarter's pace of decisions, clearing it would take ${formatMonths(
        current.waitMonths,
      )}${previousWait}.`,
    );
  }
  return sentences.join(" ");
}

/** One line of USCIS's median processing time on the wait chart. */
export interface ProcessingTimeSeries {
  /** The all-forms report's row title, the key into `processingTimes` */
  title: string;
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

/** Names for categories whose row title has no short name in it. USCIS
 * titles a form's main category after the form itself ("Standard" by
 * variantLabel), which says nothing next to the form's other categories;
 * the I-131 rows are all long titles; "All Other" reads like a fragment. */
const CATEGORY_NAMES: Record<string, string> = {
  "Application for Advance Parole Document for Aliens Inside the United States":
    "Advance Parole",
  "Application for Travel Documents, Parole Documents, and Arrival/Departure Records":
    "Other Travel Documents",
  "Application for Initial Parole Document for Aliens Outside the United States":
    "Initial Parole (outside the US)",
  "Application for Naturalization": "Civilian",
  "Immigrant Petition by Standalone Investor": "Standalone Investor",
  "Application for Employment Authorization (All Other)": "Other Categories",
};

/** What the pages call a category of a form: the form number when the form
 * has only the one category in the quarter (`categoryCount`, counting every
 * row, with a median or not), otherwise a short name that tells it apart
 * from the others, falling back to the full row title. */
export function categoryName(
  title: string,
  form: { form: string; title: string },
  categoryCount: number,
): string {
  if (categoryCount === 1) return form.form;
  const named = CATEGORY_NAMES[title];
  if (named !== undefined) return named;
  const label = variantLabel(title, form.title);
  return label === "Standard" ? title : label;
}

/** The categories of a form whose USCIS median processing time is worth a
 * line on the chart: the ones with the most received in the newest quarter,
 * at most four so the legend stays readable. */
export function processingTimeSeries(
  points: QuarterPoint[],
  variants: Variant[],
  form: { form: string; title: string },
): ProcessingTimeSeries[] {
  const titles = [...variants]
    .filter((variant) => variant.processingTime !== null)
    .sort((a, b) => (b.received ?? 0) - (a.received ?? 0))
    .map((variant) => variant.title)
    .slice(0, 4);
  return titles
    .filter((title) =>
      points.some((point) => point.processingTimes[title] !== undefined),
    )
    .map((title) => ({
      title,
      label:
        variants.length === 1 ? "" : categoryName(title, form, variants.length),
    }));
}
