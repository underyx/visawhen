import { Paper } from "@mantine/core";
import ReactEChartsCore from "echarts-for-react/lib/core";
import { LineChart } from "echarts/charts";
import {
  AriaComponent,
  DataZoomComponent,
  GridComponent,
  LegendComponent,
  TooltipComponent,
} from "echarts/components";
import * as echarts from "echarts/core";
import { SVGRenderer } from "echarts/renderers";
import { VISA_BULLETIN_URL } from "./links";
import {
  CHARTS,
  ChartKey,
  formatBulletinMonth,
  formatCutoff,
  isDate,
  monthStart,
  Series,
} from "./visaBulletin";

echarts.use([
  AriaComponent,
  DataZoomComponent,
  GridComponent,
  LegendComponent,
  TooltipComponent,
  LineChart,
  SVGRenderer,
]);

interface Props {
  /** The category's cutoffs in the area, per chart */
  series: Record<ChartKey, Series>;
  /** The data file on GitHub */
  dataUrl: string;
  /** What the chart is of, for screen readers: "F4, Philippines" */
  label: string;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** A point: [the bulletin's first day, its cutoff date or null when it is
 * "C" or "U", the cutoff as the bulletin gives it] */
type Point = [string, string | null, string];

function points(series: Series): Point[] {
  return series.map(([month, cutoff]) => [
    monthStart(month),
    isDate(cutoff) ? cutoff : null,
    cutoff,
  ]);
}

interface TooltipParams {
  seriesName: string;
  data: Point;
}

function tooltip(params: TooltipParams[]): string {
  if (params.length === 0) return "";
  const month = params[0].data[0].slice(0, 7);
  const lines = params.map(
    ({ seriesName, data }) => `${seriesName}: ${formatCutoff(data[2])}`,
  );
  // text only: the tooltip is set as HTML
  return [`${formatBulletinMonth(month)} bulletin`, ...lines]
    .map((line) => line.replace(/&/g, "&amp;").replace(/</g, "&lt;"))
    .join("<br/>");
}

/** The chart in words, for screen readers: its span and the last 6
 * bulletins' Final Action Dates */
function describe(label: string, series: Series): string {
  if (series.length === 0) return `No Visa Bulletin data for ${label}.`;
  const recent = series
    .slice(-6)
    .map(
      ([month, cutoff]) =>
        `${formatBulletinMonth(month)}: ${formatCutoff(cutoff)}`,
    )
    .join("; ");
  return `Line chart of the Visa Bulletin cutoff dates for ${label}, ${formatBulletinMonth(
    series[0][0],
  )} to ${formatBulletinMonth(
    series[series.length - 1][0],
  )}. Final Action Dates in the last 6 bulletins: ${recent}.`;
}

export default function VisaBulletinChart({ series, dataUrl, label }: Props) {
  return (
    <Paper shadow="xs" p="md" mx={0} component="figure">
      <ReactEChartsCore
        style={{ width: "100%", height: "400px" }}
        echarts={echarts}
        option={{
          animation: false,
          aria: {
            enabled: true,
            label: { description: describe(label, series.finalAction) },
          },
          legend: { top: 0 },
          tooltip: { trigger: "axis", formatter: tooltip },
          grid: { left: 8, right: 16, top: 40, containLabel: true },
          xAxis: { type: "time" },
          yAxis: {
            type: "time",
            scale: true,
            // cutoffs are days: no ticks between them
            minInterval: DAY_MS,
            axisLabel: {
              formatter: { year: "{yyyy}", month: "{MMM}", day: "{MMM} {d}" },
            },
          },
          // every bulletin, which fits: about 12 a year since October 2015
          dataZoom: [{ type: "slider", start: 0, end: 100 }],
          series: (Object.keys(CHARTS) as ChartKey[]).map((chart) => ({
            name: CHARTS[chart],
            type: "line",
            step: "end",
            showSymbol: false,
            data: points(series[chart]),
          })),
        }}
      />
      <figcaption>
        Source: the State Department&rsquo;s{" "}
        <a href={VISA_BULLETIN_URL}>monthly Visa Bulletins</a>. Each line shows
        the cutoff date in each month&rsquo;s bulletin. There is a gap where the
        category was current (no cutoff) or unavailable. All the bulletins since
        October 2015 are in a <a href={dataUrl}>JSON file on GitHub</a>.
      </figcaption>
    </Paper>
  );
}
