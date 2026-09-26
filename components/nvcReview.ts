import type { NvcSeries } from "../api/nvc";
import { addDays, daysBetween } from "./Freshness";

// When NVC will review documents submitted on a date, and when not to say.
// Everything the /nvc estimate rests on is in this file.
//
// NVC reviews documents in the order they came in, and each weekly reading
// says which submission date it has reached (its "front": the as-of date
// minus the days). Two things can be read from that:
//
// - the queue as it is now: documents submitted on a date are reached as
//   many days after it as NVC's newest review time, if the queue neither
//   grows nor shrinks;
// - NVC's pace: how many days' worth of submissions its front moved over the
//   last four weeks or more. If the queue grows, this reaches the documents
//   later than the first; if it shrinks, sooner.
//
// The range covers both, plus a margin of a week or 40% of the wait,
// whichever is longer, on each side. NVC has also moved in bursts: in June
// 2026 its front jumped four weeks in one week and then sat still for five,
// and right after such a jump its day count is low. So when the front stood
// still for a week in the last six, the range also reaches to the longest
// review time NVC showed in those six weeks.
//
// Provenance: a backtest over NVC's own review timeframes since November
// 2020 (data/nvc/data.json), run on this file's code by
// data/nvc/backtest.mjs (`yarn node data/nvc/backtest.mjs`), for documents
// submitted on each day for which the page would show an estimate (newest
// reading at most 14 days old, the front not stalled), with the range
// starting no earlier than that day, as the page shows it. When NVC reached
// them is known from its later readings, to within the days between two
// readings; the check counts the days where that is a week or so, and
// whether the middle of it fell in the range. From November 2020 to July
// 2026, 1652 such days: 94.7% of reviews fell in the range, 3.4% later and
// 1.9% sooner. On the 125 of them when the queue was growing (its review
// time at least GROWTH_DAYS longer than four weeks before), 83.2% fell in
// the range, none later and 16.8% sooner. The 84 days after a gap in the
// readings all fell in the range, but none of them was in a growing queue,
// so the page claims nothing then. The same check on the estimate this
// replaced (the newest review time, a week or 40% either side, a stall
// check over three readings) gave 91.1% over 1761 days, and 70.7% while
// the queue grew, with 14.4% later. Any change to the rules or numbers here
// needs the backtest rerun.

/** A reading: its as-of date and its number of days */
export type Reading = [string, number];

/** Readings further apart than this are not consecutive weekly updates. */
export const MAX_UPDATE_GAP_DAYS = 21;
/** A front that moved no more than this between readings stood still. */
export const STALL_DAYS = 3;
/** NVC's pace is measured over at least this many days. */
export const PACE_WINDOW_DAYS = 28;
/** The window, six weeks, in which a still week means NVC moves in bursts,
 * and whose longest review time the range then reaches to. */
export const BURST_WINDOW_DAYS = 42;
/** A queue whose review time is this many days longer than at the start of
 * the pace window is growing. */
export const GROWTH_DAYS = 7;
/** The margin on each side: a week, or this share of the wait. */
export const MARGIN_DAYS = 7;
export const MARGIN_SHARE = 0.4;
/** A pace below this many days of submissions per day is no pace at all. */
const MIN_PACE = 0.05;

/** The newest submission date NVC had reached on a reading */
export function front([date, days]: Reading): string {
  return addDays(date, -days);
}

export function readings(series: NvcSeries): Reading[] {
  return Object.entries(series);
}

/** Where the front stood over its latest readings, when it has barely moved:
 * the longest run of consecutive readings, ending with the newest, over which
 * the front moved no more than STALL_DAYS. Its N days then only measure how
 * old a queue that is not moving is, and grow week by week (in June and July
 * 2026, document review sat at June 8-10 for five weeks while its days went
 * from 7 to 33). Null while the front moves. */
export function getStall(
  series: NvcSeries,
): { from: Reading; to: Reading } | null {
  const all = readings(series);
  const last = all[all.length - 1];
  let start = all.length - 1;
  while (
    start > 0 &&
    daysBetween(all[start - 1][0], all[start][0]) <= MAX_UPDATE_GAP_DAYS &&
    daysBetween(front(all[start - 1]), front(last)) <= STALL_DAYS
  )
    start--;
  return start === all.length - 1 ? null : { from: all[start], to: last };
}

/** The newest reading at least `days` before the newest one, or null */
function readingBefore(all: Reading[], days: number): Reading | null {
  const [latest] = all[all.length - 1];
  for (let index = all.length - 2; index >= 0; index--)
    if (daysBetween(all[index][0], latest) >= days) return all[index];
  return null;
}

export interface ReviewRange {
  /** The newest reading */
  latest: Reading;
  /** The estimate if the queue stays as long as it is now */
  queueDate: string;
  /** NVC's pace: the reading it is measured from, and the estimate at that
   * pace; null when there is no reading far enough back */
  pace: { from: Reading; date: string } | null;
  /** The longest review time of the last six weeks, when NVC moved in
   * bursts in them and it reaches further than the estimates */
  burstDays: number | null;
  /** The range */
  lower: string;
  upper: string;
  /** Whether the review time grew by GROWTH_DAYS or more over the pace
   * window */
  growing: boolean;
  /** Two readings over the pace and burst windows that are not consecutive
   * weekly updates, when there are: [the earlier, the later] */
  gap: [string, string] | null;
}

/** When NVC will most likely reach documents submitted on a date after the
 * front of its newest reading: null when the front has stalled, as there is
 * then no pace to go by. */
export function reviewRange(
  series: NvcSeries,
  submitted: string,
): ReviewRange | null {
  if (getStall(series) !== null) return null;
  const all = readings(series);
  const latest = all[all.length - 1];
  const [latestDate, latestDays] = latest;
  const latestFront = front(latest);

  const queueDate = addDays(submitted, latestDays);
  let pace: ReviewRange["pace"] = null;
  const paceFrom = readingBefore(all, PACE_WINDOW_DAYS);
  if (paceFrom !== null) {
    const perDay =
      daysBetween(front(paceFrom), latestFront) /
      daysBetween(paceFrom[0], latestDate);
    if (perDay > MIN_PACE)
      pace = {
        from: paceFrom,
        date: addDays(
          latestDate,
          Math.round(daysBetween(latestFront, submitted) / perDay),
        ),
      };
  }
  const ends = [queueDate, ...(pace === null ? [] : [pace.date])].sort();
  let [low, high] = [ends[0], ends[ends.length - 1]];

  // bursts: a still week among the readings of the last six weeks
  const recent = all.filter(
    ([date]) => daysBetween(date, latestDate) <= BURST_WINDOW_DAYS,
  );
  let burstDays: number | null = null;
  for (let index = 1; index < recent.length; index++)
    if (
      daysBetween(recent[index - 1][0], recent[index][0]) <=
        MAX_UPDATE_GAP_DAYS &&
      daysBetween(front(recent[index - 1]), front(recent[index])) <= STALL_DAYS
    ) {
      const longest = Math.max(...recent.map(([, days]) => days));
      const burstDate = addDays(submitted, longest);
      if (burstDate > high) {
        burstDays = longest;
        high = burstDate;
      }
      break;
    }

  const margin = (end: string) =>
    Math.max(
      MARGIN_DAYS,
      Math.round(MARGIN_SHARE * daysBetween(submitted, end)),
    );
  const lower = addDays(low, -margin(low));
  const upper = addDays(high, margin(high));

  // the readings the pace and bursts rest on, and the one before them
  const windowStart = readingBefore(
    all,
    Math.max(PACE_WINDOW_DAYS, BURST_WINDOW_DAYS),
  );
  const span = all.filter(
    ([date]) => windowStart === null || date >= windowStart[0],
  );
  let gap: [string, string] | null = null;
  for (let index = 1; index < span.length; index++)
    if (daysBetween(span[index - 1][0], span[index][0]) > MAX_UPDATE_GAP_DAYS)
      gap = [span[index - 1][0], span[index][0]];

  const growing = paceFrom !== null && latestDays >= paceFrom[1] + GROWTH_DAYS;

  return {
    latest,
    queueDate,
    pace,
    burstDays,
    lower,
    upper,
    growing,
    gap,
  };
}
