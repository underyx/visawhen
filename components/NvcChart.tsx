import { NvcSeries } from "../api/nvc";
import ReactEChartsCore from "echarts-for-react/lib/core";
import * as echarts from "echarts";
import { add } from "date-fns";

interface Props {
  series: NvcSeries;
  id: string;
}

function Tooltip([series]: any) {
  const [dateString, backlogDays] = series.data;
  const date = new Date(dateString);
  const processingDate = add(date, {
    days: -backlogDays,
  });
  const tooltip = document.createElement("div");
  tooltip.appendChild(
    document.createTextNode(
      `${backlogDays} days of backlog on ${date.toDateString()}`
    )
  );
  tooltip.appendChild(document.createElement("br"));
  tooltip.appendChild(
    document.createTextNode(
      `(processed up to ${processingDate.toDateString()})`
    )
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
