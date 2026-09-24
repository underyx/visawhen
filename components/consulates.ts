// Whole numbers up to 999, then thousands with up to one decimal: "462",
// "1.5K", "57.8K".
const compactRateFormatter = new Intl.NumberFormat("en-US", {
  notation: "compact",
  maximumFractionDigits: 1,
});

/** An average monthly issuance rate for the list badges: "0.1/mo", "8.5/mo",
 * "462/mo", "1.5K/mo", "0/mo". */
export function formatMonthlyRate(issuances: number | undefined): string {
  const rate = issuances ?? 0;
  if (rate === 0) return "0/mo";
  if (rate < 9.95) return `${rate.toFixed(1)}/mo`;
  // Round to whole visas first, so 999.6 shows as "1K", not "1000".
  return `${compactRateFormatter.format(Math.round(rate))}/mo`;
}

// The months in the data are stored as UTC midnight on their first day;
// format them in UTC, or a visitor in an American time zone would see the
// previous month, and the client render would disagree with the prerendered
// HTML.
const shortMonthFormatter = new Intl.DateTimeFormat("en-US", {
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});
const longMonthFormatter = new Intl.DateTimeFormat("en-US", {
  month: "long",
  year: "numeric",
  timeZone: "UTC",
});

/** A month from the data, "2025-09-01T00:00:00.000Z", as "Sep 2025". */
export function formatMonth(month: string): string {
  return shortMonthFormatter.format(new Date(month));
}

/** A month from the data, "2025-09-01T00:00:00.000Z", as "September 2025". */
export function formatLongMonth(month: string): string {
  return longMonthFormatter.format(new Date(month));
}

/** A count of visas as "5,538". */
export function formatCount(count: number): string {
  return Math.round(count).toLocaleString("en-US");
}
