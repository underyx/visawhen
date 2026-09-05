import { join } from "path";
import { readFile } from "fs/promises";

const dataDir = join(process.cwd(), "data");

/** Applications received, approved and denied during a quarter, and pending
 * at its end. `null` is a count USCIS withheld or did not publish. */
export interface QuarterCounts {
  received: number | null;
  approved: number | null;
  denied: number | null;
  pending: number | null;
}

/** One line of USCIS's all-forms report: a form, or one category of it
 * (e.g. I-130 for immediate relatives). */
export interface Variant extends QuarterCounts {
  title: string;
  /** USCIS's median processing time in months, when it publishes one */
  processingTime: number | null;
}

export interface FormQuarter extends QuarterCounts {
  variants: Variant[];
}

export interface Period {
  /** Calendar quarter, e.g. "2025-Q3" */
  quarter: string;
  start: string;
  end: string;
  fiscalYear: number;
  fiscalQuarter: number;
}

export interface Office {
  code: string;
  name: string;
  state: string | null;
  stateCode: string | null;
  slug: string;
  quarters: Record<string, QuarterCounts>;
}

export interface Form {
  /** "I-130" */
  form: string;
  /** "i-130" */
  slug: string;
  title: string;
  category: string | null;
  /** Nationwide, from the all-forms report */
  quarters: Record<string, FormQuarter>;
  /** The all-forms report each quarter's numbers come from */
  sources: Record<string, string>;
  /** Per-office breakdown; empty for most forms */
  offices: Office[];
  /** The per-office report's own nationwide totals */
  officeTotals: Record<string, QuarterCounts>;
  officeSources: Record<string, string>;
}

export interface UscisData {
  periods: Period[];
  forms: Form[];
}

export async function getData(): Promise<UscisData> {
  const contents = await readFile(
    join(dataDir, "uscis", "forms.json"),
    "utf-8",
  );
  return JSON.parse(contents);
}

export function latestQuarter(counts: Record<string, unknown>): string | null {
  const quarters = Object.keys(counts).sort();
  return quarters.length === 0 ? null : quarters[quarters.length - 1];
}

/** Forms with nationwide numbers in the newest all-forms report. */
export function getActiveForms(data: UscisData): Form[] {
  const newest = Math.max(
    ...data.forms.flatMap((form) =>
      Object.keys(form.quarters).map((quarter) =>
        Number(quarter.replace("-Q", "")),
      ),
    ),
  );
  return data.forms.filter((form) =>
    Object.keys(form.quarters).some(
      (quarter) => Number(quarter.replace("-Q", "")) === newest,
    ),
  );
}

/** Offices that had any application received or pending in the form's newest
 * per-office quarter (closed ones keep reporting zeros for a while). */
export function getActiveOffices(form: Form): Office[] {
  const latest = latestQuarter(form.officeTotals);
  if (latest === null) return [];
  return form.offices.filter((office) => {
    const counts = office.quarters[latest];
    return (
      counts !== undefined && (counts.received ?? 0) + (counts.pending ?? 0) > 0
    );
  });
}
