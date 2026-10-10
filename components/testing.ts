// Builders for the tests of the USCIS logic (uscis.test.ts and the others):
// a quarter's point or period with every field filled in, so that a test
// names only the numbers it is about.
import type { Period, QuarterCounts } from "../api/uscis";
import type { QuarterPoint } from "./uscis";

/** The calendar quarters from the first to the last, "2025-Q3", as periods */
export function periods(first: string, last: string): Period[] {
  const result: Period[] = [];
  let [year, quarter] = first.split("-Q").map(Number);
  while (`${year}-Q${quarter}` <= last) {
    const startMonth = (quarter - 1) * 3 + 1;
    const endMonth = startMonth + 2;
    const endDay = new Date(Date.UTC(year, endMonth, 0)).getUTCDate();
    const pad = (n: number) => String(n).padStart(2, "0");
    result.push({
      quarter: `${year}-Q${quarter}`,
      start: `${year}-${pad(startMonth)}-01`,
      end: `${year}-${pad(endMonth)}-${pad(endDay)}`,
      fiscalYear: quarter === 4 ? year + 1 : year,
      fiscalQuarter: (quarter % 4) + 1,
    });
    if (quarter === 4) {
      year += 1;
      quarter = 1;
    } else quarter += 1;
  }
  return result;
}

/** A quarter's counts, received and pending known and the rest as given */
export function counts(
  fields: Partial<QuarterCounts> & { pending: number | null },
): QuarterCounts {
  return { received: 0, approved: 0, denied: 0, ...fields };
}

/** A point of a series with the derived figures worked out from the counts
 * given, as toPoints would, and no flow check */
export function point(
  fields: Partial<QuarterPoint> & { quarter: string },
): QuarterPoint {
  const received = fields.received ?? 0;
  const approved = fields.approved ?? 0;
  const denied = fields.denied ?? 0;
  const pending = fields.pending ?? null;
  const completions = fields.completions ?? approved + denied;
  return {
    label: fields.quarter,
    received,
    approved,
    denied,
    pending,
    completions,
    approximate: false,
    waitMonths:
      completions === null || completions === 0 || pending === null
        ? null
        : pending / (completions / 3),
    approvalRate:
      completions === null || completions === 0 ? null : approved / completions,
    approvalRange: null,
    processingTimes: {},
    flow: "unknown",
    suspect: false,
    fromOfficeReport: false,
    ...fields,
  };
}
