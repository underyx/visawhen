import { SegmentedControl } from "@mantine/core";
import React, { useEffect, useRef, useState } from "react";
import classes from "./Chart.module.css";

// What the charts (NvcChart, ConsulateChart, UscisChart, VisaBulletinChart)
// share. They are drawn as SVG by React, with scales and line shapes from
// visx, so the build writes each chart into its page's HTML: a phone shows it
// before any of the page's scripts have loaded. Once they have, the chart is
// redrawn at its box's width and answers taps, the pointer and the arrow keys.

/** The width the charts are drawn at in the page's HTML, before the page's
 * scripts measure their box: the box's width on a 390px phone, less the
 * page's and the box's padding. On other screens the HTML's chart is scaled
 * to fit until then. */
export const HTML_WIDTH = 324;

export interface Margin {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

/** A ref for a chart's box, and the width to draw the chart at: HTML_WIDTH
 * until the box is measured, then the box's width. */
export function useChartWidth(): [
  React.RefObject<HTMLDivElement | null>,
  number,
] {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(HTML_WIDTH);
  useEffect(() => {
    const box = ref.current;
    if (box === null) return;
    const observer = new ResizeObserver(([entry]) => {
      const measured = Math.round(entry.contentRect.width);
      // zero while the box is hidden
      if (measured > 0) setWidth(measured);
    });
    observer.observe(box);
    return () => observer.disconnect();
  }, []);
  return [ref, width];
}

/** The index of the value in `xs` (ascending) closest to `x` */
function nearest(xs: number[], x: number): number {
  let low = 0;
  let high = xs.length - 1;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (xs[middle] < x) low = middle + 1;
    else high = middle;
  }
  return low > 0 && x - xs[low - 1] < xs[low] - x ? low - 1 : low;
}

interface PlotProps {
  boxRef: React.RefObject<HTMLDivElement | null>;
  width: number;
  height: number;
  margin: Margin;
  /** What the chart shows, in words, for screen readers */
  description: string;
  /** The x of each point that can be picked, left to right, within the plot
   * area (the chart less its margins) */
  xs: number[];
  /** The width of the band to shade behind a picked bar; without it, a
   * picked point gets a vertical hairline */
  band?: number;
  /** What the tooltip says about the point at an index of `xs` */
  tooltip: (index: number) => React.ReactNode;
  /** The axes and marks, in the plot area's coordinates, given the index of
   * the picked point, if any */
  children: (picked: number | null) => React.ReactNode;
}

/** A chart's SVG and its tooltip. Moving the pointer over the chart, tapping
 * it, or pressing the arrow keys while it has the focus picks the nearest
 * point, and the tooltip says what its numbers are. */
export function Plot({
  boxRef,
  width,
  height,
  margin,
  description,
  xs,
  band,
  tooltip,
  children,
}: PlotProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [active, setActive] = useState<number | null>(null);
  const [byKeyboard, setByKeyboard] = useState(false);
  // a range button can leave fewer points than the picked index
  const picked = active !== null && active < xs.length ? active : null;
  const plotHeight = height - margin.top - margin.bottom;

  function pick(event: React.PointerEvent<SVGSVGElement>) {
    const svg = svgRef.current;
    if (svg === null || xs.length === 0) return;
    const rect = svg.getBoundingClientRect();
    const x = ((event.clientX - rect.left) * width) / rect.width - margin.left;
    setByKeyboard(false);
    setActive(nearest(xs, x));
  }

  function step(event: React.KeyboardEvent<SVGSVGElement>) {
    if (xs.length === 0) return;
    const last = xs.length - 1;
    const moves: Record<string, () => number | null> = {
      ArrowLeft: () => Math.max(0, (picked ?? last + 1) - 1),
      ArrowRight: () => Math.min(last, (picked ?? -1) + 1),
      Home: () => 0,
      End: () => last,
      Escape: () => null,
    };
    const move = moves[event.key];
    if (move === undefined) return;
    event.preventDefault();
    setByKeyboard(true);
    setActive(move());
  }

  const tooltipX = picked === null ? 0 : margin.left + xs[picked];
  return (
    <div ref={boxRef} className={classes.box}>
      <svg
        ref={svgRef}
        className={classes.plot}
        width="100%"
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={description}
        tabIndex={0}
        onPointerDown={pick}
        onPointerMove={pick}
        onPointerLeave={(event) => {
          // after a tap, the tooltip stays until the next one
          if (event.pointerType === "mouse") setActive(null);
        }}
        onKeyDown={step}
        onFocus={(event) => {
          // the newest point, for the keyboard; a click picks its own
          if (event.currentTarget.matches(":focus-visible")) {
            setByKeyboard(true);
            setActive(xs.length - 1);
          }
        }}
        onBlur={() => setActive(null)}
      >
        <g transform={`translate(${margin.left},${margin.top})`}>
          {picked !== null &&
            (band === undefined ? (
              <line
                className={classes.crosshair}
                x1={xs[picked]}
                x2={xs[picked]}
                y1={0}
                y2={plotHeight}
              />
            ) : (
              <rect
                className={classes.band}
                x={xs[picked] - band / 2}
                y={0}
                width={band}
                height={plotHeight}
              />
            ))}
          {children(picked)}
        </g>
      </svg>
      {picked !== null && (
        <div
          className={classes.tooltip}
          style={
            tooltipX > width / 2
              ? { right: width - tooltipX + 12 }
              : { left: tooltipX + 12 }
          }
          aria-live={byKeyboard ? "polite" : "off"}
        >
          {tooltip(picked)}
        </div>
      )}
    </div>
  );
}

/** The y-axis: a hairline across the plot at each tick, with its label to the
 * left, and the unit, if any, above the labels. */
export function YAxis<T>({
  ticks,
  y,
  width,
  format,
  unit,
  left,
}: {
  ticks: T[];
  y: (tick: T) => number;
  /** The plot area's width */
  width: number;
  format: (tick: T) => string;
  unit?: string;
  /** The margin to the left of the plot area, where the unit goes */
  left: number;
}) {
  return (
    <g>
      {ticks.map((tick) => (
        <g key={String(tick)} transform={`translate(0,${Math.round(y(tick))})`}>
          <line className={classes.grid} x1={0} x2={width} />
          <text x={-6} dy="0.32em" textAnchor="end">
            {format(tick)}
          </text>
        </g>
      ))}
      {unit !== undefined && (
        <text x={-left} y={-12}>
          {unit}
        </text>
      )}
    </g>
  );
}

/** The x-axis: a baseline at `y` across the plot, with labels under it */
export function XAxis({
  ticks,
  y,
  width,
}: {
  ticks: { x: number; label: string }[];
  y: number;
  /** The plot area's width */
  width: number;
}) {
  return (
    <g transform={`translate(0,${y})`}>
      <line className={classes.baseline} x1={0} x2={width} />
      {ticks.map(({ x, label }) => (
        <text key={label} x={Math.round(x)} y={18} textAnchor="middle">
          {label}
        </text>
      ))}
    </g>
  );
}

/** Every nth of `ticks`, counting back from the newest, so that labels are at
 * least `gap` pixels apart */
export function thin<T extends { x: number }>(ticks: T[], gap = 44): T[] {
  if (ticks.length < 2) return ticks;
  const spacing = (ticks[ticks.length - 1].x - ticks[0].x) / (ticks.length - 1);
  const every = Math.max(1, Math.ceil(gap / spacing));
  return ticks.filter((_, index) => (ticks.length - 1 - index) % every === 0);
}

/** A date tick as its year on January 1 and as its month otherwise:
 * "2025", "Apr" */
export function formatDateTick(date: Date): string {
  return date.getUTCMonth() === 0 && date.getUTCDate() === 1
    ? String(date.getUTCFullYear())
    : date.toLocaleDateString("en-US", { month: "short", timeZone: "UTC" });
}

export type Mark = "bar" | "line" | "dashed";

/** Dashes of a dashed line */
export const DASHES = "6 4";

/** A short sample of a series' mark, for its legend entry or tooltip line */
function Key({ color, mark }: { color: string; mark: Mark }) {
  return (
    <svg className={classes.key} width={16} height={10} aria-hidden>
      {mark === "bar" ? (
        <rect width={10} height={10} rx={2} fill={color} />
      ) : (
        <line
          x1={0}
          x2={16}
          y1={5}
          y2={5}
          stroke={color}
          strokeWidth={2}
          strokeDasharray={mark === "dashed" ? "4 3" : undefined}
        />
      )}
    </svg>
  );
}

export interface Series {
  name: string;
  color: string;
  mark: Mark;
}

/** The row above a plot: its legend, or its title when it has one series,
 * and its range buttons, if any */
export function ChartHeader({
  series,
  title,
  range,
}: {
  series?: Series[];
  title?: string;
  range?: React.ReactNode;
}) {
  return (
    <div className={classes.header}>
      {title !== undefined && <div className={classes.title}>{title}</div>}
      {series !== undefined && (
        <ul className={classes.legend}>
          {series.map(({ name, color, mark }) => (
            <li key={name}>
              <Key color={color} mark={mark} />
              {name}
            </li>
          ))}
        </ul>
      )}
      {range}
    </div>
  );
}

/** Buttons to pick how much of the chart's history to show: `labels[i]` for
 * option i */
export function RangeButtons({
  labels,
  value,
  onChange,
}: {
  labels: string[];
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <SegmentedControl
      className={classes.range}
      size="xs"
      aria-label="How many years to show"
      data={labels.map((label, index) => ({ label, value: String(index) }))}
      value={String(value)}
      onChange={(picked) => onChange(Number(picked))}
    />
  );
}

/** A line of the tooltip, keyed with its series' mark when it has one */
export function TooltipLine({
  series,
  children,
}: React.PropsWithChildren<{ series?: Series }>) {
  return (
    <div className={classes.tooltipLine}>
      {series !== undefined && <Key color={series.color} mark={series.mark} />}
      <span>{children}</span>
    </div>
  );
}

/** The class for text drawn over the marks, which gets a white halo */
export const ON_MARKS = classes.onMarks;

/** A column's outline: `radius` rounds its top corners, the end away from
 * the baseline */
export function columnPath(
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
): string {
  // to a tenth of a pixel: every column is in the page's HTML
  const n = (value: number) => Math.round(value * 10) / 10;
  const r = n(Math.max(0, Math.min(radius, width / 2, height)));
  const [left, top, right, bottom] = [x, y, x + width, y + height].map(n);
  if (r === 0) return `M${left},${bottom}V${top}H${right}V${bottom}Z`;
  return `M${left},${bottom}V${n(top + r)}Q${left},${top} ${n(
    left + r,
  )},${top}H${n(right - r)}Q${right},${top} ${right},${n(top + r)}V${bottom}Z`;
}

/** A diamond centred on (x, y): a point to look at twice */
export function Diamond({
  x,
  y,
  color,
}: {
  x: number;
  y: number;
  color: string;
}) {
  return (
    <path
      d={`M${x},${y - 7}L${x + 7},${y}L${x},${y + 7}L${x - 7},${y}Z`}
      fill="#fff"
      stroke={color}
      strokeWidth={2}
    />
  );
}

/** A dot centred on (x, y), ringed in the chart's white */
export function Dot({ x, y, color }: { x: number; y: number; color: string }) {
  return (
    <circle cx={x} cy={y} r={4} fill={color} stroke="#fff" strokeWidth={2} />
  );
}

/** The indices of `values` that have no value on either side, which a line
 * cannot show, so they are drawn as dots */
export function lonePoints(values: (number | null)[]): number[] {
  return values.flatMap((value, index) =>
    value !== null &&
    (values[index - 1] ?? null) === null &&
    (values[index + 1] ?? null) === null
      ? [index]
      : [],
  );
}
