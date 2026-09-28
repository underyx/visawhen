import type { MonthlyData, MonthlyRow } from "../api/uscis";
import { formatMonthYear } from "./Freshness";
import { ALL_CATEGORIES } from "./uscis";

// USCIS's monthly Application Processing Data report (data/uscis/monthly.py):
// newer than the quarterly all-forms report the rest of a form's page is
// built on, but for six forms only, nationwide, and counted separately, so
// its numbers do not add up to the quarterly report's.

/** How many months a form's page shows, the newest last. */
export const MONTHLY_MONTHS = 6;

/** One month of a form's (or a category's) numbers. */
export interface MonthlyPoint {
  /** "2026-08" */
  month: string;
  /** "Aug 2026" */
  label: string;
  /** Approvals plus denials */
  decided: number;
  pending: number;
  pendingOver6Months: number;
  /** USCIS's average processing time, in months, of the cases decided in the
   * month; null for categories added together that decided none */
  averageMonths: number | null;
}

export interface MonthlyNumbers {
  /** The newest MONTHLY_MONTHS months, oldest first */
  points: MonthlyPoint[];
  /** Whether the numbers are for all of the form's categories together while
   * the page's view is about one of them: USCIS splits only the I-485 by
   * category in this report */
  wholeForm: boolean;
  /** Whether the numbers add up several of the report's rows: all of the
   * I-485's categories together */
  combined: boolean;
  /** The newest month's report */
  source: string;
  /** USCIS's notes about the months shown in particular */
  notes: { label: string; text: string }[];
}

/** Rows added together. The average processing time of all their decisions
 * is the average of the rows' averages weighted by their decisions: USCIS
 * averages over the cases it completed in the month, which are its approvals
 * and denials. */
function combine(rows: MonthlyRow[]): Omit<MonthlyPoint, "month" | "label"> {
  const sum = (field: keyof Omit<MonthlyRow, "title">) =>
    rows.reduce((total, row) => total + row[field], 0);
  const decided = sum("approved") + sum("denied");
  const averageMonths =
    rows.length === 1
      ? rows[0].averageMonths
      : decided === 0
      ? null
      : rows.reduce(
          (total, row) =>
            total + row.averageMonths * (row.approved + row.denied),
          0,
        ) / decided;
  return {
    decided,
    pending: sum("pending"),
    pendingOver6Months: sum("pendingOver6Months"),
    averageMonths,
  };
}

/** The rows of one month's report for a view of a form's page (FormView.key):
 * the category's own row, or for all categories together every row of the
 * form; for a category of a form the report does not split, the form's one
 * row, as `wholeForm`. Null when the report has nothing for the view. */
function rowsFor(
  rows: Record<string, MonthlyRow> | undefined,
  viewKey: string,
): { rows: MonthlyRow[]; wholeForm: boolean } | null {
  if (rows === undefined) return null;
  if (viewKey !== ALL_CATEGORIES && rows[viewKey] !== undefined)
    return { rows: [rows[viewKey]], wholeForm: false };
  if (viewKey === ALL_CATEGORIES)
    return { rows: Object.values(rows), wholeForm: false };
  if (rows.all !== undefined) return { rows: [rows.all], wholeForm: true };
  return null;
}

/** A form's monthly numbers for a view of its page, or null when the monthly
 * report does not cover it. */
export function monthlyNumbers(
  data: MonthlyData,
  form: string,
  viewKey: string,
): MonthlyNumbers | null {
  const found = Object.keys(data.months)
    .sort()
    .flatMap((month) => {
      const picked = rowsFor(data.months[month].forms[form], viewKey);
      return picked === null ? [] : [{ month, ...picked }];
    })
    .slice(-MONTHLY_MONTHS);
  if (found.length === 0) return null;
  const newest = found[found.length - 1];
  return {
    points: found.map(({ month, rows }) => ({
      month,
      label: formatMonthYear(`${month}-01`),
      ...combine(rows),
    })),
    wholeForm: newest.wholeForm,
    combined: newest.rows.length > 1,
    source: data.months[newest.month].url,
    notes: found.flatMap(({ month }) =>
      (data.months[month].notes ?? []).map((text) => ({
        label: formatMonthYear(`${month}-01`),
        text,
      })),
    ),
  };
}
