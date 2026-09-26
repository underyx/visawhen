import { NvcSeries } from "../api/nvc";
import { addDays, daysBetween, formatShortDate } from "./Freshness";
import { NVC_TIMEFRAMES_URL } from "./links";

import * as echarts from "echarts/core";
import { LineChart } from "echarts/charts";
import {
  AriaComponent,
  TitleComponent,
  TooltipComponent,
  GridComponent,
  DataZoomComponent,
} from "echarts/components";
import { SVGRenderer } from "echarts/renderers";
import ReactEChartsCore from "echarts-for-react/lib/core";
import { FONT_FAMILY } from "./font";
import { Paper } from "@mantine/core";

echarts.use([
  AriaComponent,
  DataZoomComponent,
  TitleComponent,
  TooltipComponent,
  GridComponent,
  LineChart,
  SVGRenderer,
]);

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

/** Readings further apart than this, three weeks, have several weeks with no
 * reading between them, which the chart shows as a break in the line instead
 * of joining the readings across it. Shorter gaps, a missing week or two, are
 * joined, as the caption says. */
const MAX_GAP_DAYS = 21;

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

interface TooltipParams {
  /** The point under the cursor, as passed to the series */
  data: Point;
}

function Tooltip([series]: TooltipParams[]) {
  const [date, backlogDays] = series.data;
  if (backlogDays === null) return "No readings for these weeks";
  // Date arithmetic on the ISO strings: date-fns would add days in the
  // visitor's time zone, and land on the wrong day across a DST change.
  const processingDate = addDays(date, -backlogDays);
  const tooltip = document.createElement("div");
  tooltip.appendChild(
    document.createTextNode(
      `${backlogDays} days of backlog on ${dateFormatter.format(
        new Date(date),
      )}`,
    ),
  );
  tooltip.appendChild(document.createElement("br"));
  tooltip.appendChild(
    document.createTextNode(
      `(processed up to ${dateFormatter.format(new Date(processingDate))})`,
    ),
  );

  return tooltip;
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
  return (
    <Paper withBorder p="md" mx={0} component="figure">
      <ReactEChartsCore
        style={{
          width: "100%",
          height: "400px",
        }}
        echarts={echarts}
        option={{
          textStyle: { fontFamily: FONT_FAMILY },
          animation: false,
          aria: {
            enabled: true,
            label: { description: describe(id, series) },
          },
          tooltip: {
            trigger: "axis",
            formatter: Tooltip,
          },
          title: {
            text: `Change in ${id} processing times`,
            left: "center",
          },
          xAxis: {
            type: "time",
          },
          yAxis: { type: "value", boundaryGap: [0, "100%"], name: "days" },
          dataZoom: [
            {
              type: "slider",
              // the last year of weekly data points
              start: Math.max(0, 100 - 100 * (52 / Object.keys(series).length)),
              end: 100,
            },
          ],
          series: [
            {
              name: id,
              type: "line",
              smooth: true,
              data: chartPoints(series),
            },
          ],
        }}
      />
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
