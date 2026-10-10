import { useSyncExternalStore } from "react";

// Today's date, for showing how fresh the data is. The date helpers that
// used to live here are in dates.ts, which has no React in it, so that the
// logic modules and their tests can import them; they are re-exported here
// so that the pages' imports keep working.
export {
  addDays,
  addMonths,
  daysBetween,
  formatDate,
  formatMonthRange,
  formatMonthYear,
  formatShortDate,
} from "./dates";

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
