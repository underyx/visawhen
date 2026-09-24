import { IssuancesRow } from "../api/consulates";
import { formatMonth } from "./consulates";

import * as echarts from "echarts/core";
import { BarChart } from "echarts/charts";
import {
  DatasetComponent,
  DataZoomComponent,
  TitleComponent,
  TooltipComponent,
  GridComponent,
} from "echarts/components";
import { SVGRenderer } from "echarts/renderers";
import ReactEChartsCore from "echarts-for-react/lib/core";
import { Paper } from "@mantine/core";

echarts.use([
  DatasetComponent,
  DataZoomComponent,
  TitleComponent,
  TooltipComponent,
  GridComponent,
  BarChart,
  SVGRenderer,
]);

interface Props {
  issuances: IssuancesRow[];
}

export default function ConsulateChart({ issuances }: Props) {
  return (
    <Paper shadow="xs" p="md" mx={0} component="figure">
      <ReactEChartsCore
        style={{ height: "600px" }}
        echarts={echarts}
        option={{
          dataset: {
            source: [
              ["month", "visas issued"],
              ...issuances.map((row) => [
                formatMonth(row.month),
                Math.round(row.issuances),
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
            },
          ],
        }}
      />
      <figcaption>
        Source: the U.S. Department of State&rsquo;s monthly{" "}
        <a href="https://travel.state.gov/content/travel/en/legal/visa-law0/visa-statistics/immigrant-visa-statistics/monthly-immigrant-visa-issuances.html">
          immigrant
        </a>{" "}
        and{" "}
        <a href="https://travel.state.gov/content/travel/en/legal/visa-law0/visa-statistics/nonimmigrant-visa-statistics/monthly-nonimmigrant-visa-issuances.html">
          nonimmigrant
        </a>{" "}
        visa issuance statistics.
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
