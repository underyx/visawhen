import { Paper } from "@mantine/core";
import { curveStepAfter } from "@visx/curve";
import { scaleUtc } from "@visx/scale";
import { LinePath } from "@visx/shape";
import React, { useState } from "react";
import {
  ChartHeader,
  DASHES,
  Dot,
  formatDateTick,
  lonePoints,
  Plot,
  RangeButtons,
  Series as ChartSeries,
  thin,
  TooltipLine,
  useChartWidth,
  XAxis,
  YAxis,
} from "./Chart";
import { VISA_BULLETIN_URL } from "./links";
import {
  addMonthsToMonth,
  CHARTS,
  ChartKey,
  formatBulletinMonth,
  formatCutoff,
  isDate,
  monthStart,
  Series,
} from "./visaBulletin";

interface Props {
  /** The category's cutoffs in the area, per chart */
  series: Record<ChartKey, Series>;
  /** The data file on GitHub */
  dataUrl: string;
  /** What the chart is of, for screen readers: "F4, Philippines" */
  label: string;
}

const KEYS = Object.keys(CHARTS) as ChartKey[];

/** The two charts' lines: the site's stamp violet and a lighter ink (ink.4,
 * 4.2:1 on white), the second one dashed as well */
const LINES: Record<ChartKey, ChartSeries> = {
  finalAction: { name: CHARTS.finalAction, color: "#5b3a94", mark: "line" },
  datesForFiling: {
    name: CHARTS.datesForFiling,
    color: "#677da6",
    mark: "dashed",
  },
};

/** How many bulletins the "Last 5 years" button shows */
const RECENT_MONTHS = 60;

const HEIGHT = 340;
const MARGIN = { top: 8, right: 12, bottom: 28, left: 64 };

const tickMonthFormatter = new Intl.DateTimeFormat("en-US", {
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});

/** A bulletin: its month, "2026-10", and each chart's cutoff in it, if the
 * chart has the category and area that month */
interface Bulletin {
  month: string;
  cutoffs: Partial<Record<ChartKey, string>>;
}

/** Every month either chart has a cutoff for, oldest first */
function bulletins(series: Record<ChartKey, Series>): Bulletin[] {
  const byMonth = new Map<string, Bulletin>();
  for (const key of KEYS)
    for (const [month, cutoff] of series[key]) {
      const bulletin = byMonth.get(month) ?? { month, cutoffs: {} };
      bulletin.cutoffs[key] = cutoff;
      byMonth.set(month, bulletin);
    }
  return [...byMonth.values()].sort((a, b) => a.month.localeCompare(b.month));
}

/** A chart's cutoff in a bulletin as a date, or null when it has none: the
 * category is "C" (current) or "U" (unavailable) or not in the chart */
function cutoffDate(bulletin: Bulletin, key: ChartKey): Date | null {
  const cutoff = bulletin.cutoffs[key];
  return cutoff !== undefined && isDate(cutoff) ? new Date(cutoff) : null;
}

/** The chart in words, for screen readers: its span and the last 6
 * bulletins' Final Action Dates */
function describe(label: string, series: Series): string {
  if (series.length === 0) return `No Visa Bulletin data for ${label}.`;
  const recent = series
    .slice(-6)
    .map(
      ([month, cutoff]) =>
        `${formatBulletinMonth(month)}: ${formatCutoff(cutoff)}`,
    )
    .join("; ");
  return `Line chart of the Visa Bulletin cutoff dates for ${label}, ${formatBulletinMonth(
    series[0][0],
  )} to ${formatBulletinMonth(
    series[series.length - 1][0],
  )}. Final Action Dates in the last 6 bulletins: ${recent}.`;
}

export default function VisaBulletinChart({ series, dataUrl, label }: Props) {
  const [boxRef, width] = useChartWidth();
  // every bulletin at first, which fits: about 12 a year since October 2015
  const [range, setRange] = useState(1);
  const all = bulletins(series);
  const from = addMonthsToMonth(all[all.length - 1].month, -RECENT_MONTHS + 1);
  const shown = range === 0 ? all.filter(({ month }) => month >= from) : all;
  const plotWidth = width - MARGIN.left - MARGIN.right;
  const plotHeight = HEIGHT - MARGIN.top - MARGIN.bottom;
  const x = scaleUtc({
    domain: [
      new Date(monthStart(shown[0].month)),
      new Date(monthStart(shown[shown.length - 1].month)),
    ],
    range: [0, plotWidth],
  });
  const xs = shown.map(({ month }) => x(new Date(monthStart(month))));
  // the cutoffs shown, or all of them when none are: a category current
  // for the last five years
  const cutoffTimes = (bulletins: Bulletin[]) =>
    bulletins.flatMap((bulletin) =>
      KEYS.flatMap((key) => cutoffDate(bulletin, key)?.getTime() ?? []),
    );
  const times =
    cutoffTimes(shown).length > 0 ? cutoffTimes(shown) : cutoffTimes(all);
  const y = scaleUtc({
    domain: [new Date(Math.min(...times)), new Date(Math.max(...times))],
    range: [plotHeight, 0],
    nice: true,
  });
  const yTicks = y.ticks(5);
  const years = yTicks.every(
    (tick) => tick.getUTCMonth() === 0 && tick.getUTCDate() === 1,
  );
  const xTicks = x.ticks(Math.max(2, Math.floor(plotWidth / 48)));
  return (
    <Paper withBorder p="md" mx={0} component="figure">
      <ChartHeader
        series={KEYS.map((key) => LINES[key])}
        range={
          all[0].month < from && (
            <RangeButtons
              labels={["Last 5 years", "All years"]}
              value={range}
              onChange={setRange}
            />
          )
        }
      />
      <Plot
        boxRef={boxRef}
        width={width}
        height={HEIGHT}
        margin={MARGIN}
        description={describe(label, series.finalAction)}
        xs={xs}
        tooltip={(index) => (
          <>
            <strong>{formatBulletinMonth(shown[index].month)} bulletin</strong>
            {KEYS.map((key) => {
              const cutoff = shown[index].cutoffs[key];
              return (
                cutoff !== undefined && (
                  <TooltipLine key={key} series={LINES[key]}>
                    {CHARTS[key]}: {formatCutoff(cutoff)}
                  </TooltipLine>
                )
              );
            })}
          </>
        )}
      >
        {(picked) => (
          <>
            <YAxis
              ticks={yTicks}
              y={y}
              width={plotWidth}
              format={(tick) =>
                years
                  ? String(tick.getUTCFullYear())
                  : tickMonthFormatter.format(tick)
              }
              left={MARGIN.left}
            />
            <XAxis
              ticks={thin(
                xTicks.map((tick) => ({
                  x: x(tick),
                  label: formatDateTick(tick),
                })),
              )}
              y={plotHeight}
              width={plotWidth}
            />
            {KEYS.map((key) => {
              const cutoffs = shown.map((bulletin) =>
                cutoffDate(bulletin, key),
              );
              const pickedCutoff = picked === null ? null : cutoffs[picked];
              return (
                <React.Fragment key={key}>
                  <LinePath<Date | null>
                    data={cutoffs}
                    x={(_, index) => xs[index]}
                    y={(cutoff) => y(cutoff ?? 0)}
                    defined={(cutoff) => cutoff !== null}
                    curve={curveStepAfter}
                    stroke={LINES[key].color}
                    strokeWidth={2}
                    strokeDasharray={
                      LINES[key].mark === "dashed" ? DASHES : undefined
                    }
                    fill="none"
                  />
                  {lonePoints(
                    cutoffs.map((cutoff) => cutoff?.getTime() ?? null),
                  ).map((index) => (
                    <Dot
                      key={index}
                      x={xs[index]}
                      y={y(cutoffs[index] ?? 0)}
                      color={LINES[key].color}
                    />
                  ))}
                  {picked !== null && pickedCutoff !== null && (
                    <Dot
                      x={xs[picked]}
                      y={y(pickedCutoff)}
                      color={LINES[key].color}
                    />
                  )}
                </React.Fragment>
              );
            })}
          </>
        )}
      </Plot>
      <figcaption>
        Source: the State Department&rsquo;s{" "}
        <a href={VISA_BULLETIN_URL}>monthly Visa Bulletins</a>. Each line shows
        the cutoff date in each month&rsquo;s bulletin. There is a gap where the
        category was current (no cutoff) or unavailable. All the bulletins since
        October 2015 are in a <a href={dataUrl}>JSON file on GitHub</a>.
      </figcaption>
    </Paper>
  );
}
