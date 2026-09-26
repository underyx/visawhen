import type {
  BulletinChart,
  Cutoff,
  VisaBulletinData,
} from "../api/visaBulletin";
import { daysBetween } from "./Freshness";

// The Visa Bulletin pages' categories and chargeability areas, their names in
// plain English, and the arithmetic on cutoff dates. The keys are the ones
// data/visa_bulletin/bulletin.py writes.

export interface Category {
  /** The key in data.json, "EW" */
  key: string;
  /** The page's path segment, "eb-3-other-workers" */
  slug: string;
  /** "EB-3 Other Workers" */
  name: string;
  /** Who it is for, as a sentence without its full stop */
  who: string;
  kind: "family" | "employment";
}

export const CATEGORIES: Category[] = [
  {
    key: "F1",
    slug: "f1",
    name: "F1",
    who: "Unmarried sons and daughters of US citizens, 21 or older",
    kind: "family",
  },
  {
    key: "F2A",
    slug: "f2a",
    name: "F2A",
    who: "Spouses and children under 21 of green card holders",
    kind: "family",
  },
  {
    key: "F2B",
    slug: "f2b",
    name: "F2B",
    who: "Unmarried sons and daughters of green card holders, 21 or older",
    kind: "family",
  },
  {
    key: "F3",
    slug: "f3",
    name: "F3",
    who: "Married sons and daughters of US citizens",
    kind: "family",
  },
  {
    key: "F4",
    slug: "f4",
    name: "F4",
    who: "Brothers and sisters of US citizens who are 21 or older",
    kind: "family",
  },
  {
    key: "EB-1",
    slug: "eb-1",
    name: "EB-1",
    who: "Priority workers: people with extraordinary ability, outstanding professors and researchers, and some managers of international companies",
    kind: "employment",
  },
  {
    key: "EB-2",
    slug: "eb-2",
    name: "EB-2",
    who: "Professionals with an advanced degree, and people with exceptional ability",
    kind: "employment",
  },
  {
    key: "EB-3",
    slug: "eb-3",
    name: "EB-3",
    who: "Skilled workers with at least 2 years of training or experience, and professionals with a bachelor's degree",
    kind: "employment",
  },
  {
    key: "EW",
    slug: "eb-3-other-workers",
    name: "EB-3 Other Workers",
    who: "Workers in jobs that need less than 2 years of training or experience",
    kind: "employment",
  },
  {
    key: "EB-4",
    slug: "eb-4",
    name: "EB-4",
    who: "Special immigrants, such as special immigrant juveniles and some employees of the US government abroad",
    kind: "employment",
  },
  {
    key: "SR",
    slug: "eb-4-religious-workers",
    name: "EB-4 Religious Workers",
    who: "Religious workers who are not ministers",
    kind: "employment",
  },
  {
    key: "EB-5-unreserved",
    slug: "eb-5-unreserved",
    name: "EB-5 Unreserved",
    who: "Investors, other than those in the rural, high unemployment and infrastructure set-asides",
    kind: "employment",
  },
  {
    key: "EB-5-rural",
    slug: "eb-5-rural",
    name: "EB-5 Rural",
    who: "Investors in a rural area, who get 20% of EB-5 visas",
    kind: "employment",
  },
  {
    key: "EB-5-high-unemployment",
    slug: "eb-5-high-unemployment",
    name: "EB-5 High Unemployment",
    who: "Investors in an area with high unemployment, who get 10% of EB-5 visas",
    kind: "employment",
  },
  {
    key: "EB-5-infrastructure",
    slug: "eb-5-infrastructure",
    name: "EB-5 Infrastructure",
    who: "Investors in a public infrastructure project, who get 2% of EB-5 visas",
    kind: "employment",
  },
];

export interface Area {
  /** The key in data.json, "all" */
  key: string;
  /** The page's path segment, "other-countries" */
  slug: string;
  /** "All other countries" */
  name: string;
  /** For people "born in the Philippines" */
  bornIn: string;
}

export const AREAS: Area[] = [
  {
    key: "all",
    slug: "other-countries",
    name: "All other countries",
    bornIn: "born in any country not listed separately",
  },
  {
    key: "china",
    slug: "china",
    name: "China",
    bornIn: "born in mainland China",
  },
  { key: "india", slug: "india", name: "India", bornIn: "born in India" },
  { key: "mexico", slug: "mexico", name: "Mexico", bornIn: "born in Mexico" },
  {
    key: "philippines",
    slug: "philippines",
    name: "Philippines",
    bornIn: "born in the Philippines",
  },
  {
    key: "el-salvador-guatemala-honduras",
    slug: "el-salvador-guatemala-honduras",
    name: "El Salvador, Guatemala and Honduras",
    bornIn: "born in El Salvador, Guatemala or Honduras",
  },
  {
    key: "vietnam",
    slug: "vietnam",
    name: "Vietnam",
    bornIn: "born in Vietnam",
  },
];

/** The two charts of a bulletin, by their key in data.json */
export const CHARTS = {
  finalAction: "Final Action Dates",
  datesForFiling: "Dates for Filing",
} as const;
export type ChartKey = keyof typeof CHARTS;

/** The newest bulletin's month, "2026-10" */
export function newestMonth(data: VisaBulletinData): string {
  return Object.keys(data.bulletins).sort().reverse()[0];
}

/** The areas a chart gives a cutoff for, in the order of AREAS */
export function chartAreas(chart: BulletinChart): Area[] {
  const keys = new Set(Object.values(chart).flatMap(Object.keys));
  return AREAS.filter(({ key }) => keys.has(key));
}

/** A category's or an area's page path segment */
export function categoryBySlug(slug: string): Category | undefined {
  return CATEGORIES.find((category) => category.slug === slug);
}

export function areaBySlug(slug: string): Area | undefined {
  return AREAS.find((area) => area.slug === slug);
}

export function pagePath(category: Category, area: Area): string {
  return `/visa-bulletin/${category.slug}/${area.slug}`;
}

/** A category's cutoffs in one area, per bulletin month, oldest first; months
 * whose bulletin does not have it are left out */
export type Series = [month: string, cutoff: Cutoff][];

export function getSeries(
  data: VisaBulletinData,
  chart: ChartKey,
  category: string,
  area: string,
): Series {
  return Object.keys(data.bulletins)
    .sort()
    .flatMap((month): Series => {
      const cutoff = data.bulletins[month][chart][category]?.[area];
      return cutoff === undefined ? [] : [[month, cutoff]];
    });
}

export function isDate(cutoff: Cutoff): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(cutoff);
}

/** The first day of a bulletin's month, "2026-10-01" */
export function monthStart(month: string): string {
  return `${month}-01`;
}

/** The month some months after another: ("2026-10", -12) is "2025-10" */
export function addMonthsToMonth(month: string, months: number): string {
  const [year, monthNumber] = month.split("-").map(Number);
  const index = year * 12 + monthNumber - 1 + months;
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(
    2,
    "0",
  )}`;
}

const MONTH_DAYS = 30.44;

/** Whole months from one date to another, rounded; negative when `to` is
 * earlier */
export function monthsBetweenDates(from: string, to: string): number {
  return Math.round(daysBetween(from, to) / MONTH_DAYS);
}

/** A number of months as "1 year and 2 months", "5 months", "2 years" */
export function formatMonths(months: number): string {
  const total = Math.abs(months);
  const years = Math.floor(total / 12);
  const rest = total % 12;
  const yearText = years === 1 ? "1 year" : `${years} years`;
  const monthText = rest === 1 ? "1 month" : `${rest} months`;
  if (years === 0) return monthText;
  if (rest === 0) return yearText;
  return `${yearText} and ${monthText}`;
}

const monthFormatter = new Intl.DateTimeFormat("en-US", {
  month: "long",
  year: "numeric",
  timeZone: "UTC",
});
const cutoffFormatter = new Intl.DateTimeFormat("en-US", {
  dateStyle: "medium",
  timeZone: "UTC",
});

/** A bulletin's month as "October 2026" */
export function formatBulletinMonth(month: string): string {
  return monthFormatter.format(new Date(monthStart(month)));
}

/** A cutoff as "Aug 22, 2007", "Current" or "Unavailable" */
export function formatCutoff(cutoff: Cutoff): string {
  if (cutoff === "C") return "Current";
  if (cutoff === "U") return "Unavailable";
  return cutoffFormatter.format(new Date(cutoff));
}

/** How far a cutoff moved from one bulletin to a later one */
export interface Movement {
  from: [month: string, cutoff: Cutoff];
  to: [month: string, cutoff: Cutoff];
  /** Whole months it moved forward (negative: back), when both are dates */
  months: number | null;
}

/** How far the cutoff moved in the months before the newest bulletin of a
 * series, or null when the series has no bulletin that far back */
export function getMovement(series: Series, back: number): Movement | null {
  if (series.length === 0) return null;
  const to = series[series.length - 1];
  const fromMonth = addMonthsToMonth(to[0], -back);
  const from = series.find(([month]) => month === fromMonth);
  if (from === undefined) return null;
  return {
    from,
    to,
    months:
      isDate(from[1]) && isDate(to[1])
        ? monthsBetweenDates(from[1], to[1])
        : null,
  };
}
