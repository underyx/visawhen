import * as echarts from "echarts/core";
import { BarChart, LineChart } from "echarts/charts";
import {
  DataZoomComponent,
  GridComponent,
  LegendComponent,
  TooltipComponent,
} from "echarts/components";
import { SVGRenderer } from "echarts/renderers";
import ReactEChartsCore from "echarts-for-react/lib/core";
import { Paper } from "@mantine/core";
import numeral from "numeral";
import {
  formatCount,
  formatMonths,
  ProcessingTimeSeries,
  QuarterPoint,
} from "./uscis";

echarts.use([
  BarChart,
  LineChart,
  DataZoomComponent,
  GridComponent,
  LegendComponent,
  TooltipComponent,
  SVGRenderer,
]);

// Validated as a colorblind-safe categorical set: blue / red / amber for the
// outcomes, then violet and green for further lines.
const APPROVED_COLOR = "#1c7ed6";
const DENIED_COLOR = "#e03131";
const PENDING_COLOR = "#f08c00";
const EXTRA_COLORS = ["#e03131", "#f08c00", "#7048e8", "#0ca678"];

interface Props {
  points: QuarterPoint[];
}

function SourceCaption({ source, what }: { source: string; what: string }) {
  return (
    <figcaption>
      Source: USCIS&rsquo;s quarterly <a href={source}>{what}</a> reports, via
      the{" "}
      <a href="https://www.uscis.gov/tools/reports-and-studies/immigration-and-citizenship-data">
        Immigration and Citizenship Data
      </a>{" "}
      page.
      <br />
      New quarters show up here within a day of USCIS publishing them and are
      stored in a{" "}
      <a href="https://github.com/underyx/visawhen/blob/main/data/uscis/forms.json">
        JSON file on GitHub
      </a>
      .
    </figcaption>
  );
}

/** How much of the chart to show initially: the last six years. */
function initialZoomStart(points: QuarterPoint[]): number {
  return Math.max(0, 100 - 100 * (24 / points.length));
}

/** Stacked bars: everything USCIS had to decide on in a quarter (the
 * applications pending when it started plus those filed during it), split by
 * what happened to it by the quarter's end. */
export function OutcomesChart({
  points,
  source,
  sourceName,
}: Props & { source: string; sourceName: string }) {
  return (
    <Paper shadow="xs" p="md" mx={0} component="figure">
      <ReactEChartsCore
        style={{ width: "100%", height: "420px" }}
        echarts={echarts}
        option={{
          animation: false,
          color: [APPROVED_COLOR, DENIED_COLOR, PENDING_COLOR],
          legend: { top: 0 },
          tooltip: {
            trigger: "axis",
            formatter: (params: { dataIndex: number }[]) => {
              const point = points[params[0].dataIndex];
              return [
                `<strong>${point.label}</strong>`,
                `Received: ${formatCount(point.received)}`,
                `Approved: ${formatCount(point.approved)}`,
                `Denied: ${formatCount(point.denied)}`,
                `Still pending at quarter end: ${formatCount(point.pending)}`,
                `Estimated wait at that pace: ${formatMonths(
                  point.waitMonths,
                )}`,
              ].join("<br />");
            },
          },
          grid: { left: 64, right: 16, top: 40, bottom: 80 },
          xAxis: { type: "category", data: points.map((point) => point.label) },
          yAxis: {
            type: "value",
            name: "applications",
            axisLabel: {
              formatter: (value: number) => numeral(value).format("0.[0]a"),
            },
          },
          dataZoom: [
            { type: "slider", start: initialZoomStart(points), end: 100 },
          ],
          series: [
            {
              name: "Approved",
              type: "bar",
              stack: "applications",
              data: points.map((point) => point.approved),
              itemStyle: { borderColor: "#fff", borderWidth: 1 },
            },
            {
              name: "Denied",
              type: "bar",
              stack: "applications",
              data: points.map((point) => point.denied),
              itemStyle: { borderColor: "#fff", borderWidth: 1 },
            },
            {
              name: "Still pending",
              type: "bar",
              stack: "applications",
              data: points.map((point) => point.pending),
              itemStyle: { borderColor: "#fff", borderWidth: 1 },
            },
          ],
        }}
      />
      <SourceCaption source={source} what={sourceName} />
    </Paper>
  );
}

/** Lines: the months it would take to decide every pending application at
 * each quarter's pace of decisions, next to USCIS's own median processing
 * time where it publishes one. */
export function WaitChart({
  points,
  processingTimeSeries,
}: Props & { processingTimeSeries: ProcessingTimeSeries[] }) {
  const estimateName = "Estimated wait at the quarter's pace";
  const officialName = ({ label }: ProcessingTimeSeries) =>
    label === "" ? "USCIS median processing time" : `USCIS median: ${label}`;
  return (
    <Paper shadow="xs" p="md" mx={0} component="figure">
      <ReactEChartsCore
        style={{ width: "100%", height: "360px" }}
        echarts={echarts}
        option={{
          animation: false,
          color: [APPROVED_COLOR, ...EXTRA_COLORS],
          legend: processingTimeSeries.length > 0 ? { top: 0 } : undefined,
          tooltip: {
            trigger: "axis",
            formatter: (params: { dataIndex: number }[]) => {
              const point = points[params[0].dataIndex];
              return [
                `<strong>${point.label}</strong>`,
                `${estimateName}: ${formatMonths(point.waitMonths)}`,
                `(${formatCount(point.pending)} pending, ${formatCount(
                  point.completions,
                )} decided)`,
                ...processingTimeSeries.map(
                  (series) =>
                    `${officialName(series)}: ${formatMonths(
                      point.processingTimes[series.title] ?? null,
                    )}`,
                ),
              ].join("<br />");
            },
          },
          grid: {
            left: 64,
            right: 16,
            top: processingTimeSeries.length > 0 ? 56 : 24,
            bottom: 80,
          },
          xAxis: { type: "category", data: points.map((point) => point.label) },
          yAxis: { type: "value", name: "months", min: 0 },
          dataZoom: [
            { type: "slider", start: initialZoomStart(points), end: 100 },
          ],
          series: [
            {
              name: estimateName,
              type: "line",
              data: points.map((point) =>
                point.waitMonths === null
                  ? null
                  : Math.round(point.waitMonths * 10) / 10,
              ),
              lineStyle: { width: 2 },
              symbolSize: 8,
            },
            ...processingTimeSeries.map((series) => ({
              name: officialName(series),
              type: "line",
              data: points.map(
                (point) => point.processingTimes[series.title] ?? null,
              ),
              lineStyle: { width: 2, type: "dashed" },
              symbolSize: 8,
            })),
          ],
        }}
      />
      <figcaption>
        The estimated wait is the pending applications at the end of each
        quarter, divided by the decisions (approvals and denials) made per month
        during it.
        {processingTimeSeries.length > 0 &&
          " USCIS's median is how long the cases it decided in the quarter had taken."}
      </figcaption>
    </Paper>
  );
}
