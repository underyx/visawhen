import policyData from "../data/policy.json";

// Checks data/policy.json when the site is built, so that no page shows a
// notice without its dates or sources. The pages read the file through
// components/policy.ts; this runs once per build, from the consulate pages'
// getStaticPaths.

/** More entries with no end date than this is more than anyone re-checks
 * every week. */
const MAX_OPEN_ENDED = 5;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** A calendar day that exists: "2026-02-28", but not "2026-02-30", which
 * Date.parse would roll over to March 2 */
function isDate(value: unknown): value is string {
  if (typeof value !== "string" || !ISO_DATE.test(value)) return false;
  const time = Date.parse(value);
  return (
    !Number.isNaN(time) && new Date(time).toISOString().slice(0, 10) === value
  );
}

function isText(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "";
}

function isTextList(value: unknown): value is string[] {
  return Array.isArray(value) && value.length > 0 && value.every(isText);
}

/** What is wrong with an entry of the file, if anything */
function problemsWith(entry: Record<string, unknown>): string[] {
  const scope = (entry.scope ?? {}) as Record<string, unknown>;
  const sources = entry.sources;
  const checks: [boolean, string][] = [
    [isText(entry.id), "id must be a non-empty string"],
    [
      entry.status === "official" || entry.status === "reported",
      'status must be "official" or "reported"',
    ],
    [isText(entry.title), "title must be a non-empty string"],
    [isText(entry.body), "body must be a non-empty string"],
    [
      (scope.posts === undefined || isTextList(scope.posts)) &&
        (scope.pages === undefined || isTextList(scope.pages)) &&
        (scope.allConsulatePages === undefined ||
          typeof scope.allConsulatePages === "boolean") &&
        (scope.posts !== undefined ||
          scope.pages !== undefined ||
          scope.allConsulatePages === true),
      "scope must name posts, pages or allConsulatePages: true",
    ],
    [
      entry.overridesSchedule === undefined ||
        typeof entry.overridesSchedule === "boolean",
      "overridesSchedule must be true or false",
    ],
    [isDate(entry.start), "start must be a date, YYYY-MM-DD"],
    [
      entry.end === null ||
        (isDate(entry.end) && isDate(entry.start) && entry.end >= entry.start),
      "end must be null or a date, YYYY-MM-DD, not before start",
    ],
    [
      Array.isArray(sources) &&
        sources.length > 0 &&
        sources.every(
          (source: Record<string, unknown>) =>
            isText(source.label) &&
            typeof source.url === "string" &&
            /^https?:\/\//.test(source.url),
        ),
      "sources must list at least one {label, url} with an http(s) URL",
    ],
    [isDate(entry.lastChecked), "lastChecked must be a date, YYYY-MM-DD"],
  ];
  return checks.filter(([ok]) => !ok).map(([, problem]) => problem);
}

/** Fails the build when an entry is broken, and warns when entries name a
 * post the site has no page for (their notices would never be shown) or when
 * too many have no end date. `postSlugs` are the posts that have a page. */
export function checkPolicies(postSlugs: string[]): void {
  const entries: Record<string, unknown>[] = policyData.entries;
  const seen = new Set<string>();
  const problems = entries.flatMap((entry, index) => {
    const name = `entry ${index + 1}${
      typeof entry.id === "string" ? ` (${entry.id})` : ""
    }`;
    const found = problemsWith(entry);
    if (typeof entry.id === "string") {
      if (seen.has(entry.id)) found.push("id is used by an earlier entry");
      seen.add(entry.id);
    }
    return found.map((problem) => `${name}: ${problem}`);
  });
  if (problems.length > 0)
    throw new Error(
      `data/policy.json is not valid:\n  ${problems.join("\n  ")}`,
    );

  const known = new Set(postSlugs);
  const unknown = policyData.entries.flatMap((entry) =>
    ((entry.scope as { posts?: string[] }).posts ?? [])
      .filter((postSlug) => !known.has(postSlug))
      .map((postSlug) => `${postSlug} (${entry.id})`),
  );
  if (unknown.length > 0)
    console.warn(
      `data/policy.json names posts that have no page, so their notices are not shown: ${unknown.join(
        ", ",
      )}`,
    );

  // A warning, not an error: failing the build would also hold back the
  // scheduled data deploys.
  const openEnded = policyData.entries.filter((entry) => entry.end === null);
  if (openEnded.length > MAX_OPEN_ENDED)
    console.warn(
      `data/policy.json has ${
        openEnded.length
      } entries with no end date (${openEnded
        .map((entry) => entry.id)
        .join(
          ", ",
        )}); keep it to ${MAX_OPEN_ENDED} or fewer, so that each is re-checked every week: set the end date of those that have ended, or remove those that no longer need a notice.`,
    );
}
