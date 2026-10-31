import { type NvcSeries } from "../api/nvc";
import {
  addDays,
  daysBetween,
  formatDateRange,
  formatShortDate,
} from "./Freshness";
import { NVC_TIMEFRAMES_URL } from "./links";
import { type Gap, gaps, readings } from "./nvcReview";

import { Paper } from "@mantine/core";
import { curveMonotoneX } from "@visx/curve";
import { scaleLinear, scaleUtc } from "@visx/scale";
import { LinePath } from "@visx/shape";
import { useState } from "react";
import {
  ChartHeader,
  DASHES,
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

/** How far back the chart goes at first: a year of weekly readings */
const FIRST_DAYS = 365;

const HEIGHT = 300;
const MARGIN = { top: 28, right: 12, bottom: 28, left: 36 };

/** A point of the line: a reading, or the middle of a gap in the readings
 * (nvcReview's gaps: weeks when VisaWhen was not recording NVC's numbers).
 * Across a gap the line is dashed, a straight guess from the reading before
 * it to the one after, and picking the gap's middle says what it is. A
 * missed week or two is no gap: the line joins the readings as usual. */
type Point =
  | { date: string; days: number; gap: null }
  | { date: string; days: null; gap: Gap };

/** The readings and the gaps between them, oldest first */
function chartPoints(series: NvcSeries): Point[] {
  const points: Point[] = [
    ...readings(series).map(
      ([date, days]): Point => ({ date, days, gap: null }),
    ),
    ...gaps(series).map(
      (gap): Point => ({
        date: addDays(
          gap.from[0],
          Math.round(daysBetween(gap.from[0], gap.to[0]) / 2),
        ),
        days: null,
        gap,
      }),
    ),
  ];
  return points.sort((a, b) => a.date.localeCompare(b.date));
}

function Tooltip({ point }: { point: Point }) {
  if (point.gap !== null) {
    const { from, to } = point.gap;
    return (
      <>
        <TooltipLine>
          No data: {formatDateRange({ low: from[0], high: to[0] })}
        </TooltipLine>
        <TooltipLine>
          VisaWhen was not recording NVC&rsquo;s numbers then.
        </TooltipLine>
      </>
    );
  }
  const { date, days: backlogDays } = point;
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

/** What the chart shows, in words, for screen readers: its span, the weeks
 * with no readings and the last eight readings. */
function describe(id: string, series: NvcSeries): string {
  const all = readings(series);
  const span = formatDateRange({
    low: all[0][0],
    high: all[all.length - 1][0],
  });
  const missing = gaps(series)
    .map(({ from, to }) => formatDateRange({ low: from[0], high: to[0] }))
    .join("; ");
  const recent = all
    .slice(-8)
    .map(([date, days]) => `${formatShortDate(date)}: ${days} days`)
    .join("; ");
  return (
    `Line chart of NVC ${id} times, ${span}.` +
    (missing === "" ? "" : ` No data for ${missing}.`) +
    ` The last 8 readings: ${recent}.`
  );
}

export default function NvcChart({ id, series }: Props) {
  const [boxRef, width] = useChartWidth();
  const [range, setRange] = useState(0);
  const all = chartPoints(series);
  const from = addDays(all[all.length - 1].date, -FIRST_DAYS);
  // a gap is shown with the readings on either side of it, or not at all
  const points =
    range === 0
      ? all.filter(
          (point) =>
            (point.gap === null ? point.date : point.gap.from[0]) >= from,
        )
      : all;
  const plotWidth = width - MARGIN.left - MARGIN.right;
  const plotHeight = HEIGHT - MARGIN.top - MARGIN.bottom;
  const x = scaleUtc({
    domain: [
      new Date(points[0].date),
      new Date(points[points.length - 1].date),
    ],
    range: [0, plotWidth],
  });
  const y = scaleLinear({
    domain: [0, Math.max(1, ...points.map(({ days }) => days ?? 0))],
    range: [plotHeight, 0],
    nice: true,
  });
  const xs = points.map(({ date }) => x(new Date(date)));
  const lone = lonePoints(points.map(({ days }) => days));
  const ticks = x.ticks(Math.max(2, Math.floor(plotWidth / 48)));
  return (
    <Paper withBorder p="md" mx={0} component="figure">
      <ChartHeader
        title={`Change in ${id} processing times`}
        range={
          all[0].date < from && (
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
              x={({ date }) => x(new Date(date))}
              y={({ days }) => y(days ?? 0)}
              defined={({ gap }) => gap === null}
              curve={curveMonotoneX}
              stroke={LINE_COLOR}
              strokeWidth={2}
              strokeLinejoin="round"
              strokeLinecap="round"
              fill="none"
            />
            {points.map(
              ({ date, gap }) =>
                gap !== null && (
                  <line
                    key={date}
                    x1={x(new Date(gap.from[0]))}
                    y1={y(gap.from[1])}
                    x2={x(new Date(gap.to[0]))}
                    y2={y(gap.to[1])}
                    stroke={LINE_COLOR}
                    strokeWidth={2}
                    strokeDasharray={DASHES}
                  />
                ),
            )}
            {[...lone, ...(picked === null ? [] : [picked])].map(
              (index, order) => {
                const { days } = points[index];
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
        Source: <a href={NVC_TIMEFRAMES_URL}>NVC Timeframes page</a>. Where the
        line is dashed, VisaWhen was not recording NVC&rsquo;s numbers: the
        dashes only join the readings on either side.
      </figcaption>
    </Paper>
  );
}
