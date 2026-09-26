import { Paper } from "@mantine/core";
import { scaleBand, scaleLinear } from "@visx/scale";
import { LinePath } from "@visx/shape";
import numeral from "numeral";
import React, { useState } from "react";
import {
  ChartHeader,
  columnPath,
  DASHES,
  Diamond,
  Dot,
  lonePoints,
  ON_MARKS,
  Plot,
  RangeButtons,
  Series,
  thin,
  TooltipLine,
  useChartWidth,
  XAxis,
  YAxis,
} from "./Chart";
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

/** The quarters a chart shows, picked with its range buttons: the last
 * CHART_QUARTERS at first, or all of them. Returns them, where each goes
 * across a plot `plotWidth` wide, the year labels under them, and the
 * buttons (null when there are no more quarters to show). */
function useQuarters(points: QuarterPoint[], plotWidth: number) {
  const [range, setRange] = useState(0);
  const shown = range === 0 ? points.slice(-CHART_QUARTERS) : points;
  const step = plotWidth / shown.length;
  const x = scaleBand({
    domain: shown.map(({ quarter }) => quarter),
    range: [0, plotWidth],
    // a 2px gap between bars where they are wide enough to spare it
    paddingInner: step > 6 ? 2 / step : 0.25,
  });
  const xs = shown.map(({ quarter }) => (x(quarter) ?? 0) + x.bandwidth() / 2);
  // each year under its first quarter: "2024-Q1"
  const ticks = thin(
    shown.flatMap(({ quarter }, index) =>
      quarter.endsWith("Q1")
        ? [{ x: xs[index], label: quarter.slice(0, 4) }]
        : [],
    ),
  );
  const buttons =
    points.length > CHART_QUARTERS ? (
      <RangeButtons
        labels={["Last 6 years", "All years"]}
        value={range}
        onChange={setRange}
      />
    ) : null;
  return { shown, x, xs, ticks, buttons };
}

/** Dashed vertical lines at the `breaks` among the quarters `shown`, each
 * with its label at the top */
function BreakLines({
  shown,
  xs,
  breaks,
  plotWidth,
  plotHeight,
}: {
  shown: QuarterPoint[];
  xs: number[];
  breaks: ChartBreak[];
  plotWidth: number;
  plotHeight: number;
}) {
  return breaks.map((chartBreak) => {
    const index = shown.findIndex(
      ({ quarter }) => quarter === chartBreak.quarter,
    );
    if (index === -1) return null;
    const x = Math.round(xs[index]);
    // the label goes on the side with more room
    const left = x > plotWidth / 2;
    return (
      <g key={chartBreak.quarter}>
        <line
          x1={x}
          x2={x}
          y1={0}
          y2={plotHeight}
          stroke={BREAK_COLOR}
          strokeDasharray={DASHES}
        />
        <text
          className={ON_MARKS}
          x={left ? x - 4 : x + 4}
          y={10}
          textAnchor={left ? "end" : "start"}
          style={{ fill: BREAK_COLOR, fontSize: 11 }}
        >
          {chartBreak.label}
        </text>
      </g>
    );
  });
}

/** A line of a chart: its series, and its value at each quarter shown */
interface Line {
  series: Series;
  values: (number | null)[];
}

/** Ticks for a y-axis of counts, as "1.2k" */
function formatCountTick(value: number): string {
  return numeral(value).format("0.[0]a");
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

const OUTCOMES_HEIGHT = 380;
const OUTCOMES_MARGIN = { top: 12, right: 8, bottom: 28, left: 44 };

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
  const [boxRef, width] = useChartWidth();
  const margin = OUTCOMES_MARGIN;
  const plotWidth = width - margin.left - margin.right;
  const plotHeight = OUTCOMES_HEIGHT - margin.top - margin.bottom;
  const { shown, x, xs, ticks, buttons } = useQuarters(points, plotWidth);
  const y = scaleLinear({
    domain: [
      0,
      Math.max(
        1,
        ...shown.flatMap((point) => [
          (point.approved ?? 0) + (point.denied ?? 0),
          point.pending ?? 0,
          point.received ?? 0,
        ]),
      ),
    ],
    range: [plotHeight, 0],
    nice: true,
  });
  const barWidth = Math.min(24, x.bandwidth());
  const radius = barWidth >= 8 ? 4 : 0;
  const approved: Series = {
    name: "Approved",
    color: APPROVED_COLOR,
    mark: "bar",
  };
  const denied: Series = { name: "Denied", color: DENIED_COLOR, mark: "bar" };
  const pending: Series = {
    name: "Pending at quarter end",
    color: PENDING_COLOR,
    mark: "line",
  };
  const filed: Series = {
    // as in the text: only for routing in the quarters shown at first; an
    // older quarter's tooltip still says it
    name: points
      .slice(-CHART_QUARTERS)
      .some(({ quarter }) => routed.includes(quarter))
      ? "Filed (or routed here)"
      : "Filed",
    color: RECEIVED_COLOR,
    mark: "dashed",
  };
  const lines: Line[] = [
    { series: pending, values: shown.map((point) => point.pending) },
    { series: filed, values: shown.map((point) => point.received) },
  ];
  return (
    <Paper withBorder p="md" mx={0} component="figure">
      <ChartHeader
        series={[approved, denied, pending, filed]}
        range={buttons}
      />
      <Plot
        boxRef={boxRef}
        width={width}
        height={OUTCOMES_HEIGHT}
        margin={margin}
        description={describeOutcomes(points, subject, place)}
        xs={xs}
        band={x.step()}
        tooltip={(index) => {
          const point = shown[index];
          return (
            <>
              <strong>{point.label}</strong>
              <TooltipLine series={filed}>
                {routed.includes(point.quarter)
                  ? "Filed or routed here"
                  : "Filed"}
                : {formatCount(point.received)}
              </TooltipLine>
              <TooltipLine series={approved}>
                Approved: {formatCount(point.approved)}
              </TooltipLine>
              <TooltipLine series={denied}>
                Denied: {formatCount(point.denied)}
              </TooltipLine>
              <TooltipLine series={pending}>
                Pending at quarter end: {formatCount(point.pending)}
              </TooltipLine>
              <TooltipLine>
                Time to clear backlog at that pace:{" "}
                {approximately(
                  formatMonths(point.waitMonths),
                  point.approximate,
                )}
              </TooltipLine>
              {pointNotes(point).map((note) => (
                <TooltipLine key={note}>{note}</TooltipLine>
              ))}
            </>
          );
        }}
      >
        {(picked) => (
          <>
            <YAxis
              ticks={y.ticks(5)}
              y={y}
              width={plotWidth}
              format={formatCountTick}
              left={margin.left}
            />
            {shown.map((point, index) => {
              const left = xs[index] - barWidth / 2;
              const approvedCount = point.approved ?? 0;
              const deniedCount = point.denied ?? 0;
              const approvedTop = y(approvedCount);
              const top = y(approvedCount + deniedCount);
              // the white gap between the two, which a thin sliver of
              // denials does not have room for
              const gap =
                approvedCount > 0 ? Math.min(2, (approvedTop - top) / 3) : 0;
              return (
                <g key={point.quarter}>
                  {approvedCount > 0 && (
                    <path
                      d={columnPath(
                        left,
                        approvedTop,
                        barWidth,
                        plotHeight - approvedTop,
                        deniedCount > 0 ? 0 : radius,
                      )}
                      fill={APPROVED_COLOR}
                    />
                  )}
                  {deniedCount > 0 && (
                    <path
                      d={columnPath(
                        left,
                        top,
                        barWidth,
                        approvedTop - top - gap,
                        radius,
                      )}
                      fill={DENIED_COLOR}
                    />
                  )}
                </g>
              );
            })}
            <XAxis ticks={ticks} y={plotHeight} width={plotWidth} />
            <BreakLines
              shown={shown}
              xs={xs}
              breaks={breaks}
              plotWidth={plotWidth}
              plotHeight={plotHeight}
            />
            {lines.map(({ series, values }) => (
              <React.Fragment key={series.name}>
                <LinePath<number | null>
                  data={values}
                  x={(_, index) => xs[index]}
                  y={(value) => y(value ?? 0)}
                  defined={(value) => value !== null}
                  stroke={series.color}
                  strokeWidth={2}
                  strokeDasharray={
                    series.mark === "dashed" ? DASHES : undefined
                  }
                  strokeLinejoin="round"
                  strokeLinecap="round"
                  fill="none"
                />
                {[
                  ...lonePoints(values),
                  ...(picked === null ? [] : [picked]),
                ].map((index, order) => {
                  const value = values[index];
                  return (
                    value !== null && (
                      <Dot
                        key={order}
                        x={xs[index]}
                        y={y(value)}
                        color={series.color}
                      />
                    )
                  );
                })}
              </React.Fragment>
            ))}
            {shown.map(
              (point, index) =>
                point.suspect &&
                point.pending !== null && (
                  <Diamond
                    key={point.quarter}
                    x={xs[index]}
                    y={y(point.pending)}
                    color={PENDING_COLOR}
                  />
                ),
            )}
          </>
        )}
      </Plot>
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

const WAIT_HEIGHT = 320;
const WAIT_MARGIN = { top: 28, right: 8, bottom: 28, left: 36 };

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
  const [boxRef, width] = useChartWidth();
  const margin = WAIT_MARGIN;
  const plotWidth = width - margin.left - margin.right;
  const plotHeight = WAIT_HEIGHT - margin.top - margin.bottom;
  const { shown, xs, ticks, buttons } = useQuarters(points, plotWidth);
  const start = points.length - shown.length;
  /** Whether the value at an index of `shown` is a spike drawn off scale */
  const offScale = (index: number) => {
    const value = values[start + index];
    return value !== null && ceiling !== null && value > ceiling;
  };
  const estimate: Line = {
    series: { name: estimateName, color: APPROVED_COLOR, mark: "line" },
    values: shown.map((_, index) =>
      offScale(index) ? clippedAt : values[start + index],
    ),
  };
  const officials = processingTimeSeries.map(
    (series, index): Line => ({
      series: {
        name: officialName(series),
        color: EXTRA_COLORS[index % EXTRA_COLORS.length],
        mark: "dashed",
      },
      values: shown.map((point) => point.processingTimes[series.key] ?? null),
    }),
  );
  const lines = [estimate, ...officials];
  const y = scaleLinear({
    domain: [
      0,
      Math.max(
        1,
        ...lines.flatMap(({ values }) =>
          values.filter((value): value is number => value !== null),
        ),
      ),
    ],
    range: [plotHeight, 0],
    nice: true,
  });
  return (
    <Paper withBorder p="md" mx={0} component="figure">
      <ChartHeader
        {...(officials.length > 0
          ? { series: lines.map(({ series }) => series) }
          : { title: estimateName })}
        range={buttons}
      />
      <Plot
        boxRef={boxRef}
        width={width}
        height={WAIT_HEIGHT}
        margin={margin}
        description={describeWait(
          points,
          subject,
          place,
          suppressed,
          processingTimeSeries.map((series) => ({
            name: officialName(series),
            key: series.key,
          })),
        )}
        xs={xs}
        tooltip={(index) => {
          const point = shown[index];
          return (
            <>
              <strong>{point.label}</strong>
              <TooltipLine series={estimate.series}>
                {estimateName}:{" "}
                {approximately(
                  formatMonths(point.waitMonths),
                  point.approximate,
                )}
              </TooltipLine>
              <TooltipLine>
                ({formatCount(point.pending)} pending,{" "}
                {approximately(
                  formatCount(point.completions),
                  point.approximate,
                )}{" "}
                decided)
              </TooltipLine>
              {processingTimeSeries.map((series, seriesIndex) => (
                <TooltipLine
                  key={series.key}
                  series={officials[seriesIndex].series}
                >
                  {officialName(series)}:{" "}
                  {formatMonths(point.processingTimes[series.key] ?? null)}
                </TooltipLine>
              ))}
              {pointNotes(point).map((note) => (
                <TooltipLine key={note}>{note}</TooltipLine>
              ))}
            </>
          );
        }}
      >
        {(picked) => (
          <>
            <YAxis
              ticks={y.ticks(4)}
              y={y}
              width={plotWidth}
              format={String}
              unit="months"
              left={margin.left}
            />
            <XAxis ticks={ticks} y={plotHeight} width={plotWidth} />
            <BreakLines
              shown={shown}
              xs={xs}
              breaks={breaks}
              plotWidth={plotWidth}
              plotHeight={plotHeight}
            />
            {lines.map(({ series, values }) => (
              <React.Fragment key={series.name}>
                <LinePath<number | null>
                  data={values}
                  x={(_, index) => xs[index]}
                  y={(value) => y(value ?? 0)}
                  defined={(value) => value !== null}
                  stroke={series.color}
                  strokeWidth={2}
                  strokeDasharray={
                    series.mark === "dashed" ? DASHES : undefined
                  }
                  strokeLinejoin="round"
                  strokeLinecap="round"
                  fill="none"
                />
                {[
                  ...lonePoints(values),
                  ...(picked === null ? [] : [picked]),
                ].map((index, order) => {
                  const value = values[index];
                  return (
                    value !== null && (
                      <Dot
                        key={order}
                        x={xs[index]}
                        y={y(value)}
                        color={series.color}
                      />
                    )
                  );
                })}
              </React.Fragment>
            ))}
            {shown.map((point, index) => {
              const value = estimate.values[index];
              if (value === null) return null;
              if (offScale(index))
                return (
                  <g key={point.quarter}>
                    <path
                      d={`M${xs[index]},${y(value) - 7}L${xs[index] + 7},${
                        y(value) + 6
                      }L${xs[index] - 7},${y(value) + 6}Z`}
                      fill={APPROVED_COLOR}
                      stroke="#fff"
                      strokeWidth={2}
                    />
                    <text
                      className={ON_MARKS}
                      x={xs[index]}
                      y={y(value) - 12}
                      textAnchor="middle"
                    >
                      off scale
                    </text>
                  </g>
                );
              return (
                point.suspect && (
                  <Diamond
                    key={point.quarter}
                    x={xs[index]}
                    y={y(value)}
                    color={APPROVED_COLOR}
                  />
                )
              );
            })}
          </>
        )}
      </Plot>
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
