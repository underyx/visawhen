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
  formatChange,
  formatCount,
  formatMonths,
  formatPercent,
  QuarterPoint,
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
              formatMonths(current.waitMonths)
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
            line={`${pendingChange}, cases moved ${
              pendingChange.startsWith("+") ? "in" : "out"
            }`}
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
          // USCIS withholds small counts: the approvals are what is known
          <Stat
            label={`Approved in ${current.label}`}
            value={formatCount(current.approved)}
            line="USCIS withheld the denials"
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
          value={formatPercent(current.approvalRate)}
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
