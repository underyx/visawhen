import type { Period, QuarterCounts } from "../api/n400";

/** One quarter of an office's (or the nation's) N-400 numbers, with the
 * derived figures the pages and charts show. */
export interface QuarterPoint extends QuarterCounts {
  quarter: string;
  /** "Jul–Sep 2025" */
  label: string;
  /** Decisions made in the quarter: approvals plus denials */
  completions: number | null;
  /** Months it would take to decide every pending application at the
   * quarter's pace of decisions */
  waitMonths: number | null;
  /** Share of the quarter's decisions that were approvals, 0-1 */
  approvalRate: number | null;
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

export function toPoints(
  periods: Period[],
  counts: Record<string, QuarterCounts>,
): QuarterPoint[] {
  return periods
    .filter((period) => counts[period.quarter] !== undefined)
    .map((period) => {
      const { received, approved, denied, pending } = counts[period.quarter];
      const completions =
        approved === null || denied === null ? null : approved + denied;
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
      };
    });
}

export function formatMonths(months: number | null): string {
  if (months === null) return "n/a";
  return `${months < 10 ? months.toFixed(1) : Math.round(months)} months`;
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

/** The one-sentence quarter-over-quarter summary shown above the charts. */
export function highlight(points: QuarterPoint[], subject: string): string {
  const current = points[points.length - 1];
  const previous = points[points.length - 2];
  if (current === undefined) return "";
  const sentences: string[] = [];
  const pendingChange = formatChange(previous?.pending, current.pending);
  if (pendingChange !== null && current.pending !== null) {
    sentences.push(
      `The pile of pending N-400 applications at ${subject} ${
        pendingChange === "unchanged"
          ? "stayed at"
          : pendingChange.startsWith("+")
          ? `grew ${pendingChange.slice(1)} to`
          : `shrank ${pendingChange.slice(1)} to`
      } ${formatCount(current.pending)} in ${current.label}.`,
    );
  }
  if (current.waitMonths !== null) {
    const previousWait =
      previous?.waitMonths === null || previous?.waitMonths === undefined
        ? ""
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
