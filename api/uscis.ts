import { join } from "path";
import { readFile } from "fs/promises";

const dataDir = join(process.cwd(), "data");

export type CountField = "received" | "approved" | "denied" | "pending";

/** Applications received, approved and denied during a quarter, and pending
 * at its end. `null` is a count USCIS withheld or did not publish. */
export interface QuarterCounts {
  received: number | null;
  approved: number | null;
  denied: number | null;
  pending: number | null;
  /** The null counts that USCIS withheld as too small to disclose ("D" in
   * its reports), as opposed to not publishing them. Where the N-400 and
   * I-485 offices add up to their report's total, the remainder comes to 1
   * to 9 per "D"; in some quarters of the I-130 office reports far more is
   * unaccounted for (hundreds per "D"), so there an estimate is rougher. */
  withheld?: CountField[];
}

/** One line of USCIS's all-forms report: a form, or one category of it
 * (e.g. I-130 for immediate relatives). */
export interface Variant extends QuarterCounts {
  /** The category, stable when USCIS retitles its row: "immediate-relative",
   * "advance-parole", or "all" for a form's only row */
  key: string;
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

/** An office's (or the per-office report's national) counts for a quarter:
 * the total, and per category of the report. */
export interface OfficeQuarter extends QuarterCounts {
  /** By OfficeCategory key; missing from data built before the per-office
   * categories were parsed */
  categories?: Record<string, QuarterCounts>;
}

/** A category the per-office report splits its counts into, e.g. I-130
 * immediate relatives vs. all other relatives. */
export interface OfficeCategory {
  /** "immediate-relative", "family", "civilian", ... */
  key: string;
  /** As the newest report labels it: "Immediate Relative", "Family-based" */
  label: string;
}

export interface Office {
  code: string;
  name: string;
  state: string | null;
  stateCode: string | null;
  slug: string;
  quarters: Record<string, OfficeQuarter>;
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
  officeTotals: Record<string, OfficeQuarter>;
  officeSources: Record<string, string>;
  /** The per-office report's categories, in its order */
  officeCategories?: OfficeCategory[];
}

export interface UscisData {
  periods: Period[];
  /** The quarters whose all-forms report repeated the quarter before's
   * medians, which forms.py dropped ("2024-Q2"). Absent from a forms.json
   * written before forms.py recorded them, whose medians for those quarters
   * are still in it (see republishedMedianQuarters in components/uscis.ts). */
  republishedMedianQuarters?: string[];
  forms: Form[];
}

let dataPromise: Promise<UscisData> | undefined;

/** forms.json, read and parsed once per build worker (it is several
 * megabytes, and every USCIS page reads it). Callers must not modify it. */
export function getData(): Promise<UscisData> {
  if (dataPromise === undefined)
    dataPromise = readFile(join(dataDir, "uscis", "forms.json"), "utf-8").then(
      (contents) => JSON.parse(contents) as UscisData,
    );
  return dataPromise;
}

/** The newest quarter with numbers, or null when there are none. Quarters
 * are "YYYY-QN", so they sort as strings. */
export function latestQuarter(counts: Record<string, unknown>): string | null {
  const quarters = Object.keys(counts).sort();
  return quarters.length === 0 ? null : quarters[quarters.length - 1];
}

/** The quarter of the newest all-forms report. */
export function newestQuarter(data: UscisData): string | null {
  return data.forms.reduce<string | null>((newest, form) => {
    const latest = latestQuarter(form.quarters);
    return latest !== null && (newest === null || latest > newest)
      ? latest
      : newest;
  }, null);
}

/** Forms with nationwide numbers in the newest all-forms report. */
export function getActiveForms(data: UscisData): Form[] {
  const newest = newestQuarter(data);
  return data.forms.filter(
    (form) => newest !== null && newest in form.quarters,
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
