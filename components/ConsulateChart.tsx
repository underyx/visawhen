import { IssuancesRow, VisaType } from "../api/consulates";
import { formatCount, formatMonth } from "./consulates";
import { ISSUANCE_STATISTICS_URLS } from "./links";

import { Paper } from "@mantine/core";
import { scaleBand, scaleLinear } from "@visx/scale";
import { useState } from "react";
import {
  ChartHeader,
  columnPath,
  Plot,
  RangeButtons,
  thin,
  TooltipLine,
  useChartWidth,
  XAxis,
  YAxis,
} from "./Chart";

/** State's listing of the monthly reports the counts come from */
const SOURCES: Record<VisaType, { kind: string; url: string }> = {
  IV: { kind: "immigrant", url: ISSUANCE_STATISTICS_URLS.IV },
  NIV: { kind: "nonimmigrant", url: ISSUANCE_STATISTICS_URLS.NIV },
};

/** Mantine's blue.7: 4.2:1 against the white of the chart, where bars need
 * 3:1 */
const BAR_COLOR = "#1c7ed6";
const SERIES_NAME = "Visas issued per month";

/** How many months the chart shows at first: three years, three of each
 * season */
const FIRST_MONTHS = 36;

const HEIGHT = 340;
const MARGIN = { top: 8, right: 8, bottom: 28, left: 44 };

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
  const [boxRef, width] = useChartWidth();
  const [range, setRange] = useState(0);
  const rows = range === 0 ? issuances.slice(-FIRST_MONTHS) : issuances;
  const plotWidth = width - MARGIN.left - MARGIN.right;
  const plotHeight = HEIGHT - MARGIN.top - MARGIN.bottom;
  const step = plotWidth / rows.length;
  const x = scaleBand({
    domain: rows.map((row) => row.month),
    range: [0, plotWidth],
    // a 2px gap between bars where they are wide enough to spare it
    paddingInner: step > 6 ? 2 / step : 0.25,
  });
  const barWidth = Math.min(24, x.bandwidth());
  const y = scaleLinear({
    domain: [0, Math.max(1, ...rows.map((row) => row.issuances))],
    range: [plotHeight, 0],
    nice: true,
  });
  const xs = rows.map((row) => (x(row.month) ?? 0) + x.bandwidth() / 2);
  const januaries = rows.flatMap((row, index) =>
    row.month.slice(5, 7) === "01"
      ? [{ x: xs[index], label: row.month.slice(0, 4) }]
      : [],
  );
  return (
    <Paper withBorder p="md" mx={0} component="figure">
      <ChartHeader
        title={SERIES_NAME}
        range={
          issuances.length > FIRST_MONTHS && (
            <RangeButtons
              labels={["Last 3 years", "All years"]}
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
        description={describe(issuances, subject)}
        xs={xs}
        band={x.step()}
        tooltip={(index) => (
          <>
            <strong>{formatMonth(rows[index].month)}</strong>
            <TooltipLine
              series={{ name: SERIES_NAME, color: BAR_COLOR, mark: "bar" }}
            >
              {formatCount(rows[index].issuances)} visas issued
            </TooltipLine>
          </>
        )}
      >
        {() => (
          <>
            <YAxis
              // Whole visas only: a class with at most a visa or two a month
              // would otherwise get ticks at 0.5, 1.5 and so on.
              ticks={y.ticks(5).filter(Number.isInteger)}
              y={y}
              width={plotWidth}
              format={formatCount}
              left={MARGIN.left}
            />
            {rows.map((row, index) => {
              const top = y(row.issuances);
              return (
                <path
                  key={row.month}
                  d={columnPath(
                    xs[index] - barWidth / 2,
                    top,
                    barWidth,
                    plotHeight - top,
                    barWidth >= 8 ? 4 : 0,
                  )}
                  fill={BAR_COLOR}
                />
              );
            })}
            <XAxis ticks={thin(januaries)} y={plotHeight} width={plotWidth} />
          </>
        )}
      </Plot>
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
