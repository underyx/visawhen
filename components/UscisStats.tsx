import { Paper, SimpleGrid, Stack, Text, Title } from "@mantine/core";
import React from "react";
import {
  backlogTrend,
  CASES_MOVED,
  CategoryRange,
  formatMedian,
  formatRangeMonths,
} from "./estimate";
import { addMonths, formatMonthRange, useToday } from "./Freshness";
import {
  approximately,
  formatChange,
  formatCount,
  formatMonths,
  formatPercent,
  QuarterPoint,
  WITHHELD_ESTIMATE,
} from "./uscis";

// a non-breaking space keeps the cards the same height when one has no
// line to show under its value
const NO_LINE = "\u00a0";

interface StatProps {
  label: string;
  value: React.ReactNode;
  /** The line under the value */
  line: string | null;
  lineColor: string;
}

function Stat({ label, value, line, lineColor }: StatProps) {
  return (
    <Paper withBorder p="md" radius="md">
      <Text size="sm" c="dimmed" fw={500}>
        {label}
      </Text>
      {typeof value === "string" ? <Title order={3}>{value}</Title> : value}
      <Text size="sm" c={lineColor}>
        {line ?? NO_LINE}
      </Text>
    </Paper>
  );
}

/** A change vs. the previous quarter, in green when it is good news and red
 * when it is bad. */
function ChangeStat({
  change,
  higherIsBetter,
  ...props
}: Omit<StatProps, "line" | "lineColor"> & {
  change: string | null;
  higherIsBetter: boolean;
}) {
  const isIncrease = change?.startsWith("+") ?? false;
  const color =
    change === null || change === "unchanged"
      ? "dimmed"
      : isIncrease === higherIsBetter
      ? "teal.8"
      : "red.8";
  return (
    <Stat
      {...props}
      line={change === null ? null : `${change} vs. previous quarter`}
      lineColor={color}
    />
  );
}

/** A range of the wait: in months while prerendering and hydrating
 * ("11-22 months"), then as the months a decision would land in if filed
 * today ("Aug 2027 - Jul 2028"). */
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

interface Props {
  points: QuarterPoint[];
  /** The range the page leads with, when it has one */
  headline?: CategoryRange | null;
  /** Why the time to clear the backlog is not shown, when it is not */
  backlogSuppressed?: string | null;
}

/** The headline figures of the newest quarter: what to expect if filing
 * today, when there is a range for it, then the backlog and the quarter's
 * decisions, with their change since the quarter before. */
export default function UscisStats({
  points,
  headline = null,
  backlogSuppressed = null,
}: Props) {
  const current = points[points.length - 1];
  const previous = points[points.length - 2];
  const trend = backlogTrend(previous?.waitMonths, current.waitMonths);
  const pendingChange = formatChange(previous?.pending, current.pending);
  // which decisions USCIS withheld as too few to disclose, when it did
  const withheld =
    current.approved === null && current.denied === null
      ? "Approvals and denials"
      : current.approved === null
      ? "Approvals"
      : "Denials";
  return (
    <Stack gap="sm">
      {headline !== null && (
        <Paper withBorder p="md" radius="md">
          <Text size="sm" c="dimmed" fw={500}>
            {`If you file today (${headline.name})`}
          </Text>
          <Title order={3}>
            <RangeText low={headline.q[1]} high={headline.q[3]} />
          </Title>
          <Text size="sm" c="dimmed">
            could be <RangeText low={headline.q[0]} high={headline.q[4]} />
          </Text>
          <Text size="sm" c="dimmed">
            {`USCIS median ${formatMedian(headline.median)} · ${
              current.label
            } data`}
          </Text>
        </Paper>
      )}
      <SimpleGrid cols={{ base: 2, sm: 4 }} spacing="sm">
        <Stat
          label="Time to clear backlog"
          value={
            backlogSuppressed === null ? (
              approximately(
                formatMonths(current.waitMonths),
                current.approximate,
              )
            ) : (
              <Text fw={700} lh={1.3}>
                {`Not shown: ${backlogSuppressed}`}
              </Text>
            )
          }
          line={
            backlogSuppressed === null && trend !== null
              ? `${trend} vs. previous quarter`
              : null
          }
          lineColor="dimmed"
        />
        {backlogSuppressed === CASES_MOVED && pendingChange !== null ? (
          // not good or bad news: cases moved, the office did not fall
          // behind or catch up
          <Stat
            label="Pending applications"
            value={formatCount(current.pending)}
            line={
              pendingChange === "unchanged"
                ? pendingChange
                : `${pendingChange}, cases moved ${
                    pendingChange.startsWith("+") ? "in" : "out"
                  }`
            }
            lineColor="dimmed"
          />
        ) : (
          <ChangeStat
            label="Pending applications"
            value={formatCount(current.pending)}
            change={pendingChange}
            higherIsBetter={false}
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
        ) : (
          <ChangeStat
            label={`Decided in ${current.label}`}
            value={formatCount(current.completions)}
            change={formatChange(previous?.completions, current.completions)}
            higherIsBetter={true}
          />
        )}
        <ChangeStat
          label="Approval rate"
          value={approximately(
            formatPercent(current.approvalRate),
            current.approximate,
          )}
          change={
            current.approvalRate === null ||
            previous?.approvalRate === null ||
            previous?.approvalRate === undefined
              ? null
              : formatChange(
                  Math.round(previous.approvalRate * 100),
                  Math.round(current.approvalRate * 100),
                )
          }
          higherIsBetter={true}
        />
      </SimpleGrid>
    </Stack>
  );
}
