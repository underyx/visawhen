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
