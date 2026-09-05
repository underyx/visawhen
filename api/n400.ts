import { join } from "path";
import { readFile } from "fs/promises";

const dataDir = join(process.cwd(), "data");

/** One field office's (or the nation's) N-400 counts for one calendar quarter.
 * `null` is a count USCIS withheld because it is too small to publish. */
export interface QuarterCounts {
  received: number | null;
  approved: number | null;
  denied: number | null;
  pending: number | null;
}

export interface Period {
  /** Calendar quarter, e.g. "2025-Q3" */
  quarter: string;
  start: string;
  end: string;
  fiscalYear: number;
  fiscalQuarter: number;
  /** The USCIS report this quarter's numbers come from */
  source: string;
}

export interface Office {
  code: string;
  name: string;
  state: string | null;
  stateCode: string | null;
  slug: string;
  quarters: Record<string, QuarterCounts>;
}

export interface N400Data {
  periods: Period[];
  offices: Office[];
  total: Record<string, QuarterCounts>;
}

export async function getData(): Promise<N400Data> {
  const contents = await readFile(join(dataDir, "uscis", "n400.json"), "utf-8");
  return JSON.parse(contents);
}

/** Offices that had any application received or pending in the newest quarter
 * (closed ones keep reporting zeros for a while). */
export function getActiveOffices(data: N400Data): Office[] {
  const latest = data.periods[data.periods.length - 1].quarter;
  return data.offices.filter((office) => {
    const counts = office.quarters[latest];
    return (
      counts !== undefined &&
      (counts.received ?? 0) + (counts.pending ?? 0) > 0
    );
  });
}
