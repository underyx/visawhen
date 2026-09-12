import numeral from "numeral";

/** A consulate's usual monthly issuances for the list badges: "1.2K/mo",
 * "8.5/mo". */
export function formatMonthlyRate(issuances: number | undefined): string {
  const rate = issuances ?? 0;
  return `${numeral(rate)
    .format(rate > 10 ? "0a" : "0.0a")
    .toUpperCase()}/mo`;
}
