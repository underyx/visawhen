import { IssuancesRow, VisaType } from "../api/consulates";
import { formatCount, formatMonth } from "./consulates";
import { ISSUANCE_STATISTICS_URLS } from "./links";

import * as echarts from "echarts/core";
import { BarChart } from "echarts/charts";
import {
  AriaComponent,
  DatasetComponent,
  DataZoomComponent,
  LegendComponent,
  TitleComponent,
  TooltipComponent,
  GridComponent,
} from "echarts/components";
import { SVGRenderer } from "echarts/renderers";
import ReactEChartsCore from "echarts-for-react/lib/core";
import { Paper } from "@mantine/core";

echarts.use([
  AriaComponent,
  DatasetComponent,
  DataZoomComponent,
  LegendComponent,
  TitleComponent,
  TooltipComponent,
  GridComponent,
  BarChart,
  SVGRenderer,
]);

/** State's listing of the monthly reports the counts come from */
const SOURCES: Record<VisaType, { kind: string; url: string }> = {
  IV: { kind: "immigrant", url: ISSUANCE_STATISTICS_URLS.IV },
  NIV: { kind: "nonimmigrant", url: ISSUANCE_STATISTICS_URLS.NIV },
};

/** Mantine's blue.7: 4.2:1 against the white of the chart, where bars need
 * 3:1 */
const BAR_COLOR = "#1c7ed6";
const SERIES_NAME = "Visas issued per month";

interface Props {
  issuances: IssuancesRow[];
  visaType: VisaType;
  /** What the visas are, for the chart's text alternative: "Montreal
   * CR1/IR1" */
  subject: string;
}

/** What the chart shows, in words, for screen readers: its span and the last
 * 12 months' counts. */
function describe(issuances: IssuancesRow[], subject: string): string {
  const first = issuances[0];
  const last = issuances[issuances.length - 1];
  const recent = issuances
    .slice(-12)
    .map((row) => `${formatMonth(row.month)}: ${formatCount(row.issuances)}`)
    .join("; ");
  return `Bar chart of ${subject} visas issued each month, ${formatMonth(
    first.month,
  )} to ${formatMonth(last.month)}. The last 12 months: ${recent}.`;
}

export default function ConsulateChart({
  issuances,
  visaType,
  subject,
}: Props) {
  const source = SOURCES[visaType];
  return (
    <Paper shadow="xs" p="md" mx={0} component="figure">
      <ReactEChartsCore
        style={{ height: "600px" }}
        echarts={echarts}
        option={{
          dataset: {
            source: [
              ["month", SERIES_NAME],
              ...issuances.map((row) => [
                formatMonth(row.month),
                Math.round(row.issuances),
              ]),
            ],
          },
          animation: false,
          aria: {
            enabled: true,
            label: { description: describe(issuances, subject) },
          },
          legend: { top: 0 },
          tooltip: {
            trigger: "axis",
          },
          xAxis: {
            type: "category",
          },
          // Whole visas only: without this, a class with at most a visa or two
          // a month gets ticks at 0.2, 0.4 and so on.
          yAxis: { name: "visas", minInterval: 1 },
          dataZoom: [
            {
              type: "slider",
              start: 30,
              end: 100,
            },
          ],
          series: [
            {
              type: "bar",
              name: SERIES_NAME,
              itemStyle: { color: BAR_COLOR },
            },
          ],
        }}
      />
      <figcaption>
        Source: the U.S. Department of State&rsquo;s{" "}
        <a href={source.url}>monthly {source.kind} visa issuance statistics</a>
        .
        <br />
        The monthly counts are stored in{" "}
        <a href="https://github.com/underyx/visawhen/blob/main/data/consulates/dump">
          JSON lines files on GitHub
        </a>
        .
      </figcaption>
    </Paper>
  );
}
