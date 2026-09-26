import * as echarts from "echarts/core";
import { BarChart, LineChart } from "echarts/charts";
import {
  AriaComponent,
  DataZoomComponent,
  GridComponent,
  LegendComponent,
  MarkLineComponent,
  TooltipComponent,
} from "echarts/components";
import { SVGRenderer } from "echarts/renderers";
import ReactEChartsCore from "echarts-for-react/lib/core";
import { Paper } from "@mantine/core";
import numeral from "numeral";
import {
  approximately,
  CHART_QUARTERS,
  ChartBreak,
  formatCount,
  formatMonths,
  ProcessingTimeSeries,
  QuarterPoint,
} from "./uscis";
import { USCIS_DATA_URL } from "./links";

echarts.use([
  AriaComponent,
  BarChart,
  LineChart,
  DataZoomComponent,
  GridComponent,
  LegendComponent,
  MarkLineComponent,
  TooltipComponent,
  SVGRenderer,
]);

// Validated as a colorblind-safe categorical set: blue / red / amber /
// violet, then green for further lines.
const APPROVED_COLOR = "#1c7ed6";
const DENIED_COLOR = "#e03131";
const PENDING_COLOR = "#f08c00";
const RECEIVED_COLOR = "#7048e8";
const EXTRA_COLORS = [DENIED_COLOR, PENDING_COLOR, RECEIVED_COLOR, "#0ca678"];
const BREAK_COLOR = "#495057";

interface Props {
  points: QuarterPoint[];
  /** What the numbers are of, for the chart's text alternative: "I-130",
   * "I-130 (Immediate Relative)" */
  subject: string;
  /** Where, for one office's numbers: "at the San Francisco office" */
  place?: string;
  /** Quarters from which the numbers mean something else, marked with a
   * vertical line and explained under the chart */
  breaks?: ChartBreak[];
  /** Quarters in which the filings include new filings USCIS routed to the
   * office (routedQuarters) */
  routed?: readonly string[];
}

// The legends scroll instead of wrapping: on a phone, the wait chart's five
// entries took five lines and ran over the plot.
const LEGEND = { type: "scroll", top: 0 } as const;

/** What a diamond on a pending count or on the time to clear the backlog
 * means (QuarterPoint.suspect). */
const SUSPECT_NOTE =
  "A diamond marks a pending count that doesn't match the quarter before's count plus the quarter's filings minus its decisions: it is what USCIS reported, but USCIS doesn't say why they differ, so the pages draw no conclusions from it.";

function SourceCaption({ source, what }: { source: string; what: string }) {
  return (
    <>
      Source: USCIS&rsquo;s quarterly <a href={source}>{what}</a> reports, via
      the <a href={USCIS_DATA_URL}>Immigration and Citizenship Data</a> page.
      <br />
      The numbers are stored in a{" "}
      <a href="https://github.com/underyx/visawhen/blob/main/data/uscis/forms.json">
        JSON file on GitHub
      </a>
      .
    </>
  );
}

/** How much of the chart to show initially: the last six years. */
function initialZoomStart(points: QuarterPoint[]): number {
  return Math.max(0, 100 - 100 * (CHART_QUARTERS / points.length));
}

/** The vertical lines at `breaks`, as a series' markLine, or undefined when
 * there are none within the points. */
function breakLines(points: QuarterPoint[], breaks: ChartBreak[]) {
  const data = breaks.flatMap((chartBreak) => {
    const point = points.find(({ quarter }) => quarter === chartBreak.quarter);
    return point === undefined
      ? []
      : [
          {
            xAxis: point.label,
            label: { formatter: chartBreak.label },
          },
        ];
  });
  if (data.length === 0) return undefined;
  return {
    silent: true,
    symbol: "none",
    lineStyle: { color: BREAK_COLOR, type: "dashed", width: 1 },
    label: {
      position: "insideEndTop",
      color: BREAK_COLOR,
      fontSize: 11,
    },
    data,
  };
}

/** The sentences under a chart on its breaks and marked points: those of the
 * breaks within the points, and what a diamond means when there is one. */
function Notes({
  points,
  breaks,
  suspects,
}: {
  points: QuarterPoint[];
  breaks: ChartBreak[];
  suspects: boolean;
}) {
  // the breaks in the quarters the chart shows at first; older ones have
  // their line and its label
  const shown = points.slice(-CHART_QUARTERS);
  const texts = [
    ...breaks
      .filter((chartBreak) =>
        shown.some(({ quarter }) => quarter === chartBreak.quarter),
      )
      .map(({ label, text }) => `A dashed line ("${label}"): ${text}`),
    ...(suspects ? [SUSPECT_NOTE] : []),
  ];
  if (texts.length === 0) return null;
  return (
    <>
      {texts.map((text) => (
        <span key={text}> {text}</span>
      ))}
    </>
  );
}

/** A line's data point, as a diamond when it is `suspect`. */
function marked(value: number | null, suspect: boolean, color: string) {
  return suspect && value !== null
    ? {
        value,
        symbol: "diamond",
        symbolSize: 14,
        itemStyle: { color: "#fff", borderColor: color, borderWidth: 2 },
      }
    : value;
}

/** The tooltip's lines on where a quarter's numbers come from and whether
 * they are out of line. */
function pointNotes(point: QuarterPoint): string[] {
  return [
    ...(point.suspect
      ? ["Pending count doesn't match filings minus decisions"]
      : []),
    ...(point.fromOfficeReport
      ? ["From the national totals of USCIS's per-office report"]
      : []),
  ];
}

/** What the outcomes chart shows, in words, for screen readers: its span and
 * the newest quarter's numbers. */
function describeOutcomes(
  points: QuarterPoint[],
  subject: string,
  place: string | undefined,
): string {
  const current = points[points.length - 1];
  return `Chart of ${subject} applications${
    place === undefined ? "" : ` ${place}`
  } per quarter, ${points[0].label} to ${
    current.label
  }: bars for those approved and denied, lines for those filed and those pending at the end of the quarter. In ${
    current.label
  }: ${formatCount(current.approved)} approved, ${formatCount(
    current.denied,
  )} denied, ${formatCount(current.received)} filed, ${formatCount(
    current.pending,
  )} pending.`;
}

/** Bars for the decisions made in each quarter (approved and denied,
 * stacked), with lines for the applications filed during it and for the
 * backlog as it stood at its end. The backlog is a snapshot, not "those
 * quarters' cases still open": most of it was filed earlier. */
export function OutcomesChart({
  points,
  subject,
  place,
  source,
  sourceName,
  breaks = [],
  routed = [],
}: Props & { source: string; sourceName: string }) {
  const suspects = points.some(({ suspect }) => suspect);
  return (
    <Paper shadow="xs" p="md" mx={0} component="figure">
      <ReactEChartsCore
        style={{ width: "100%", height: "440px" }}
        echarts={echarts}
        option={{
          animation: false,
          color: [APPROVED_COLOR, DENIED_COLOR, PENDING_COLOR, RECEIVED_COLOR],
          aria: {
            enabled: true,
            label: { description: describeOutcomes(points, subject, place) },
          },
          legend: LEGEND,
          tooltip: {
            trigger: "axis",
            formatter: (params: { dataIndex: number }[]) => {
              const point = points[params[0].dataIndex];
              return [
                `<strong>${point.label}</strong>`,
                `${
                  routed.includes(point.quarter)
                    ? "Filed or routed here"
                    : "Filed"
                }: ${formatCount(point.received)}`,
                `Approved: ${formatCount(point.approved)}`,
                `Denied: ${formatCount(point.denied)}`,
                `Pending at quarter end: ${formatCount(point.pending)}`,
                `Time to clear backlog at that pace: ${approximately(
                  formatMonths(point.waitMonths),
                  point.approximate,
                )}`,
                ...pointNotes(point),
              ].join("<br />");
            },
          },
          grid: { left: 64, right: 16, top: 48, bottom: 80 },
          xAxis: { type: "category", data: points.map((point) => point.label) },
          yAxis: {
            type: "value",
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
              stack: "decisions",
              data: points.map((point) => point.approved),
              itemStyle: { borderColor: "#fff", borderWidth: 1 },
              markLine: breakLines(points, breaks),
            },
            {
              name: "Denied",
              type: "bar",
              stack: "decisions",
              data: points.map((point) => point.denied),
              itemStyle: { borderColor: "#fff", borderWidth: 1 },
            },
            {
              name: "Pending at quarter end",
              type: "line",
              data: points.map((point) =>
                marked(point.pending, point.suspect, PENDING_COLOR),
              ),
              lineStyle: { width: 2 },
              symbolSize: 8,
            },
            {
              // as in the text: only for routing in the quarters shown at
              // first; an older quarter's tooltip still says it
              name: points
                .slice(-CHART_QUARTERS)
                .some(({ quarter }) => routed.includes(quarter))
                ? "Filed (or routed here)"
                : "Filed",
              type: "line",
              data: points.map((point) => point.received),
              lineStyle: { width: 2, type: "dashed" },
              symbolSize: 8,
            },
          ],
        }}
      />
      <figcaption>
        <SourceCaption source={source} what={sourceName} />
        <Notes points={points} breaks={breaks} suspects={suspects} />
      </figcaption>
    </Paper>
  );
}

/** A lone spike is more than this many times the next largest value. */
const SPIKE_FACTOR = 3;

/** Where the wait chart clips lone spikes of the time to clear the backlog,
 * or null when it clips nothing. A spike is a value more than SPIKE_FACTOR
 * times the next largest, as in a quarter in which USCIS decided almost
 * nothing: I-589 asylum applications in Jan–Mar 2026 (281 decisions against
 * 1.4 million pending) came to 15,106 months, against at most 842 in any
 * other quarter, and drawn to scale they flattened every other quarter into
 * a line at zero. The newest quarter is never clipped: when it is the spike,
 * that is the news, so nothing is. */
export function spikeCeiling(values: (number | null)[]): number | null {
  const known = values
    .filter((value): value is number => value !== null)
    .sort((a, b) => b - a);
  let spikes = 0;
  while (
    spikes + 1 < known.length &&
    known[spikes] > SPIKE_FACTOR * known[spikes + 1]
  )
    spikes += 1;
  if (spikes === 0) return null;
  const ceiling = known[spikes];
  const newest = values[values.length - 1];
  return newest !== null && newest !== undefined && newest > ceiling
    ? null
    : ceiling;
}

/** What the wait chart shows, in words, for screen readers: its span and the
 * newest quarter's figures, or why its time to clear the backlog is not
 * shown (`suppressed`, see clearingSuppressed). */
function describeWait(
  points: QuarterPoint[],
  subject: string,
  place: string | undefined,
  suppressed: string | null,
  lines: { name: string; key: string }[],
): string {
  const current = points[points.length - 1];
  const figures = [
    `time to clear the backlog ${
      suppressed === null
        ? approximately(formatMonths(current.waitMonths), current.approximate)
        : `not shown (${suppressed})`
    }`,
    ...lines.map(
      ({ name, key }) =>
        `${name} ${formatMonths(current.processingTimes[key] ?? null)}`,
    ),
  ];
  return `Line chart of the months it would take to decide every pending ${subject} application${
    place === undefined ? "" : ` ${place}`
  } at each quarter's pace${
    lines.length > 0 ? ", with USCIS's median processing time" : ""
  }, ${points[0].label} to ${current.label}. In ${
    current.label
  }: ${figures.join("; ")}.`;
}

/** Lines: the months it would take to decide every pending application at
 * each quarter's pace of decisions (the time to clear the backlog, which is
 * not a wait), next to USCIS's own median processing time where it publishes
 * one. */
export function WaitChart({
  points,
  subject,
  place,
  suppressed,
  processingTimeSeries,
  breaks = [],
}: Props & {
  /** Why the newest quarter's time to clear the backlog is not shown, if it
   * is not (see clearingSuppressed) */
  suppressed: string | null;
  processingTimeSeries: ProcessingTimeSeries[];
}) {
  const estimateName = "Time to clear backlog";
  const officialName = ({ label }: ProcessingTimeSeries) =>
    label === "" ? "USCIS median processing time" : `USCIS median: ${label}`;
  const values = points.map((point) =>
    point.waitMonths === null ? null : Math.round(point.waitMonths * 10) / 10,
  );
  const ceiling = spikeCeiling(values);
  // clipped spikes are drawn this far above the highest other quarter
  const clippedAt =
    ceiling === null ? null : Math.round(ceiling * 1.2 * 10) / 10;
  const suspects = points.some(
    ({ suspect, waitMonths }) => suspect && waitMonths !== null,
  );
  return (
    <Paper shadow="xs" p="md" mx={0} component="figure">
      <ReactEChartsCore
        style={{ width: "100%", height: "360px" }}
        echarts={echarts}
        option={{
          animation: false,
          color: [APPROVED_COLOR, ...EXTRA_COLORS],
          aria: {
            enabled: true,
            label: {
              description: describeWait(
                points,
                subject,
                place,
                suppressed,
                processingTimeSeries.map((series) => ({
                  name: officialName(series),
                  key: series.key,
                })),
              ),
            },
          },
          legend: processingTimeSeries.length > 0 ? LEGEND : undefined,
          tooltip: {
            trigger: "axis",
            formatter: (params: { dataIndex: number }[]) => {
              const point = points[params[0].dataIndex];
              return [
                `<strong>${point.label}</strong>`,
                `${estimateName}: ${approximately(
                  formatMonths(point.waitMonths),
                  point.approximate,
                )}`,
                `(${formatCount(point.pending)} pending, ${approximately(
                  formatCount(point.completions),
                  point.approximate,
                )} decided)`,
                ...processingTimeSeries.map(
                  (series) =>
                    `${officialName(series)}: ${formatMonths(
                      point.processingTimes[series.key] ?? null,
                    )}`,
                ),
                ...pointNotes(point),
              ].join("<br />");
            },
          },
          // room above the plot for the legend, then the axis name
          grid: {
            left: 64,
            right: 16,
            top: processingTimeSeries.length > 0 ? 56 : 32,
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
              data: values.map((value, index) =>
                value !== null &&
                ceiling !== null &&
                clippedAt !== null &&
                value > ceiling
                  ? {
                      value: clippedAt,
                      symbol: "triangle",
                      symbolSize: 14,
                      label: {
                        show: true,
                        position: "top",
                        formatter: "off scale",
                      },
                    }
                  : marked(value, points[index].suspect, APPROVED_COLOR),
              ),
              lineStyle: { width: 2 },
              symbolSize: 8,
              markLine: breakLines(points, breaks),
            },
            ...processingTimeSeries.map((series) => ({
              name: officialName(series),
              type: "line",
              data: points.map(
                (point) => point.processingTimes[series.key] ?? null,
              ),
              lineStyle: { width: 2, type: "dashed" },
              symbolSize: 8,
            })),
          ],
        }}
      />
      <figcaption>
        Time to clear backlog is the pending applications at the end of each
        quarter, divided by the decisions (approvals and denials) made per month
        during it.
        {processingTimeSeries.length > 0 &&
          " USCIS's median is how long the cases it decided in the quarter had taken."}
        {ceiling !== null &&
          " A triangle marks a quarter far off the top of the scale, such as one in which USCIS decided almost nothing; hover over or tap it for its numbers."}
        <Notes points={points} breaks={breaks} suspects={suspects} />
      </figcaption>
    </Paper>
  );
}
