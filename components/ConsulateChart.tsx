import { BacklogRow } from "../utils/consulates";

import * as echarts from "echarts/core";
import { BarChart, LineChart } from "echarts/charts";
import {
  DatasetComponent,
  DataZoomComponent,
  TitleComponent,
  TooltipComponent,
  GridComponent,
} from "echarts/components";
import { SVGRenderer } from "echarts/renderers";
import ReactEChartsCore from "echarts-for-react/lib/core";

echarts.use([
  DatasetComponent,
  DataZoomComponent,
  TitleComponent,
  TooltipComponent,
  GridComponent,
  BarChart,
  LineChart,
  SVGRenderer,
]);

interface Props {
  backlog: BacklogRow[];
}

export default function ConsulateChart({ backlog }: Props) {
  const dateFormatter = new Intl.DateTimeFormat([], {
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
  return (
    <figure className="box my-3">
      <ReactEChartsCore
        style={{ height: "600px" }}
        echarts={echarts}
        option={{
          dataset: {
            source: [
              ["month", "actual visas issued", "expected visas issued"],
              ...backlog.map((row) => [
                dateFormatter.format(new Date(row.month)),
                Math.round(row.issuances * 10) / 10,
                row.expectedDelta !== null
                  ? Math.round(row.expectedDelta * 10) / 10
                  : null,
              ]),
            ],
          },
          animation: false,
          tooltip: {
            trigger: "axis",
          },
          xAxis: {
            type: "category",
          },
          yAxis: { name: "visas" },
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
            },
            {
              type: "line",
              step: "middle",
            },
          ],
        }}
      />
      <figcaption>
        Source:{" "}
        <a href="https://travel.state.gov/content/travel/en/legal/visa-law0/visa-statistics/immigrant-visa-statistics/monthly-immigrant-visa-issuances.html">
          The U.S. Department of State&rsquo;s Monthly Immigrant Visa Issuance
          Statistics
        </a>
        .<br />
        New data shows up here within a day and is stored in a{" "}
        <a href="https://github.com/underyx/visawhen/blob/main/data/consulates/consulates.sqlite">
          SQLite file on GitHub
        </a>
        .
      </figcaption>
    </figure>
  );
}
