import { NvcSeries } from "../api/nvc";
import { addDays, daysBetween, formatShortDate } from "./Freshness";
import { NVC_TIMEFRAMES_URL } from "./links";

import { Paper } from "@mantine/core";
import { curveMonotoneX } from "@visx/curve";
import { scaleLinear, scaleUtc } from "@visx/scale";
import { LinePath } from "@visx/shape";
import { useState } from "react";
import {
  ChartHeader,
  Dot,
  formatDateTick,
  lonePoints,
  Plot,
  RangeButtons,
  thin,
  TooltipLine,
  useChartWidth,
  XAxis,
  YAxis,
} from "./Chart";

interface Props {
  series: NvcSeries;
  id: string;
}

const dateFormatter = new Intl.DateTimeFormat("en-US", {
  month: "short",
  year: "numeric",
  day: "numeric",
  timeZone: "UTC",
});

/** Mantine's blue.7: 4.2:1 against the white of the chart, where lines need
 * 3:1 */
const LINE_COLOR = "#1c7ed6";

/** Readings further apart than this, three weeks, have several weeks with no
 * reading between them, which the chart shows as a break in the line instead
 * of joining the readings across it. Shorter gaps, a missing week or two, are
 * joined, as the caption says. */
const MAX_GAP_DAYS = 21;

/** How far back the chart goes at first: a year of weekly readings */
const FIRST_DAYS = 365;

const HEIGHT = 300;
const MARGIN = { top: 28, right: 12, bottom: 28, left: 36 };

/** A point of the line: [date, days], or [date, null] for a break in it */
type Point = [string, number | null];

/** The readings, with a break wherever weeks of readings are missing */
function chartPoints(series: NvcSeries): Point[] {
  const points: Point[] = [];
  let previous: string | null = null;
  for (const [date, days] of Object.entries(series)) {
    if (previous !== null) {
      const gap = daysBetween(previous, date);
      if (gap > MAX_GAP_DAYS)
        points.push([addDays(previous, Math.round(gap / 2)), null]);
    }
    points.push([date, days]);
    previous = date;
  }
  return points;
}

function Tooltip({ point: [date, backlogDays] }: { point: Point }) {
  if (backlogDays === null) return <>No readings for these weeks</>;
  // Date arithmetic on the ISO strings: date-fns would add days in the
  // visitor's time zone, and land on the wrong day across a DST change.
  const processingDate = addDays(date, -backlogDays);
  return (
    <>
      <TooltipLine>
        {backlogDays} days of backlog on {dateFormatter.format(new Date(date))}
      </TooltipLine>
      <TooltipLine>
        (processed up to {dateFormatter.format(new Date(processingDate))})
      </TooltipLine>
    </>
  );
}

/** What the chart shows, in words, for screen readers: its span and the last
 * eight readings. */
function describe(id: string, series: NvcSeries): string {
  const readings = Object.entries(series);
  const recent = readings
    .slice(-8)
    .map(([date, days]) => `${formatShortDate(date)}: ${days} days`)
    .join("; ");
  return `Line chart of NVC ${id} times, ${formatShortDate(
    readings[0][0],
  )} to ${formatShortDate(
    readings[readings.length - 1][0],
  )}. The last 8 readings: ${recent}.`;
}

export default function NvcChart({ id, series }: Props) {
  const [boxRef, width] = useChartWidth();
  const [range, setRange] = useState(0);
  const all = chartPoints(series);
  const from = addDays(all[all.length - 1][0], -FIRST_DAYS);
  const points = range === 0 ? all.filter(([date]) => date >= from) : all;
  const plotWidth = width - MARGIN.left - MARGIN.right;
  const plotHeight = HEIGHT - MARGIN.top - MARGIN.bottom;
  const x = scaleUtc({
    domain: [new Date(points[0][0]), new Date(points[points.length - 1][0])],
    range: [0, plotWidth],
  });
  const y = scaleLinear({
    domain: [0, Math.max(1, ...points.map(([, days]) => days ?? 0))],
    range: [plotHeight, 0],
    nice: true,
  });
  const xs = points.map(([date]) => x(new Date(date)));
  const lone = lonePoints(points.map(([, days]) => days));
  const ticks = x.ticks(Math.max(2, Math.floor(plotWidth / 48)));
  return (
    <Paper withBorder p="md" mx={0} component="figure">
      <ChartHeader
        title={`Change in ${id} processing times`}
        range={
          all[0][0] < from && (
            <RangeButtons
              labels={["Last year", "All years"]}
              value={range}
              onChange={setRange}
            />
          )
        }
      />
      <Plot
        boxRef={boxRef}
        width={width}
        height={HEIGHT}
        margin={MARGIN}
        description={describe(id, series)}
        xs={xs}
        tooltip={(index) => <Tooltip point={points[index]} />}
      >
        {(picked) => (
          <>
            <YAxis
              ticks={y.ticks(4)}
              y={y}
              width={plotWidth}
              format={String}
              unit="days"
              left={MARGIN.left}
            />
            <XAxis
              ticks={thin(
                ticks.map((tick) => ({
                  x: x(tick),
                  label: formatDateTick(tick),
                })),
              )}
              y={plotHeight}
              width={plotWidth}
            />
            <LinePath<Point>
              data={points}
              x={([date]) => x(new Date(date))}
              y={([, days]) => y(days ?? 0)}
              defined={([, days]) => days !== null}
              curve={curveMonotoneX}
              stroke={LINE_COLOR}
              strokeWidth={2}
              strokeLinejoin="round"
              strokeLinecap="round"
              fill="none"
            />
            {[...lone, ...(picked === null ? [] : [picked])].map(
              (index, order) => {
                const days = points[index][1];
                return (
                  days !== null && (
                    <Dot
                      key={order}
                      x={xs[index]}
                      y={y(days)}
                      color={LINE_COLOR}
                    />
                  )
                );
              },
            )}
          </>
        )}
      </Plot>
      <figcaption>
        Source: <a href={NVC_TIMEFRAMES_URL}>NVC Timeframes page</a>
        .<br />
        The weekly readings are stored in a{" "}
        <a href="https://github.com/underyx/visawhen/blob/main/data/nvc/data.json">
          JSON file on GitHub
        </a>
        . Breaks in the line are stretches of several weeks with no readings;
        where a week or two is missing, the line joins the readings on either
        side.
      </figcaption>
    </Paper>
  );
}
