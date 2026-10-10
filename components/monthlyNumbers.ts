import type { MonthlyData, MonthlyRow } from "../api/uscis";
import { formatMonthYear } from "./dates";
import { ALL_CATEGORIES, flowCheck, type QuarterPoint } from "./uscis";

// USCIS's monthly Application Processing Data report (data/uscis/monthly.py):
// newer than the quarterly all-forms report the rest of a form's page is
// built on, but for six forms only, and nationwide. Where it has the numbers
// of a page's view, the cards show its newest month instead of the newest
// quarter, so that a visitor sees the newest numbers without having to know
// which report they come from.

/** How many months a form's page lists, the newest last: enough for the
 * cards' check of whether USCIS had nearly stopped deciding these the month
 * before (stalled), which looks at the four months before that. */
export const MONTHLY_MONTHS = 6;

export interface MonthlyNumbers {
  /** The newest MONTHLY_MONTHS months, oldest first, as points of a series
   * of months: `quarter` is the month ("2026-08"), `label` "Aug 2026", and
   * the time to clear the backlog is at the month's pace */
  points: QuarterPoint[];
  /** The newest month's report */
  source: string;
  /** USCIS's notes about the months shown in particular */
  notes: { label: string; text: string }[];
}

/** The rows of one month's report for a view of a form's page (FormView.key):
 * the category's own row, or for all categories together every row of the
 * form. Null when the report has no row for the view: USCIS splits only the
 * I-485 by category in this report, and a page's view of one category of
 * another form (the I-130's immediate relatives) is not what its one row
 * counts. */
function rowsFor(
  rows: Record<string, MonthlyRow> | undefined,
  viewKey: string,
): MonthlyRow[] | null {
  if (rows === undefined) return null;
  if (viewKey === ALL_CATEGORIES) return Object.values(rows);
  return rows[viewKey] === undefined ? null : [rows[viewKey]];
}

/** One month's rows added together, as a point of a series of months. */
function toPoint(month: string, rows: MonthlyRow[]): QuarterPoint {
  const sum = (field: "received" | "approved" | "denied" | "pending") =>
    rows.reduce((total, row) => total + row[field], 0);
  const approved = sum("approved");
  const completions = approved + sum("denied");
  const pending = sum("pending");
  return {
    quarter: month,
    label: formatMonthYear(`${month}-01`),
    received: sum("received"),
    approved,
    denied: sum("denied"),
    pending,
    completions,
    approximate: false,
    waitMonths: completions === 0 ? null : pending / completions,
    approvalRate: completions === 0 ? null : approved / completions,
    approvalRange: null,
    processingTimes: {},
    flow: "unknown",
    suspect: false,
    fromOfficeReport: false,
  };
}

/** A form's monthly numbers for a view of its page, or null when the monthly
 * report does not cover the view. */
export function monthlyNumbers(
  data: MonthlyData,
  form: string,
  viewKey: string,
): MonthlyNumbers | null {
  const found = Object.keys(data.months)
    .sort()
    .flatMap((month) => {
      const rows = rowsFor(data.months[month].forms[form], viewKey);
      return rows === null ? [] : [{ month, rows }];
    });
  if (found.length === 0) return null;
  // the pending counts are checked against the months before the ones shown
  // too, as the first one shown has a month before it
  const points = flowCheck(
    found.map(({ month, rows }) => toPoint(month, rows)),
  ).slice(-MONTHLY_MONTHS);
  const shown = found.slice(-MONTHLY_MONTHS);
  return {
    points,
    source: data.months[shown[shown.length - 1].month].url,
    notes: shown.flatMap(({ month }) =>
      (data.months[month].notes ?? []).map((text) => ({
        label: formatMonthYear(`${month}-01`),
        text,
      })),
    ),
  };
}
