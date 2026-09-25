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
  /** Shown, collapsed with the other site-wide entries, on every post's page
   * and its visa class pages */
  allConsulatePages?: boolean;
  /** Other pages by path, "/nvc", where it is shown collapsed too */
  pages?: string[];
}

export interface PolicyEntry {
  id: string;
  status: PolicyStatus;
  title: string;
  body: string;
  scope: PolicyScope;
  /** Whether State's IV Scheduling Status Tool month is no queue at the
   * entry's posts while it lasts, e.g. because they schedule no interviews */
  overridesSchedule?: boolean;
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

/** Whether an entry is about a post in particular, and so is shown expanded
 * on its pages; entries that reach a page otherwise are shown collapsed. */
export function isAboutPost(entry: PolicyEntry, postSlug: string): boolean {
  return entry.scope.posts?.includes(postSlug) ?? false;
}

function appliesToPost(entry: PolicyEntry, postSlug: string): boolean {
  return entry.scope.allConsulatePages === true || isAboutPost(entry, postSlug);
}

/** The entries for a page, in the file's order: for a post's own page and
 * its visa class pages by `postSlug`, "kampala", and for any other page by
 * `page`, its path, "/nvc". */
export function policiesFor({
  postSlug,
  page,
}: {
  postSlug?: string;
  page?: string;
}): PolicyEntry[] {
  return POLICY_ENTRIES.filter(
    (entry) =>
      (postSlug !== undefined && appliesToPost(entry, postSlug)) ||
      (page !== undefined && (entry.scope.pages?.includes(page) ?? false)),
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
 * one ends. The prerendered page cannot know today's date, so an entry due to
 * end later counts there; IvScheduleCard re-checks it on the client. */
export function scheduleOverrideFor(
  postSlug: string,
  asOf: string,
): PolicyEntry | null {
  const lastsUntil = (entry: PolicyEntry) => entry.end ?? "9999-12-31";
  return (
    POLICY_ENTRIES.filter(
      (entry) =>
        entry.overridesSchedule === true &&
        appliesToPost(entry, postSlug) &&
        overridesUpdate(entry, asOf, null),
    ).sort((a, b) => lastsUntil(b).localeCompare(lastsUntil(a)))[0] ?? null
  );
}
