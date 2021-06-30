import { BacklogRow } from "../api/consulates";
import ReactEChartsCore from "echarts-for-react/lib/core";
import * as echarts from "echarts";

interface Props {
  backlog: BacklogRow[];
}

export default function ConsulateChart({ backlog }: Props) {
  const dateFormatter = new Intl.DateTimeFormat([], {
    month: "short",
    year: "numeric",
  });
  return (
    <figure className="box my-3">
      <ReactEChartsCore
        style={{ height: "600px" }}
        echarts={echarts}
        option={{
          dataset: {
            source: [
              ["month", "visas issued", "backlog size estimate"],
              ...backlog.map((row) => [
                dateFormatter.format(new Date(row.month)),
                Math.round(row.issuances * 10) / 10,
                row.backlog !== null ? Math.round(row.backlog * 10) / 10 : null,
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
