import { useSyncExternalStore } from "react";

// Shared helpers for showing how fresh the data is. The dates in the data are
// UTC calendar days as ISO strings ("2026-07-13"), and everything here works
// on those strings, so no visitor's time zone can shift a date by a day.

const DAY_MS = 24 * 60 * 60 * 1000;

const dateFormatter = new Intl.DateTimeFormat("en-US", {
  dateStyle: "long",
  timeZone: "UTC",
});
const shortDateFormatter = new Intl.DateTimeFormat("en-US", {
  dateStyle: "medium",
  timeZone: "UTC",
});
const monthYearFormatter = new Intl.DateTimeFormat("en-US", {
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});
const monthOnlyFormatter = new Intl.DateTimeFormat("en-US", {
  month: "short",
  timeZone: "UTC",
});

/** The average length of a month in days. */
const MONTH_DAYS = 30.44;

// Today never changes while the page is open, as far as these pages care.
const subscribe = () => () => {};
const getToday = () => new Date().toISOString().slice(0, 10);
const getServerToday = () => null;

/** Today's UTC date, "2026-09-24", or null while prerendering and hydrating.
 *
 * The prerendered HTML is served for weeks after the build, so anything that
 * depends on today must render only once this returns a date, or it would
 * disagree with what React renders on hydration. */
export function useToday(): string | null {
  return useSyncExternalStore(subscribe, getToday, getServerToday);
}

/** Whole days from one ISO date to another: ("2026-07-13", "2026-09-24") is
 * 73, and it is negative when `to` is the earlier one. */
export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(to) - Date.parse(from)) / DAY_MS);
}

/** The ISO date some days after another: ("2026-07-13", -33) is
 * "2026-06-10". */
export function addDays(date: string, days: number): string {
  return new Date(Date.parse(date) + days * DAY_MS).toISOString().slice(0, 10);
}

/** An ISO date as "July 13, 2026". */
export function formatDate(date: string): string {
  return dateFormatter.format(new Date(date));
}

/** An ISO date as "Jul 13, 2026". */
export function formatShortDate(date: string): string {
  return shortDateFormatter.format(new Date(date));
}

/** The ISO date some months after another, counting average months:
 * ("2026-09-24", 11.2) is "2027-08-24". */
export function addMonths(date: string, months: number): string {
  return addDays(date, Math.round(months * MONTH_DAYS));
}

/** An ISO date as "Aug 2027". */
export function formatMonthYear(date: string): string {
  return monthYearFormatter.format(new Date(date));
}

/** Two ISO dates as a range of months: "Aug 2027 - Jul 2028", "Apr - Sep
 * 2027" within a year, or "Apr 2027" when both fall in the same month.
 * Non-breaking spaces keep each month with its year and the dash with the
 * start, so a narrow table cell wraps the range only between its ends. */
export function formatMonthRange(from: string, to: string): string {
  const start = formatMonthYear(from).replace(" ", "\u00a0");
  const end = formatMonthYear(to).replace(" ", "\u00a0");
  if (start === end) return start;
  if (from.slice(0, 4) === to.slice(0, 4))
    return `${monthOnlyFormatter.format(new Date(from))}\u00a0- ${end}`;
  return `${start}\u00a0- ${end}`;
}
