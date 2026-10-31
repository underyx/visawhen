import type {
  BulletinChart,
  Cutoff,
  VisaBulletinData,
} from "../api/visaBulletin";
import { daysBetween, formatMonthYear, signedChange } from "./dates";

// The Visa Bulletin pages' categories and chargeability areas, their names in
// plain English, and the arithmetic on cutoff dates. The keys are the ones
// data/visa_bulletin/bulletin.ts writes.

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
    who: "People with extraordinary ability, outstanding professors and researchers, and some multinational managers",
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
    who: "Special immigrants, such as special immigrant juveniles and some US government employees abroad",
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
  /** The area in a list of places, "the Philippines" (bornInText); none for
   * the area of every other country */
  place?: string;
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
    place: "China",
  },
  {
    key: "india",
    slug: "india",
    name: "India",
    bornIn: "born in India",
    place: "India",
  },
  {
    key: "mexico",
    slug: "mexico",
    name: "Mexico",
    bornIn: "born in Mexico",
    place: "Mexico",
  },
  {
    key: "philippines",
    slug: "philippines",
    name: "Philippines",
    bornIn: "born in the Philippines",
    place: "the Philippines",
  },
  {
    key: "el-salvador-guatemala-honduras",
    slug: "el-salvador-guatemala-honduras",
    name: "El Salvador, Guatemala and Honduras",
    bornIn: "born in El Salvador, Guatemala or Honduras",
    place: "El Salvador, Guatemala or Honduras",
  },
  {
    key: "vietnam",
    slug: "vietnam",
    name: "Vietnam",
    bornIn: "born in Vietnam",
    place: "Vietnam",
  },
];

/** The two charts of a bulletin, by their key in data.json */
export const CHARTS = {
  finalAction: "Final Action Dates",
  datesForFiling: "Dates for Filing",
} as const;
export type ChartKey = keyof typeof CHARTS;

/** What a priority date is, in one place for the index's glossary and the
 * area pages, so that the two never drift */
export const PRIORITY_DATE_DEFINITION =
  "Your priority date is usually the day USCIS received your I-130 or I-140 petition, or, when you needed a labor certification, the day it was filed. It is on your I-797 notice.";

/** The newest bulletin's month, "2026-10" */
export function newestMonth(data: VisaBulletinData): string {
  return Object.keys(data.bulletins).sort().reverse()[0];
}

/** The areas a chart gives a cutoff for, in the order of AREAS */
export function chartAreas(chart: BulletinChart): Area[] {
  const keys = new Set(Object.values(chart).flatMap(Object.keys));
  return AREAS.filter(({ key }) => keys.has(key));
}

/** For people "born in India", or, on the page of every other country,
 * "born outside China, India, Mexico and the Philippines": the places the
 * chart lists separately (chartAreas), so that the words follow the chart
 * when State adds or drops one. The area's own words stay for a chart that
 * lists no other area. */
export function bornInText(area: Area, areas: Area[]): string {
  if (area.key !== "all") return area.bornIn;
  const places = areas.flatMap(({ place }) =>
    place === undefined ? [] : [place],
  );
  if (places.length === 0) return area.bornIn;
  // joined by hand: Intl.ListFormat adds a comma before "and", which no
  // other list on the site has
  const list =
    places.length === 1
      ? places[0]
      : `${places.slice(0, -1).join(", ")} and ${places[places.length - 1]}`;
  return `born outside ${list}`;
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
const shortMonthFormatter = new Intl.DateTimeFormat("en-US", {
  month: "short",
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
  /** Whether every bulletin from `from` to `to` gave the same cutoff: two
   * ends that are both "C" can have had a date in between */
  steady: boolean;
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
    steady: series
      .filter(([month]) => month >= fromMonth)
      .every(([, cutoff]) => cutoff === to[1]),
  };
}

/** Which way the line moved from one cutoff to a later one: 1 forward, -1
 * back, 0 not at all. "Current" is the front of the line and "Unavailable"
 * its back, so a date that becomes current moved forward, and a current
 * category that gets a date again moved back. */
export function cutoffDirection(from: Cutoff, to: Cutoff): number {
  const rank = (cutoff: Cutoff) =>
    cutoff === "C" ? 1 : cutoff === "U" ? -1 : 0;
  if (isDate(from) && isDate(to)) return Math.sign(daysBetween(from, to));
  return Math.sign(rank(to) - rank(from));
}

/** The change line under a cutoff figure (Stat): its text and its Mantine
 * colour (signs and colours: signedChange in components/dates.ts). A date
 * moves forward or back: the line says "+1 month since Sep" or "−3 months
 * since Sep", or "same as in Sep". A move of under half a month would round
 * to no months, so it is given in days. When either cutoff is "C" or "U" the
 * line says what it was then, "was current in Sep" or "was Jan 1, 2025 in
 * Sep", coloured by which way the line moved (cutoffDirection). Null when
 * the series has only one bulletin. */
export function cutoffChange(
  series: Series,
): { text: string; color: string } | null {
  if (series.length < 2) return null;
  const [previousMonth, previous] = series[series.length - 2];
  const [month, cutoff] = series[series.length - 1];
  // The month alone when it is the one before, as it nearly always is, and
  // with its year when bulletins in between left the category out.
  const since =
    addMonthsToMonth(month, -1) === previousMonth
      ? shortMonthFormatter.format(new Date(monthStart(previousMonth)))
      : formatMonthYear(monthStart(previousMonth));
  if (cutoff === previous)
    return { text: `same as in ${since}`, color: "dimmed" };
  const direction = cutoffDirection(previous, cutoff);
  if (isDate(cutoff) && isDate(previous)) {
    const days = daysBetween(previous, cutoff);
    const months = monthsBetweenDates(previous, cutoff);
    const amount =
      months === 0
        ? `${Math.abs(days)} ${Math.abs(days) === 1 ? "day" : "days"}`
        : formatMonths(months);
    return signedChange(direction, `${amount} since ${since}`);
  }
  const was = isDate(previous)
    ? formatCutoff(previous)
    : formatCutoff(previous).toLowerCase();
  // what it was needs no sign: only the colour says which way it moved
  return {
    text: `was ${was} in ${since}`,
    color: signedChange(direction, "").color,
  };
}
