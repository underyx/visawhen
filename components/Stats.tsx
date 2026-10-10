import { Text } from "@mantine/core";
import React from "react";
import classes from "./Stats.module.css";

// The headline figures of a page, as a strip of boxes (UscisStats, the
// interview-scheduling card): a caption, a big value and a line under it.

// a non-breaking space keeps the boxes the same height when one has no
// line to show under its value
const NO_LINE = " ";

/** A box's big figure. Not a heading: screen readers' heading lists would
 * read "5.2 years" and "78%" as section titles. */
export function StatValue({ children }: React.PropsWithChildren) {
  return <Text className={classes.boxValue}>{children}</Text>;
}

/** A box's value when there is none to show, with why. */
export function NotShown({ children }: React.PropsWithChildren) {
  return (
    <Text fw={700} lh={1.3}>
      {children}
    </Text>
  );
}

export interface StatProps {
  label: string;
  /** A string is set big (StatValue); anything else is placed as it is */
  value: React.ReactNode;
  /** The line under the value */
  line: string | null;
  /** A Mantine colour for the line: "dimmed", "teal.9", "red.9" */
  lineColor?: string;
}

export function Stat({ label, value, line, lineColor = "dimmed" }: StatProps) {
  return (
    <div className={classes.box}>
      <Text className={classes.boxLabel}>{label}</Text>
      {typeof value === "string" ? <StatValue>{value}</StatValue> : value}
      <Text size="xs" c={lineColor}>
        {line ?? NO_LINE}
      </Text>
    </div>
  );
}

interface StatsProps {
  /** How many boxes go in a row from sm up (4), and on a phone (2) */
  columns?: number;
  phoneColumns?: number;
}

/** The strip the boxes sit in. */
export function Stats({
  columns,
  phoneColumns,
  children,
}: React.PropsWithChildren<StatsProps>) {
  const style = {
    "--stat-columns": columns,
    "--stat-columns-phone": phoneColumns,
  } as React.CSSProperties;
  return (
    <div className={classes.boxes} style={style}>
      {children}
    </div>
  );
}
