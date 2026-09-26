import type { PostActivity } from "../api/consulates";

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

/** Whole months from one month in the data to another:
 * ("2025-02-01T00:00:00.000Z", "2026-02-01T00:00:00.000Z") is 12. */
function monthsBetween(from: string, to: string): number {
  const [fromYear, fromMonth] = from.split("-").map(Number);
  const [toYear, toMonth] = to.split("-").map(Number);
  return toYear * 12 + toMonth - (fromYear * 12 + fromMonth);
}

interface InactivityInput {
  postName: string;
  activity: PostActivity;
  /** The oldest and newest months in the data */
  dataStart: string;
  dataEnd: string;
  immigrant: boolean;
  /** Whether State's newest IV Scheduling Status Tool update lists the post */
  listedInTool: boolean;
}

/** What describeInactivity describes: which visas the post has issued none of
 * for a year, and the month it last issued one, null if it never did in the
 * data. */
function findInactivity({
  activity,
  dataEnd,
  immigrant,
  listedInTool,
}: InactivityInput): {
  visas: "visas" | "immigrant visas";
  lastIssued: string | null;
} | null {
  const quiet = (month: string | null) =>
    month === null || monthsBetween(month, dataEnd) >= 12;
  const { lastIssued, lastImmigrantIssued } = activity;
  if (quiet(lastIssued)) return { visas: "visas", lastIssued };
  if (
    immigrant &&
    quiet(lastImmigrantIssued) &&
    (lastImmigrantIssued !== null || listedInTool)
  )
    return { visas: "immigrant visas", lastIssued: lastImmigrantIssued };
  return null;
}

/** For a post that looks closed, a sentence that says what the data shows:
 * that it issued no visas in the last 12 months of the data, whatever else
 * lists it, or, with `immigrant` (its own page and its immigrant visa class
 * pages), that it issued no immigrant visas in the last 12 months, even
 * when State's IV Scheduling Status Tool lists it, often as current:
 * Nicosia, none since November 2024, and Vancouver, none at all in the
 * data. Null for every other post, including those that issued other visas
 * but never an immigrant one in the data and that the tool does not list:
 * they handle nonimmigrant visas only, which the interview-queue card
 * already says. */
export function describeInactivity(input: InactivityInput): string | null {
  const inactivity = findInactivity(input);
  if (inactivity === null) return null;
  const { postName, dataStart, dataEnd } = input;
  const { visas, lastIssued } = inactivity;
  return lastIssued === null
    ? `${postName} issued no ${visas} in any month of the State Department’s figures, ${formatLongMonth(
        dataStart,
      )} to ${formatLongMonth(dataEnd)}.`
    : `${postName} has issued no ${visas} since ${formatLongMonth(
        lastIssued,
      )}, according to the State Department’s monthly figures, which run to ${formatLongMonth(
        dataEnd,
      )}.`;
}

/** The same finding as describeInactivity, as a phrase for a page title:
 * "no visas issued since April 2023", or "no visas issued in State
 * Department figures" for a post that never issued one in the data. */
export function summarizeInactivity(input: InactivityInput): string | null {
  const inactivity = findInactivity(input);
  if (inactivity === null) return null;
  const { visas, lastIssued } = inactivity;
  return lastIssued === null
    ? `no ${visas} issued in State Department figures`
    : `no ${visas} issued since ${formatLongMonth(lastIssued)}`;
}

/** Visa classes whose applicants at a post are mostly nationals of another
 * country than the one the post is in, by post slug, then class slug. SQ and
 * SI visas are for Iraqis and Afghans only (see their descriptions), and
 * State's list of the posts that process immigrant visas designates
 * Islamabad for Afghanistan
 * (https://travel.state.gov/content/travel/en/us-visas/visa-information-resources/list-of-posts.html). */
export const CLASS_APPLICANT_COUNTRIES: Partial<
  Record<string, Partial<Record<string, string>>>
> = {
  islamabad: { sq: "Afghanistan", si: "Afghanistan" },
};

/** A post whose country State's list of the embassies and consulates that
 * process immigrant visas (IV_POSTS_URL in links.ts) sends to another post:
 * "Haiti - Port-au-Prince - See Bahamas - Nassau". */
export interface IvPostElsewhere {
  /** The country as a sentence names it: "Haiti", "the Netherlands" */
  country: string;
  /** The posts the list names for it, in its order, with the cases a post
   * is named for only, as the list gives them ("IR-5") */
  posts: { slug: string; name: string; only?: string }[];
  /** Whether State's notice of July 15, 2026 (AFRICA_HUBS_URL in links.ts)
   * names the post itself as a regional visa hub, which the list
   * contradicts */
  alsoHub?: boolean;
}

/** When IV_POSTS_ELSEWHERE was last checked against State's list */
export const IV_POSTS_ELSEWHERE_CHECKED = "2026-09-25";

/** The posts, by slug, whose country State's list of the embassies and
 * consulates that process immigrant visas sends to another post, as of
 * IV_POSTS_ELSEWHERE_CHECKED. State designates the other post for the
 * country's immigrant visa applicants, so the post's page must not say that
 * most of its applicants are the country's nationals (whose visas may be
 * suspended), and State's IV Scheduling Status Tool can list the post as
 * current all the same: Amsterdam, Nicosia and Zagreb are. Only posts the
 * site has a page for; a country the list gives no post of its own
 * ("Afghanistan - See Pakistan - Islamabad") stands for every post in it.
 * Kampala, Lome, Malabo and Port Louis are also named as regional hubs in
 * State's July 15 realignment notice (`alsoHub`). */
export const IV_POSTS_ELSEWHERE: Partial<Record<string, IvPostElsewhere>> = {
  amsterdam: {
    country: "the Netherlands",
    posts: [{ slug: "frankfurt", name: "Frankfurt" }],
  },
  antananarivo: {
    country: "Madagascar",
    posts: [{ slug: "johannesburg", name: "Johannesburg" }],
  },
  apia: { country: "Samoa", posts: [{ slug: "auckland", name: "Auckland" }] },
  asmara: { country: "Eritrea", posts: [{ slug: "nairobi", name: "Nairobi" }] },
  baku: {
    country: "Azerbaijan",
    posts: [{ slug: "tbilisi", name: "Tbilisi" }],
  },
  bamako: { country: "Mali", posts: [{ slug: "dakar", name: "Dakar" }] },
  "bandar-seri-begawan": {
    country: "Brunei",
    posts: [
      { slug: "kuala-lumpur", name: "Kuala Lumpur" },
      { slug: "singapore", name: "Singapore" },
    ],
  },
  banjul: { country: "The Gambia", posts: [{ slug: "dakar", name: "Dakar" }] },
  bratislava: {
    country: "Slovakia",
    posts: [{ slug: "frankfurt", name: "Frankfurt" }],
  },
  brazzaville: {
    country: "the Republic of the Congo",
    posts: [{ slug: "kinshasa", name: "Kinshasa" }],
  },
  bujumbura: {
    country: "Burundi",
    posts: [{ slug: "nairobi", name: "Nairobi" }],
  },
  caracas: {
    country: "Venezuela",
    posts: [{ slug: "bogota", name: "Bogota" }],
  },
  conakry: { country: "Guinea", posts: [{ slug: "dakar", name: "Dakar" }] },
  copenhagen: {
    country: "Denmark",
    posts: [{ slug: "stockholm", name: "Stockholm" }],
  },
  cotonou: { country: "Benin", posts: [{ slug: "abidjan", name: "Abidjan" }] },
  curacao: { country: "Curacao", posts: [{ slug: "bogota", name: "Bogota" }] },
  dili: {
    country: "Timor-Leste",
    posts: [{ slug: "jakarta", name: "Jakarta" }],
  },
  freetown: {
    country: "Sierra Leone",
    posts: [{ slug: "monrovia", name: "Monrovia" }],
  },
  gaborone: {
    country: "Botswana",
    posts: [{ slug: "johannesburg", name: "Johannesburg" }],
  },
  harare: {
    country: "Zimbabwe",
    posts: [{ slug: "johannesburg", name: "Johannesburg" }],
  },
  helsinki: {
    country: "Finland",
    posts: [{ slug: "stockholm", name: "Stockholm" }],
  },
  juba: {
    country: "South Sudan",
    posts: [{ slug: "nairobi", name: "Nairobi" }],
  },
  kabul: {
    country: "Afghanistan",
    posts: [{ slug: "islamabad", name: "Islamabad" }],
  },
  kampala: {
    country: "Uganda",
    posts: [{ slug: "nairobi", name: "Nairobi" }],
    alsoHub: true,
  },
  khartoum: { country: "Sudan", posts: [{ slug: "cairo", name: "Cairo" }] },
  kolonia: {
    country: "the Federated States of Micronesia",
    posts: [{ slug: "manila", name: "Manila" }],
  },
  koror: { country: "Palau", posts: [{ slug: "manila", name: "Manila" }] },
  libreville: {
    country: "Gabon",
    posts: [{ slug: "yaounde", name: "Yaounde" }],
  },
  lilongwe: {
    country: "Malawi",
    posts: [{ slug: "nairobi", name: "Nairobi" }],
  },
  lisbon: { country: "Portugal", posts: [{ slug: "paris", name: "Paris" }] },
  ljubljana: {
    country: "Slovenia",
    posts: [{ slug: "frankfurt", name: "Frankfurt" }],
  },
  lome: {
    country: "Togo",
    posts: [{ slug: "abidjan", name: "Abidjan" }],
    alsoHub: true,
  },
  lusaka: {
    country: "Zambia",
    posts: [{ slug: "johannesburg", name: "Johannesburg" }],
  },
  luxembourg: {
    country: "Luxembourg",
    posts: [{ slug: "brussels", name: "Brussels" }],
  },
  majuro: {
    country: "the Marshall Islands",
    posts: [{ slug: "manila", name: "Manila" }],
  },
  malabo: {
    country: "Equatorial Guinea",
    posts: [{ slug: "yaounde", name: "Yaounde" }],
    alsoHub: true,
  },
  maputo: {
    country: "Mozambique",
    posts: [{ slug: "johannesburg", name: "Johannesburg" }],
  },
  maseru: {
    country: "Lesotho",
    posts: [{ slug: "johannesburg", name: "Johannesburg" }],
  },
  mbabane: {
    country: "Eswatini",
    posts: [{ slug: "johannesburg", name: "Johannesburg" }],
  },
  minsk: { country: "Belarus", posts: [{ slug: "warsaw", name: "Warsaw" }] },
  moscow: {
    country: "Russia",
    posts: [
      { slug: "warsaw", name: "Warsaw" },
      { slug: "almaty", name: "Almaty", only: "IR-5" },
      { slug: "tashkent", name: "Tashkent", only: "IR-5" },
    ],
  },
  ndjamena: { country: "Chad", posts: [{ slug: "yaounde", name: "Yaounde" }] },
  niamey: { country: "Niger", posts: [{ slug: "abidjan", name: "Abidjan" }] },
  nicosia: {
    country: "Cyprus",
    posts: [{ slug: "frankfurt", name: "Frankfurt" }],
  },
  nouakchott: {
    country: "Mauritania",
    posts: [{ slug: "dakar", name: "Dakar" }],
  },
  oslo: {
    country: "Norway",
    posts: [{ slug: "stockholm", name: "Stockholm" }],
  },
  ouagadougou: {
    country: "Burkina Faso",
    posts: [{ slug: "dakar", name: "Dakar" }],
  },
  paramaribo: {
    country: "Suriname",
    posts: [{ slug: "georgetown", name: "Georgetown" }],
  },
  podgorica: {
    country: "Montenegro",
    posts: [{ slug: "belgrade", name: "Belgrade" }],
  },
  "port-au-prince": {
    country: "Haiti",
    posts: [{ slug: "nassau", name: "Nassau" }],
  },
  "port-louis": {
    country: "Mauritius",
    posts: [{ slug: "johannesburg", name: "Johannesburg" }],
    alsoHub: true,
  },
  riga: {
    country: "Latvia",
    posts: [{ slug: "stockholm", name: "Stockholm" }],
  },
  tallinn: {
    country: "Estonia",
    posts: [{ slug: "stockholm", name: "Stockholm" }],
  },
  valletta: { country: "Malta", posts: [{ slug: "naples", name: "Naples" }] },
  vilnius: {
    country: "Lithuania",
    posts: [{ slug: "stockholm", name: "Stockholm" }],
  },
  windhoek: {
    country: "Namibia",
    posts: [{ slug: "johannesburg", name: "Johannesburg" }],
  },
  zagreb: {
    country: "Croatia",
    posts: [{ slug: "frankfurt", name: "Frankfurt" }],
  },
};

/** "Nassau", "Kuala Lumpur and Singapore", "Warsaw, Almaty (IR-5 only),
 * and Tashkent (IR-5 only)"; without `withCases`, only the posts named for
 * every case, "Warsaw" (all of them if none is) */
function elsewhereNames(
  { posts }: IvPostElsewhere,
  withCases: boolean,
): string {
  const general = posts.filter(({ only }) => only === undefined);
  const named = withCases || general.length === 0 ? posts : general;
  return new Intl.ListFormat("en-US").format(
    named.map(({ name, only }) =>
      only !== undefined ? `${name} (${only} only)` : name,
    ),
  );
}

/** For a page's title: "Port-au-Prince: State lists Nassau as the immigrant
 * visa post for Haiti", "Moscow: State lists Warsaw as the immigrant visa
 * post for Russia" (and Almaty and Tashkent for IR-5 cases only, which the
 * description and the card say) */
export function summarizeIvPostElsewhere(
  postName: string,
  elsewhere: IvPostElsewhere,
): string {
  const general = elsewhere.posts.filter(({ only }) => only === undefined);
  const count = general.length === 0 ? elsewhere.posts.length : general.length;
  return `${postName}: State lists ${elsewhereNames(
    elsewhere,
    false,
  )} as the immigrant visa ${count === 1 ? "post" : "posts"} for ${
    elsewhere.country
  }`;
}

/** For a meta description: "State's list of the embassies and consulates
 * that process immigrant visas names Nassau for Haiti, not Port-au-Prince."
 * with the realignment notice's contrary word for a post it calls a hub. */
export function describeIvPostElsewhere(
  postName: string,
  elsewhere: IvPostElsewhere,
): string {
  return `State’s list of the embassies and consulates that process immigrant visas names ${elsewhereNames(
    elsewhere,
    true,
  )} for ${elsewhere.country}, not ${postName}.${
    elsewhere.alsoHub === true
      ? ` State’s July 15, 2026 notice on realigning visa services in Africa names ${postName} as a regional visa hub, though.`
      : ""
  }`;
}

/** The country whose nationals make up most of the immigrant visa
 * applicants on a post's page or one of its visa class pages, as the policy
 * notices name it (data/policy.json's scope.countries): the post's own
 * country, from api/searchTerms.ts's POST_COUNTRIES without the other names
 * in parentheses ("Burma (Myanmar)" is "Burma"), since State requires
 * immigrant visa applicants to interview in their country of residence or
 * nationality, except for the classes in CLASS_APPLICANT_COUNTRIES. Null for
 * a post with no country. */
export function applicantCountry(
  postCountry: string | null,
  postSlug: string,
  visaClassSlug?: string,
): string | null {
  const classCountry =
    visaClassSlug === undefined
      ? undefined
      : CLASS_APPLICANT_COUNTRIES[postSlug]?.[visaClassSlug];
  if (classCountry !== undefined) return classCountry;
  return postCountry === null ? null : postCountry.replace(/ \(.*\)$/, "");
}

/** The three columns of State's IV Scheduling Status Tool */
export type IvCategory = "relative" | "preference" | "employment";

export const IV_CATEGORIES: IvCategory[] = [
  "relative",
  "preference",
  "employment",
];

/** A post's line in one of State's monthly updates of its IV Scheduling
 * Status Tool: per category, the month of documentarily complete cases NVC
 * is scheduling interviews for, "2026-02", or null where State lists N/A. */
export interface IvScheduleLine extends Record<IvCategory, string | null> {
  /** The date of State's update, "2026-09-23" */
  asOf: string;
}

/** A post's line in State's newest update, with its line in the update
 * before, since the month can move backwards as well as forwards */
export interface IvSchedule extends IvScheduleLine {
  /** The post's line in the update before the newest, or null when there
   * is none or it does not list the post */
  previous: IvScheduleLine | null;
}

/** The visa classes each column of the tool covers */
const IV_CLASSES: Record<IvCategory, string[]> = {
  relative: ["cr1ir1", "cr2ir2", "ir5"],
  preference: ["f1-family", "f2a", "f2b", "f3", "f4"],
  employment: ["eb-1", "eb-2", "eb-3", "ew", "eb-5"],
};

/** Fewer family and employment immigrant visas than this in 12 months, about
 * four a month, and a post State's tool lists as current is not called
 * current: at New Delhi (29, most of its immigrant visas being adoptions),
 * Amsterdam (27) or Moscow (none), "current" says nothing about a queue. */
export const FEW_IMMIGRANT_VISAS = 50;

/** How many visas of the classes State's tool covers, the family and
 * employment immigrant visas, the rows count */
export function countToolClassIssuances(
  rows: { visaClassSlug: string; issuances: number }[],
): number {
  return rows
    .filter(
      ({ visaClassSlug }) => IV_CATEGORY_BY_CLASS[visaClassSlug] !== undefined,
    )
    .reduce((sum, { issuances }) => sum + issuances, 0);
}

/** The tool's column for each visa class it covers */
export const IV_CATEGORY_BY_CLASS: Partial<Record<string, IvCategory>> =
  Object.fromEntries(
    IV_CATEGORIES.flatMap((category) =>
      IV_CLASSES[category].map((slug) => [slug, category] as const),
    ),
  );

const FIANCE_NOTE =
  "The State Department publishes no interview-scheduling data for fiancé(e) visas.";
const K3_NOTE =
  "The State Department publishes no interview-scheduling data for K-3 and K-4 visas.";
const DV_NOTE = "Diversity visas are not covered by State’s scheduling tool.";

// The tool's page lists the visa categories it covers: immediate relatives,
// family preference, and EB-1, EB-2, EB-3 and EB-5. These are not among them.
function notListedNote(cases: string): string {
  return `State’s interview-scheduling tool does not list ${cases} among the categories it covers.`;
}
const ADOPTION_NOTE = notListedNote("adoption cases");
const WIDOW_NOTE = notListedNote(
  "widows and widowers of U.S. citizens or their children",
);
const SELF_PETITION_NOTE = notListedNote(
  "self-petitioners (VAWA) or their children",
);
const RETURNING_RESIDENT_NOTE = notListedNote("returning residents (SB-1)");
const SPECIAL_IMMIGRANT_NOTE = notListedNote("special immigrants");
const AMERASIAN_NOTE = notListedNote("Amerasian immigrants");
const U_VISA_FAMILY_NOTE = notListedNote("family members of U visa holders");

/** Why a visa class that goes through NVC has no column in State's IV
 * Scheduling Status Tool: the immigrant classes it does not cover, and the K
 * visas, which are nonimmigrant visas but go through NVC too */
export const CLASS_NOTES: Partial<Record<string, string>> = {
  k1: FIANCE_NOTE,
  k2: FIANCE_NOTE,
  k3: K3_NOTE,
  k4: K3_NOTE,
  dv: DV_NOTE,
  ir3: ADOPTION_NOTE,
  ir4: ADOPTION_NOTE,
  ih3: ADOPTION_NOTE,
  ih4: ADOPTION_NOTE,
  iw: WIDOW_NOTE,
  ib1: SELF_PETITION_NOTE,
  ib2: SELF_PETITION_NOTE,
  b2a: SELF_PETITION_NOTE,
  b2b: SELF_PETITION_NOTE,
  bx: SELF_PETITION_NOTE,
  sb1: RETURNING_RESIDENT_NOTE,
  bc: SPECIAL_IMMIGRANT_NOTE,
  sd: SPECIAL_IMMIGRANT_NOTE,
  se: SPECIAL_IMMIGRANT_NOTE,
  si: SPECIAL_IMMIGRANT_NOTE,
  sk: SPECIAL_IMMIGRANT_NOTE,
  sq: SPECIAL_IMMIGRANT_NOTE,
  cq: SPECIAL_IMMIGRANT_NOTE,
  sr: SPECIAL_IMMIGRANT_NOTE,
  am: AMERASIAN_NOTE,
  su: U_VISA_FAMILY_NOTE,
};

/** The nonimmigrant classes that go through NVC like immigrant visas: the K
 * visas for fiancé(e)s and spouses of U.S. citizens and their children */
export const NVC_NONIMMIGRANT_CLASSES = ["k1", "k2", "k3", "k4"];

/** For the nonimmigrant classes whose code State also uses for an immigrant
 * class, the slug of that immigrant class's page. Until the class split,
 * these pages counted both, e.g. Manila's E3 page mostly EB-3 visas, so they
 * point visitors who bookmarked them to the immigrant page. */
export const IMMIGRANT_COUNTERPARTS: Partial<Record<string, string>> = {
  e1: "eb-1",
  e2: "eb-2",
  e3: "eb-3",
  f1: "f1-family",
  t5: "eb-5",
  u1: "su",
  c2: "f2a",
};

/** How many months before State's update a month in its tool is:
 * ("2026-09-23", "2026-02") is 7. */
export function monthsBehind(asOf: string, cutoff: string): number {
  const [asOfYear, asOfMonth] = asOf.split("-").map(Number);
  const [cutoffYear, cutoffMonth] = cutoff.split("-").map(Number);
  return asOfYear * 12 + asOfMonth - (cutoffYear * 12 + cutoffMonth);
}

/** A month from State's IV Scheduling Status Tool, "2026-02", as
 * "February 2026". */
export function formatIvMonth(month: string): string {
  return formatLongMonth(`${month}-01T00:00:00.000Z`);
}

/** A month from State's IV Scheduling Status Tool, "2026-02", as
 * "Feb 2026". */
export function formatShortIvMonth(month: string): string {
  return formatMonth(`${month}-01T00:00:00.000Z`);
}
