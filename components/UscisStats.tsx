import { Stack, Text } from "@mantine/core";
import React from "react";
import { CategoryRange, formatMedian, formatRangeMonths } from "./estimate";
import { addMonths, formatMonthRange, useToday } from "./Freshness";
import { NotShown, Stat, StatProps, Stats } from "./Stats";
import {
  approvalRatesComparable,
  approximately,
  backlogTrend,
  formatApprovalRate,
  formatChange,
  formatCount,
  formatMonths,
  formatPointChange,
  MIN_CHANGE_BASE,
  pendingChangeReliable,
  QuarterPoint,
  Span,
  stalled,
  WITHHELD_ESTIMATE,
  WITHHELD_RANGE,
} from "./uscis";
import classes from "./UscisStats.module.css";

const tooFewToCompare = (period: Span) =>
  `too few to compare with the ${period} before`;
const stalledBefore = (period: Span) =>
  `not compared: USCIS nearly stopped deciding these the ${period} before`;

/** A change vs. the previous quarter (or month), in green when it is good
 * news and red when it is bad; the darkest shades, as the lighter ones are
 * below 4.5:1 on the white card (teal.8 is 3.9:1, teal.9 5.0:1). `fallback`
 * is the line when there is no change to show. */
function ChangeStat({
  change,
  higherIsBetter,
  fallback = null,
  period,
  ...props
}: Omit<StatProps, "line" | "lineColor"> & {
  change: string | null;
  higherIsBetter: boolean;
  fallback?: string | null;
  period: Span;
}) {
  const isIncrease = change?.startsWith("+") ?? false;
  const color =
    change === null || change === "unchanged"
      ? "dimmed"
      : isIncrease === higherIsBetter
      ? "teal.9"
      : "red.9";
  return (
    <Stat
      {...props}
      line={change === null ? fallback : `${change} vs. previous ${period}`}
      lineColor={color}
    />
  );
}

/** A range of the wait: in months while prerendering and hydrating
 * ("11–22 months"), then as the months a decision would land in if filed
 * today ("Aug 2027 – Jul 2028"). */
export function RangeText({ low, high }: { low: number; high: number }) {
  const today = useToday();
  return (
    <>
      {today === null
        ? formatRangeMonths(low, high)
        : formatMonthRange(addMonths(today, low), addMonths(today, high))}
    </>
  );
}

/** Why a point has no time to clear the backlog, when it is for want of a
 * number: USCIS did not publish one it needs, or decided nothing. */
function clearingUnknown(point: QuarterPoint, period: Span): string | null {
  if (point.waitMonths !== null) return null;
  if (point.pending === null) return "USCIS did not publish the pending count";
  if (point.completions === null)
    return point.approved === null && point.denied === null
      ? "USCIS did not publish the decisions"
      : point.approved === null
      ? "USCIS did not publish the approvals"
      : "USCIS did not publish the denials";
  if (point.completions === 0) return `no decisions that ${period}`;
  return null;
}

/** Whether two counts are both known but one is below MIN_CHANGE_BASE, so
 * their change says nothing. */
function tooSmallToCompare(
  previous: number | null | undefined,
  current: number | null,
): boolean {
  return (
    previous !== null &&
    previous !== undefined &&
    current !== null &&
    (previous < MIN_CHANGE_BASE || current < MIN_CHANGE_BASE)
  );
}

interface Props {
  points: QuarterPoint[];
  /** The range the page leads with, when it has one */
  headline?: CategoryRange | null;
  /** Why the time to clear the backlog is not shown, when it is not */
  backlogSuppressed?: string | null;
  /** Whether USCIS moved cases in or out in the newest quarter: the pile,
   * and the time to clear it, then include (or leave out) those cases */
  moved?: "in" | "out" | null;
  /** Whether the office almost never approves these cases (rarelyApproves):
   * no approval rate or time to clear then */
  rarelyApproved?: boolean;
  /** What each point covers: a quarter, or a month for USCIS's monthly
   * numbers (monthPoints) */
  period?: Span;
  /** The period of the median the headline range is based on, when the
   * points are newer than it: "Apr–Jun 2026" */
  medianLabel?: string;
}

/** The headline figures of the newest quarter (or month): what to expect if
 * filing today, when there is a range for it, then the backlog and the
 * period's decisions, with their change since the one before where it means
 * something: not for counts too small to compare (MIN_CHANGE_BASE), a
 * pending count that filings and decisions do not account for
 * (pendingChangeReliable), cases moved between offices, or an approval rate
 * worked out from a count USCIS withheld. */
export default function UscisStats({
  points,
  headline = null,
  backlogSuppressed = null,
  moved = null,
  rarelyApproved = false,
  period = "quarter",
  medianLabel,
}: Props) {
  const current = points[points.length - 1];
  const previous = points[points.length - 2];
  const reliable = pendingChangeReliable(current);
  // USCIS had nearly stopped deciding these the quarter before: no change
  // from it means anything
  const previousStalled = stalled(points, points.length - 2);
  const trend =
    reliable && !previousStalled
      ? backlogTrend(previous?.waitMonths, current.waitMonths)
      : null;
  const pendingChange = formatChange(
    previous?.pending,
    current.pending,
    MIN_CHANGE_BASE,
  );
  const notShown = rarelyApproved
    ? "the office almost never approves these"
    : backlogSuppressed ?? clearingUnknown(current, period);
  // which decisions USCIS withheld as too few to disclose, when it did
  const withheld =
    current.approved === null && current.denied === null
      ? "Approvals and denials"
      : current.approved === null
      ? "Approvals"
      : "Denials";
  const [withheldLow, withheldHigh] = WITHHELD_RANGE;
  return (
    <Stack gap="lg">
      {headline !== null && (
        <div className={classes.estimate}>
          <div className={classes.stamp}>
            <div className={classes.stampLabel}>
              {`If you file today (${headline.name}), most likely`}
            </div>
            <div className={classes.stampRange}>
              <RangeText low={headline.q[1]} high={headline.q[3]} />
            </div>
            <div className={classes.stampFoot}>
              could be <RangeText low={headline.q[0]} high={headline.q[4]} />
            </div>
          </div>
          <Stack gap={6} className={classes.aside}>
            <Text size="sm">
              {`Based on USCIS's median time of ${formatMedian(
                headline.median,
              )} (${
                medianLabel ?? current.label
              } data) and on how much real waits differed from it in the past.`}
            </Text>
            {headline.premium && (
              <Text size="sm" c="dimmed">
                Premium and regular processing together: with premium
                processing, USCIS acts within weeks.
              </Text>
            )}
          </Stack>
        </div>
      )}
      <Stats>
        <Stat
          label="Time to clear backlog"
          value={
            notShown === null ? (
              approximately(
                formatMonths(current.waitMonths),
                current.approximate,
              )
            ) : (
              <NotShown>{`Not shown: ${notShown}`}</NotShown>
            )
          }
          line={
            notShown !== null
              ? null
              : moved === "in"
              ? "includes cases moved or routed here"
              : moved === "out"
              ? "after USCIS moved cases away"
              : trend !== null
              ? `${trend} vs. previous ${period}`
              : null
          }
          lineColor="dimmed"
        />
        {moved !== null && pendingChange !== null ? (
          // not good or bad news: cases moved, the office did not fall
          // behind or catch up
          <Stat
            label="Pending applications"
            value={formatCount(current.pending)}
            line={
              pendingChange === "unchanged"
                ? pendingChange
                : `${pendingChange}, cases moved ${
                    moved === "in" ? "or routed in" : "out"
                  }`
            }
            lineColor="dimmed"
          />
        ) : !reliable && pendingChange !== null ? (
          // a change the quarter's filings and decisions do not account for
          <Stat
            label="Pending applications"
            value={formatCount(current.pending)}
            line={`${pendingChange}, more than ${
              pendingChange.startsWith("+") ? "filings" : "decisions"
            } explain`}
            lineColor="dimmed"
          />
        ) : (
          <ChangeStat
            label="Pending applications"
            value={formatCount(current.pending)}
            change={pendingChange}
            higherIsBetter={false}
            period={period}
            fallback={
              tooSmallToCompare(previous?.pending, current.pending)
                ? tooFewToCompare(period)
                : null
            }
          />
        )}
        {current.completions === null && current.approved !== null ? (
          // the approvals are what is known
          <Stat
            label={`Approved in ${current.label}`}
            value={formatCount(current.approved)}
            line="USCIS did not publish the denials"
            lineColor="dimmed"
          />
        ) : current.approximate ? (
          // USCIS withholds counts too small to disclose
          <Stat
            label={`Decided in ${current.label}`}
            value={approximately(formatCount(current.completions), true)}
            line={`${withheld} withheld by USCIS as too few, counted as ${WITHHELD_ESTIMATE}${
              withheld === "Approvals and denials" ? " each" : ""
            }`}
            lineColor="dimmed"
          />
        ) : current.completions === null ? (
          <Stat
            label={`Decided in ${current.label}`}
            value="n/a"
            line="USCIS did not publish them"
            lineColor="dimmed"
          />
        ) : rarelyApproved ? (
          // more decisions of cases the office almost never approves are no
          // good news
          <Stat
            label={`Decided in ${current.label}`}
            value={formatCount(current.completions)}
            line="nearly all of them denials"
            lineColor="dimmed"
          />
        ) : (
          <ChangeStat
            label={`Decided in ${current.label}`}
            value={formatCount(current.completions)}
            change={
              previousStalled
                ? null
                : formatChange(
                    previous?.completions,
                    current.completions,
                    MIN_CHANGE_BASE,
                  )
            }
            higherIsBetter={true}
            period={period}
            fallback={
              previousStalled
                ? stalledBefore(period)
                : tooSmallToCompare(previous?.completions, current.completions)
                ? tooFewToCompare(period)
                : null
            }
          />
        )}
        {rarelyApproved ? (
          <Stat
            label="Approval rate"
            value={<NotShown>Not shown: almost none approved</NotShown>}
            line={`${formatCount(current.approved)} of ${formatCount(
              current.completions,
            )} decisions were approvals`}
            lineColor="dimmed"
          />
        ) : (
          <ChangeStat
            label="Approval rate"
            value={formatApprovalRate(current)}
            change={
              approvalRatesComparable(previous, current, previousStalled)
                ? formatPointChange(
                    previous?.approvalRate,
                    current.approvalRate,
                  )
                : null
            }
            higherIsBetter={true}
            period={period}
            fallback={
              current.approximate
                ? current.approvalRange === null
                  ? `USCIS withheld the ${withheld.toLowerCase()} as too few`
                  : `range: USCIS withheld the ${withheld.toLowerCase()} as too few (${withheldLow} to ${withheldHigh})`
                : current.approvalRate === null ||
                  previous === undefined ||
                  previous.approvalRate === null
                ? null
                : previousStalled
                ? stalledBefore(period)
                : previous.approximate
                ? `the ${period} before's is approximate`
                : `too few decisions to compare with the ${period} before`
            }
          />
        )}
      </Stats>
    </Stack>
  );
}
