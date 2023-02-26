import { NvcSeries } from "../api/nvc";
import add from "date-fns/add";

import * as echarts from "echarts/core";
import { LineChart } from "echarts/charts";
import {
  TitleComponent,
  TooltipComponent,
  GridComponent,
  DataZoomComponent,
} from "echarts/components";
import { SVGRenderer } from "echarts/renderers";
import ReactEChartsCore from "echarts-for-react/lib/core";

echarts.use([
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

function Tooltip([series]: any) {
  const dateFormatter = new Intl.DateTimeFormat([], {
    month: "short",
    year: "numeric",
    day: "numeric",
    timeZone: "UTC",
  });

  const [dateString, backlogDays] = series.data;
  const date = new Date(dateString);
  const processingDate = add(date, {
    days: -backlogDays,
  });
  const tooltip = document.createElement("div");
  tooltip.appendChild(
    document.createTextNode(
      `${backlogDays} days of backlog on ${dateFormatter.format(date)}`,
    ),
  );
  tooltip.appendChild(document.createElement("br"));
  tooltip.appendChild(
    document.createTextNode(
      `(processed up to ${dateFormatter.format(processingDate)})`,
    ),
  );

  return tooltip;
}

export default function NvcChart({ id, series }: Props) {
  return (
    <figure className="box my-3">
      <ReactEChartsCore
        style={{
          width: "100%",
          height: "400px",
        }}
        echarts={echarts}
        option={{
          animation: false,
          tooltip: {
            trigger: "axis",
            formatter: Tooltip,
          },
          title: {
            text: `Change in ${id} processing times`,
            x: "center",
          },
          xAxis: {
            type: "time",
          },
          yAxis: { type: "value", boundaryGap: [0, "100%"], name: "days" },
          dataZoom: [
            {
              type: "slider",
              start: 100 - 100 * (52 / Object.entries(series).length), // one year
              end: 100,
            },
          ],
          series: [
            {
              name: id,
              type: "line",
              smooth: true,
              data: Object.entries(series),
            },
          ],
        }}
      />
      <figcaption>
        Source:{" "}
        <a href="https://travel.state.gov/content/travel/en/us-visas/immigrate/nvc-timeframes.html">
          NVC Timeframes page
        </a>
        .<br />
        New data shows up here within 10 minutes and is stored in a{" "}
        <a href="https://github.com/underyx/visawhen/blob/main/data/nvc/data.json">
          JSON file on GitHub
        </a>
        .
      </figcaption>
    </figure>
  );
}
