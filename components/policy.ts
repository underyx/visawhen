import policyData from "../data/policy.json";

// The policy notices shown on the consulate and NVC pages, from
// data/policy.json. Delays now come mostly from policy (posts that paused or
// moved their visa services, nationalities whose visas are suspended), and
// the scheduling and issuance data cannot be read without them. Each entry is
// written by hand from its sources and re-checked about weekly; the pages say
// when it was last checked, and drop it 60 days after it ends (see
// PolicyBanner.tsx).
//
// The pages look their entries up while rendering instead of taking them as
// props, so the file ships in the pages' scripts (a chunk the consulate pages
// share, and the NVC page's own) rather than in the data of each of the
// ~15,000 consulate pages. The build checks it (see api/policy.ts).

/** "official": the State Department has published a notice. "reported": only
 * the press or law firms report it, and the page says there is no notice. */
export type PolicyStatus = "official" | "reported";

export interface PolicySource {
  label: string;
  url: string;
}

/** Which pages an entry shows on */
export interface PolicyScope {
  /** Post slugs, "kampala": shown expanded on the post's own pages */
  posts?: string[];
  /** Countries, as the consulate pages name them without the part in
   * parentheses ("Cuba", "Burma", "Côte d'Ivoire"; see applicantCountry() in
   * consulates.ts): the entry is about their nationals, who make up most of
   * the immigrant visa applicants at the posts in them, and it is shown
   * expanded on those posts' pages (on their visa class pages, only for the
   * classes `countryVisas` says it covers). List only countries the site has a post
   * in: the build warns about the others. */
  countries?: string[];
  /** Shown, collapsed with the other site-wide entries, on every post's page
   * and its visa class pages */
  allConsulatePages?: boolean;
  /** Post slugs, "budapest", whose pages an `allConsulatePages` entry is not
   * shown on, such as posts a worldwide pause is reported not to apply to */
  exceptPosts?: string[];
  /** For an entry about the nationals of `countries` that covers some visa
   * classes only for some of them: which classes, per group of those
   * countries. A country in no group is covered for every class. On a visa
   * class page the class does not cover, the entry is not about the page's
   * country (see namesPost): it is shown collapsed there, if at all. A
   * post's own page covers every class, so it is about it there. */
  countryVisas?: CountryVisas[];
  /** Visa class slugs, "dv": of the consulate pages the rest of the scope
   * names, the entry is shown, expanded, only on these classes' pages, and
   * not on a post's own page, which covers every class */
  visaClasses?: string[];
  /** Other pages by path, "/nvc", where it is shown collapsed too */
  pages?: string[];
  /** About immigrant visas only: not shown on the pages of nonimmigrant visa
   * classes that do not go through NVC (a post's own page covers every
   * class, so it still shows there) */
  immigrantVisasOnly?: boolean;
}

/** The visas an entry covers for the nationals of some of its countries:
 * Presidential Proclamation 10998 suspends every visa for nationals of 19
 * countries, immigrant visas and B-1/B-2, F, M and J visas for those of 19
 * others, and immigrant visas only for those of Turkmenistan. */
export interface CountryVisas {
  countries: string[];
  /** Whether it covers immigrant visas */
  immigrant: boolean;
  /** The nonimmigrant visa class slugs it covers, "b1b2", or "all" */
  nonimmigrantClasses: string[] | "all";
}

export interface PolicyEntry {
  id: string;
  status: PolicyStatus;
  title: string;
  /** What a visitor needs to know, in one or two short sentences of plain
   * English: most visitors read English as a second language. Shown first;
   * the body is behind "Details". The build warns when it runs long (see
   * api/policy.ts). */
  summary: string;
  /** The facts in full, with dates and who said what. A blank line starts a
   * new paragraph. */
  body: string;
  scope: PolicyScope;
  /** Whether it is shown expanded on every page it is shown on but the
   * nonimmigrant classes' (the K visas' among them), rather than collapsed
   * with the other site-wide entries: for an entry without which the
   * interview-scheduling card cannot be read anywhere, such as a worldwide
   * pause of immigrant visa interviews */
  expanded?: boolean;
  /** Whether State's IV Scheduling Status Tool month is no queue at the
   * entry's posts while it lasts, e.g. because they schedule no interviews.
   * Only `posts` and `allConsulatePages` count for this, not `countries` or
   * `visaClasses`. */
  overridesSchedule?: boolean;
  /** Whether it stops visas being issued to the nationals of
   * `scope.countries` even when their interviews are scheduled, as a
   * suspension by nationality does: the interview-scheduling card of a post
   * in one of them then says that most of its applicants are affected. */
  suspendsIssuance?: boolean;
  /** When it took effect, "2026-05-18" */
  start: string;
  /** The day it ended or is due to end, the first day it no longer applies,
   * or null when no end is known */
  end: string | null;
  sources: PolicySource[];
  /** When someone last checked it against its sources, "2026-09-24" */
  lastChecked: string;
}

/** Every entry in the file, in its order */
export const POLICY_ENTRIES = policyData.entries as PolicyEntry[];

/** The pages other than the consulate pages that show notices, the only
 * values `scope.pages` may take (the build checks it, see api/policy.ts) */
export const POLICY_PAGES = ["/nvc", "/uscis/i-485"];

/** A consulate page an entry may be shown on: a post's own page, or one of
 * its visa class pages */
export interface ConsulatePage {
  /** "havana" */
  postSlug: string;
  /** The class of a visa class page, "cr1ir1"; undefined on the post's own
   * page */
  visaClassSlug?: string;
  /** The country whose nationals make up most of the page's immigrant visa
   * applicants, "Cuba" (see applicantCountry() in consulates.ts), or null */
  country: string | null;
  /** Whether it is a nonimmigrant class's page, the K visas' included */
  nonimmigrant?: boolean;
}

/** The group of `scope.countryVisas` a country is in, if any */
function countryVisasFor(
  entry: PolicyEntry,
  country: string,
): CountryVisas | undefined {
  return entry.scope.countryVisas?.find(({ countries }) =>
    countries.includes(country),
  );
}

/** Whether an entry about the nationals of `country` covers a page's visas:
 * every visa on a post's own page, and on a visa class page, its class, by
 * `scope.countryVisas` */
function coversPageClass(
  entry: PolicyEntry,
  country: string,
  { visaClassSlug, nonimmigrant }: ConsulatePage,
): boolean {
  const group = countryVisasFor(entry, country);
  if (group === undefined || visaClassSlug === undefined) return true;
  if (nonimmigrant !== true) return group.immigrant;
  return (
    group.nonimmigrantClasses === "all" ||
    group.nonimmigrantClasses.includes(visaClassSlug)
  );
}

/** Whether an entry names a page's post, or the country its applicants are
 * nationals of, for the page's visas: Proclamation 10998 is about Lagos's
 * B-1/B-2 page, since it suspends those visas for Nigerians, but not about
 * its H-1B page. */
function namesPost(entry: PolicyEntry, page: ConsulatePage): boolean {
  const { postSlug, country } = page;
  return (
    (entry.scope.posts?.includes(postSlug) ?? false) ||
    (country !== null &&
      (entry.scope.countries?.includes(country) ?? false) &&
      coversPageClass(entry, country, page))
  );
}

/** Whether an entry covers every post but `exceptPosts` */
function coversAllPosts(entry: PolicyEntry, postSlug: string): boolean {
  return (
    entry.scope.allConsulatePages === true &&
    !(entry.scope.exceptPosts?.includes(postSlug) ?? false)
  );
}

function appliesToPage(entry: PolicyEntry, page: ConsulatePage): boolean {
  const { visaClasses } = entry.scope;
  return (
    (visaClasses === undefined ||
      (page.visaClassSlug !== undefined &&
        visaClasses.includes(page.visaClassSlug))) &&
    (coversAllPosts(entry, page.postSlug) || namesPost(entry, page))
  );
}

/** Whether an entry is about a consulate page in particular, and so is shown
 * expanded on it: one that names its post, the country its applicants are
 * nationals of or its visa class, or that is `expanded`, unless the page is
 * a nonimmigrant class's. Entries that reach a page otherwise are shown
 * collapsed. */
export function isAboutPage(entry: PolicyEntry, page: ConsulatePage): boolean {
  return (
    (entry.expanded === true && page.nonimmigrant !== true) ||
    namesPage(entry, page)
  );
}

/** Whether an entry that is shown on a consulate page names the page: its
 * post, the country its applicants are nationals of, or its visa class */
export function namesPage(entry: PolicyEntry, page: ConsulatePage): boolean {
  return namesPost(entry, page) || entry.scope.visaClasses !== undefined;
}

/** The entries for a page, in the file's order: for a post's own page or one
 * of its visa class pages by `consulate`, and for any other page by `page`,
 * its path, "/nvc". Without `immigrant`, for the page of a nonimmigrant class
 * that does not go through NVC, the entries about immigrant visas only are
 * left out. */
export function policiesFor({
  consulate,
  page,
  immigrant = true,
}: {
  consulate?: ConsulatePage;
  page?: string;
  immigrant?: boolean;
}): PolicyEntry[] {
  return POLICY_ENTRIES.filter(
    (entry) =>
      (immigrant || entry.scope.immigrantVisasOnly !== true) &&
      ((consulate !== undefined && appliesToPage(entry, consulate)) ||
        (page !== undefined && (entry.scope.pages?.includes(page) ?? false))),
  );
}

/** The entry that suspends immigrant visas for the nationals of `country`,
 * the country most of a page's immigrant visa applicants are nationals of,
 * if one does:
 * one that has started and not ended by the day it was last checked, which
 * the prerendered page can say (see hasStarted and hasEnded). */
export function issuanceSuspensionFor(
  country: string | null,
): PolicyEntry | null {
  if (country === null) return null;
  return (
    POLICY_ENTRIES.find(
      (entry) =>
        entry.suspendsIssuance === true &&
        (entry.scope.countries?.includes(country) ?? false) &&
        (countryVisasFor(entry, country)?.immigrant ?? true) &&
        hasStarted(entry, null) &&
        !hasEnded(entry, null),
    ) ?? null
  );
}

/** Whether an entry has taken effect, on or after its `start` day: by the
 * time it was last checked, which the prerendered page can say, or by
 * `today`, which only the client knows and which is null while prerendering
 * and hydrating. An entry announced ahead of time is not shown or applied
 * before it starts. */
export function hasStarted(entry: PolicyEntry, today: string | null): boolean {
  return (
    entry.start <= entry.lastChecked || (today !== null && today >= entry.start)
  );
}

/** Whether an entry has ended, on or after its `end` day: by the time it was
 * last checked, which the prerendered page can say, or by `today`, which only
 * the client knows and which is null while prerendering and hydrating. */
export function hasEnded(entry: PolicyEntry, today: string | null): boolean {
  if (entry.end === null) return false;
  return (
    entry.end <= entry.lastChecked || (today !== null && today >= entry.end)
  );
}

/** Whether State's tool update of `asOf` still has to be ignored under an
 * entry: while the entry applies (on the client, until `today` reaches its
 * end), and after it ends for as long as the newest update predates the end,
 * since that update was taken while, say, a post was scheduling nothing. */
export function overridesUpdate(
  entry: PolicyEntry,
  asOf: string,
  today: string | null,
): boolean {
  return !(hasEnded(entry, today) && entry.end !== null && asOf >= entry.end);
}

/** The entry that makes State's IV Scheduling Status Tool month of `asOf` no
 * queue at a post, such as a pause of all visa services there, or null. When
 * several apply (Juba is both paused and moved to a hub), the one that lasts
 * longest wins, so the card does not start showing a queue when the shorter
 * one ends. An entry counts from its start, by `today` on the client and by
 * the day it was last checked while prerendering (`today` null). The
 * prerendered page cannot know today's date, so an entry due to end later
 * counts there; IvScheduleCard re-checks that on the client. */
export function scheduleOverrideFor(
  postSlug: string,
  asOf: string,
  today: string | null,
): PolicyEntry | null {
  const lastsUntil = (entry: PolicyEntry) => entry.end ?? "9999-12-31";
  return (
    POLICY_ENTRIES.filter(
      (entry) =>
        entry.overridesSchedule === true &&
        (coversAllPosts(entry, postSlug) ||
          (entry.scope.posts?.includes(postSlug) ?? false)) &&
        hasStarted(entry, today) &&
        overridesUpdate(entry, asOf, null),
    ).sort((a, b) => lastsUntil(b).localeCompare(lastsUntil(a)))[0] ?? null
  );
}
