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
import { formatCount, formatMonths, QuarterPoint } from "./n400";

echarts.use([
  BarChart,
  LineChart,
  DataZoomComponent,
  GridComponent,
  LegendComponent,
  TooltipComponent,
  SVGRenderer,
]);

// Validated as a colorblind-safe categorical set (blue / red / amber)
const APPROVED_COLOR = "#1c7ed6";
const DENIED_COLOR = "#e03131";
const PENDING_COLOR = "#f08c00";

interface Props {
  points: QuarterPoint[];
}

function SourceCaption({ source }: { source: string }) {
  return (
    <figcaption>
      Source: USCIS&rsquo;s quarterly{" "}
      <a href={source}>
        Form N-400 by Category of Naturalization, Case Status, and USCIS Field
        Office Location
      </a>{" "}
      reports, via the{" "}
      <a href="https://www.uscis.gov/tools/reports-and-studies/immigration-and-citizenship-data?topic_id%5B%5D=33692">
        Immigration and Citizenship Data
      </a>{" "}
      page.
      <br />
      New quarters show up here within a day of USCIS publishing them and are
      stored in a{" "}
      <a href="https://github.com/underyx/visawhen/blob/main/data/uscis/n400.json">
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

/** Stacked bars: everything an office had to decide on in a quarter (the
 * applications pending when it started plus those filed during it), split by
 * what happened to it by the quarter's end. */
export function N400OutcomesChart({ points, source }: Props & { source: string }) {
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
                `Estimated wait at that pace: ${formatMonths(point.waitMonths)}`,
              ].join("<br />");
            },
          },
          grid: { left: 64, right: 16, top: 40, bottom: 80 },
          xAxis: { type: "category", data: points.map((point) => point.label) },
          yAxis: {
            type: "value",
            name: "applications",
            axisLabel: {
              formatter: (value: number) => numeral(value).format("0a"),
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
      <SourceCaption source={source} />
    </Paper>
  );
}

/** Line: the months it would take to decide every pending application at each
 * quarter's pace of decisions. */
export function N400WaitChart({ points }: Props) {
  return (
    <Paper shadow="xs" p="md" mx={0} component="figure">
      <ReactEChartsCore
        style={{ width: "100%", height: "320px" }}
        echarts={echarts}
        option={{
          animation: false,
          color: [APPROVED_COLOR],
          tooltip: {
            trigger: "axis",
            formatter: (params: { dataIndex: number }[]) => {
              const point = points[params[0].dataIndex];
              return `<strong>${point.label}</strong><br />Estimated wait: ${formatMonths(
                point.waitMonths,
              )}<br />${formatCount(point.pending)} pending, ${formatCount(
                point.completions,
              )} decided`;
            },
          },
          grid: { left: 64, right: 16, top: 24, bottom: 80 },
          xAxis: { type: "category", data: points.map((point) => point.label) },
          yAxis: { type: "value", name: "months", min: 0 },
          dataZoom: [
            { type: "slider", start: initialZoomStart(points), end: 100 },
          ],
          series: [
            {
              name: "Estimated wait",
              type: "line",
              data: points.map((point) =>
                point.waitMonths === null
                  ? null
                  : Math.round(point.waitMonths * 10) / 10,
              ),
              lineStyle: { width: 2 },
              symbolSize: 8,
            },
          ],
        }}
      />
      <figcaption>
        Pending applications at the end of each quarter, divided by the
        decisions (approvals and denials) made per month during it.
      </figcaption>
    </Paper>
  );
}
