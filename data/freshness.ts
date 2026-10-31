// Check how old each data source's newest data is, and keep one GitHub issue
// open per source whose data has gone stale.
//
//     bun data/freshness.ts                    # report only
//     bun data/freshness.ts --github           # also open, update and close the issues
//     bun data/freshness.ts --json out.json    # also write the report as JSON rows
//     bun data/freshness.ts --today 2026-11-01 # check as of another day
//
// The scheduled scrapers treat "the source is unreachable" and "nothing new
// yet" alike (a warning, and a green run), so a scraper that silently stops
// finding data would otherwise go unnoticed for months. This compares each
// source's newest date with how often the source publishes:
//
// * NVC timeframes (data/nvc/data.json): NVC updates its page weekly; stale
//   14 days after the newest reading.
// * Interview queues (data/consulates/iv_schedule.json): State updates its IV
//   Scheduling Status Tool about monthly; stale once the newest snapshot is
//   more than 45 days old, when the consulate pages start warning about it
//   too (IvScheduleCard's MAX_AGE_DAYS).
// * USCIS forms (data/uscis/forms.json): USCIS publishes each quarter a few
//   months after it ends; stale 120 days after the end of the quarter after
//   the newest one.
// * USCIS monthly (data/uscis/monthly.json): USCIS publishes each month's
//   report about four weeks after the month ends; stale 60 days after the
//   end of the month after the newest one.
// * Visa Bulletins (data/visa_bulletin/data.json): State publishes each
//   month's bulletin around the middle of the month before; stale 8 days
//   into a month with no bulletin for it, when the Visa Bulletin pages start
//   warning about it too (GRACE_DAYS in pages/visa-bulletin/).
// * Consulate issuances (data/consulates/dump/backlogs.ndjson.gz): State
//   publishes its monthly issuance statistics several months late, often in
//   batches; stale 240 days after the end of the newest month.
// * Policy notices (data/policy.json): written by hand and re-checked weekly;
//   the pages drop a live entry 29 days after its last check (UNCHECKED_DAYS
//   in components/policy.ts), so the file counts as stale 22 days after the
//   oldest check of an entry that has not ended, a week ahead, as the
//   build's warning does.
//
// With --json, the report is also written to a file as a list of rows, one
// per source: its name, newest data, the day it turns stale, its status
// ("stale", "due soon" within DUE_SOON_DAYS of that day, or "current") and
// the workflow that updates it. The weekly upkeep routine reads it to
// refresh the data freshness report.
//
// With --github, a stale source gets an issue labelled "stale-data", titled
// "Stale data: <source>", whose text is updated on every run (an edit, which
// notifies no one), and the issue is closed with a comment once the source
// has new data. It uses the gh CLI, which needs GH_TOKEN with issues: write.
//
// Only Bun's built-in modules are used, so the workflow needs no install.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { gunzipSync } from "node:zlib";

const DATA = import.meta.dir;
// Links in the issues are absolute, so that they also work in notifications
const REPOSITORY_URL = `${process.env.GITHUB_SERVER_URL ?? "https://github.com"}/${process.env.GITHUB_REPOSITORY ?? "underyx/visawhen"}`;
const LABEL = "stale-data";
// --json calls a source "due soon" this many days before it turns stale
const DUE_SOON_DAYS = 7;
const TITLE_PREFIX = "Stale data: ";
// The stale-from day of a source that cannot go stale
const NEVER = "9999-12-31";

export interface Freshness {
  // The source's name, as it appears in the issue's title
  source: string;
  // Its newest data: "2026-07-13", or its newest month or quarter
  newest: string;
  // The day from which the data counts as stale, "YYYY-MM-DD"
  staleFrom: string;
  // How often the source publishes, as a sentence
  cadence: string;
  // Where to look when it is stale, as Markdown
  where: string;
  // The workflow file that updates the data, or null when it is kept by hand
  workflow: string | null;
}

const DAY_MS = 86_400_000;
export const addDays = (day: string, days: number) =>
  new Date(Date.parse(`${day}T00:00:00Z`) + days * DAY_MS)
    .toISOString()
    .slice(0, 10);
export const daysBetween = (from: string, to: string) =>
  Math.round(
    (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS,
  );
/** The last day of a month, from 1; a month past 12 runs into the next year. */
export const endOfMonth = (year: number, month: number) =>
  new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);

const readJson = <T>(...path: string[]) =>
  JSON.parse(readFileSync(join(DATA, ...path), "utf8")) as T;
const newestOf = (values: Iterable<string>) => [...values].sort().at(-1)!;

function nvc(): Freshness {
  const data = readJson<Record<string, Record<string, number>>>(
    "nvc",
    "data.json",
  );
  const newest = newestOf(
    Object.values(data).flatMap((timeframe) => Object.keys(timeframe)),
  );
  return {
    source: "NVC timeframes",
    newest,
    staleFrom: addDays(newest, 14),
    cadence:
      "NVC updates its timeframes page weekly, so the data counts as stale 14 days after its newest reading.",
    where:
      "The scraper is `data/nvc/main.ts`, run by the " +
      `[Update NVC and interview-queue data](${REPOSITORY_URL}/actions/workflows/nvc_update_schedule.yml) workflow. Its log says which sources ` +
      "answered (travel.state.gov, the adoption.state.gov mirror, the Wayback Machine) and what date each " +
      "page is as of. Compare with [NVC's page](https://travel.state.gov/content/travel/en/us-visas/" +
      "immigrate/nvc-timeframes.html).",
    workflow: "nvc_update_schedule.yml",
  };
}

function ivSchedule(): Freshness {
  const data = readJson<{ snapshots: Record<string, unknown> }>(
    "consulates",
    "iv_schedule.json",
  );
  const newest = newestOf(Object.keys(data.snapshots));
  return {
    source: "interview queues (IV Scheduling Status Tool)",
    newest,
    // the day it is more than 45 days old, as in IvScheduleCard
    staleFrom: addDays(newest, 46),
    cadence:
      "State updates its IV Scheduling Status Tool about monthly, so the data counts as stale once the " +
      "newest snapshot is more than 45 days old; the consulate pages warn about it from then on too.",
    where:
      "The scraper is `data/consulates/iv_schedule.ts --fetch`, run by the " +
      `[Update NVC and interview-queue data](${REPOSITORY_URL}/actions/workflows/nvc_update_schedule.yml) workflow. If the ` +
      "[tool](https://travel.state.gov/content/travel/en/us-visas/visa-information-resources/iv-wait-times.html) " +
      "has a newer update, the log says why it was not added; the page can also be saved from a browser and " +
      "added with `iv_schedule.ts --from-file`.",
    workflow: "nvc_update_schedule.yml",
  };
}

function uscisForms(): Freshness {
  const { periods } = readJson<{
    periods: { end: string; fiscalYear: number; fiscalQuarter: number }[];
  }>("uscis", "forms.json");
  const newest = periods.at(-1)!;
  const nextEnd = endOfMonth(
    Number(newest.end.slice(0, 4)),
    Number(newest.end.slice(5, 7)) + 3,
  );
  return {
    source: "USCIS forms",
    newest: `FY${newest.fiscalYear} Q${newest.fiscalQuarter} (ended ${newest.end})`,
    staleFrom: addDays(nextEnd, 120),
    cadence:
      "USCIS publishes each quarter's reports a few months after the quarter ends, so the data counts as " +
      `stale 120 days after the next quarter ended on ${nextEnd}.`,
    where:
      "The scraper is `data/uscis/forms.ts`, run by the " +
      `[Update USCIS forms data](${REPOSITORY_URL}/actions/workflows/uscis_forms_update_schedule.yml) workflow. Check ` +
      "whether USCIS's [Immigration and Citizenship Data](https://www.uscis.gov/tools/reports-and-studies/" +
      "immigration-and-citizenship-data) page lists the next quarter; if it does, the workflow's log says " +
      "why it was not added.",
    workflow: "uscis_forms_update_schedule.yml",
  };
}

function uscisMonthly(): Freshness {
  const { months } = readJson<{ months: Record<string, unknown> }>(
    "uscis",
    "monthly.json",
  );
  const newest = newestOf(Object.keys(months));
  const nextEnd = endOfMonth(
    Number(newest.slice(0, 4)),
    Number(newest.slice(5, 7)) + 1,
  );
  return {
    source: "USCIS monthly",
    newest,
    staleFrom: addDays(nextEnd, 60),
    cadence:
      "USCIS publishes each month's Application Processing Data report about four weeks after the month " +
      `ends, so the data counts as stale 60 days after the next month ended on ${nextEnd}.`,
    where:
      "The scraper is `data/uscis/monthly.ts`, run by the " +
      `[Update USCIS monthly data](${REPOSITORY_URL}/actions/workflows/uscis_monthly_update_schedule.yml) workflow. ` +
      "Check whether USCIS's [Immigration and Citizenship Data](https://www.uscis.gov/tools/reports-and-studies/" +
      "immigration-and-citizenship-data?query=Appropriations&items_per_page=100) page lists the next month; if " +
      "it does, the workflow's log says why it was not added; the report can also be saved from a browser and " +
      "added with `monthly.ts --from-file`.",
    workflow: "uscis_monthly_update_schedule.yml",
  };
}

function visaBulletin(): Freshness {
  const { bulletins } = readJson<{ bulletins: Record<string, unknown> }>(
    "visa_bulletin",
    "data.json",
  );
  const newest = newestOf(Object.keys(bulletins));
  // the first day of the month after the newest bulletin's
  const due = addDays(
    endOfMonth(Number(newest.slice(0, 4)), Number(newest.slice(5, 7))),
    1,
  );
  return {
    source: "Visa Bulletins",
    newest,
    // more than 7 days into that month, as on the Visa Bulletin pages
    staleFrom: addDays(due, 8),
    cadence:
      "State publishes each month's Visa Bulletin around the middle of the month before, so the data counts " +
      `as stale once ${due} is more than 7 days past without the bulletin for that month; the ` +
      "Visa Bulletin pages warn about it from then on too.",
    where:
      "The scraper is `data/visa_bulletin/bulletin.ts`, run by the " +
      `[Update Visa Bulletin data](${REPOSITORY_URL}/actions/workflows/visa_bulletin_update_schedule.yml) workflow. ` +
      "If State's [Visa Bulletin page](https://travel.state.gov/content/travel/en/legal/visa-law0/visa-bulletin.html) " +
      "lists a newer bulletin, the log says why it was not added; the page can also be saved from a browser and " +
      "added with `bulletin.ts --from-file`.",
    workflow: "visa_bulletin_update_schedule.yml",
  };
}

function consulateIssuances(): Freshness {
  const dump = gunzipSync(
    readFileSync(join(DATA, "consulates", "dump", "backlogs.ndjson.gz")),
  ).toString("utf8");
  // rows are [post slug, visa class slug, month "2025-09-01 00:00:00", ...];
  // the month is the third value, read without parsing 1.3M rows
  let newest = "";
  for (const match of dump.matchAll(/^\["[^"]*", "[^"]*", "([^"]*)"/gm))
    if (match[1] > newest) newest = match[1];
  return {
    source: "consulate issuances",
    newest: newest.slice(0, 7),
    staleFrom: addDays(
      endOfMonth(Number(newest.slice(0, 4)), Number(newest.slice(5, 7))),
      240,
    ),
    cadence:
      "State publishes its monthly visa issuance statistics several months late, often a few months at a " +
      "time (October 2025 to February 2026 all appeared between July and September 2026), so the data counts " +
      "as stale 240 days after the end of the newest month.",
    where:
      "The scraper is `data/consulates/visa_issuances.ts`, run by the " +
      `[Update consulates data](${REPOSITORY_URL}/actions/workflows/consulate_update_schedule.yml) workflow. Check whether ` +
      "State's [monthly immigrant visa issuance statistics](https://travel.state.gov/content/travel/en/legal/" +
      "visa-law0/visa-statistics/immigrant-visa-statistics/monthly-immigrant-visa-issuances.html) list a " +
      "newer month; if they do, the workflow's log says why it was not added.",
    workflow: "consulate_update_schedule.yml",
  };
}

function policyNotices(today: string): Freshness {
  const { entries } = readJson<{
    entries: { end: string | null; lastChecked: string }[];
  }>("policy.json");
  // an entry that has ended stays on the pages without re-checks
  const live = entries.filter(
    (entry) => entry.end === null || entry.end > today,
  );
  const oldest =
    live.length > 0 ? live.map((entry) => entry.lastChecked).sort()[0] : null;
  return {
    source: "policy notices",
    newest: oldest ?? "none open",
    staleFrom: oldest ? addDays(oldest, 22) : NEVER,
    cadence:
      "The policy notices are re-checked against their sources weekly. The pages drop an entry that has not " +
      "ended 29 days after its last check (`UNCHECKED_DAYS` in `components/policy.ts`), so the file counts as " +
      "stale 22 days after its oldest such check: a week before the first notice disappears. The date above " +
      "is that oldest check.",
    where:
      "Re-check each entry in `data/policy.json` against its sources and set its `lastChecked`, as the " +
      "README's policy section says. The weekly upkeep routine does this on Tuesdays; if it has not, it has " +
      "stopped running or failed.",
    workflow: null,
  };
}

export const CHECKS: (() => Freshness)[] = [
  nvc,
  ivSchedule,
  uscisForms,
  uscisMonthly,
  visaBulletin,
  consulateIssuances,
];

export function status(freshness: Freshness, today: string): string {
  if (today >= freshness.staleFrom) return "stale";
  if (daysBetween(today, freshness.staleFrom) <= DUE_SOON_DAYS)
    return "due soon";
  return "current";
}

/** The --json report: one row per source. */
export function reportRows(results: Freshness[], today: string) {
  return results.map((freshness) => ({
    source: freshness.source,
    newest: freshness.newest,
    stale_from: freshness.staleFrom === NEVER ? null : freshness.staleFrom,
    status: status(freshness, today),
    workflow: freshness.workflow,
    checked: today,
  }));
}

export function issueBody(
  freshness: Freshness,
  today: string,
  runUrl: string | null,
): string {
  const staleDays = daysBetween(freshness.staleFrom, today);
  const since =
    staleDays === 0
      ? "today"
      : `${staleDays} ${staleDays === 1 ? "day" : "days"} ago`;
  const checked = runUrl
    ? `[the freshness workflow](${runUrl})`
    : "the freshness workflow";
  return [
    `The newest ${freshness.source} data is from **${freshness.newest}**. It became stale on ` +
      `${freshness.staleFrom}, ${since}.`,
    freshness.cadence,
    freshness.where,
    `Last checked ${today} by ${checked} (\`data/freshness.ts\`). It updates this issue while the ` +
      "data stays stale and closes it when newer data arrives.",
  ].join("\n\n");
}

function gh(...args: string[]): string {
  const result = Bun.spawnSync(["gh", ...args], {
    stdout: "pipe",
    stderr: "pipe",
  });
  if (result.exitCode !== 0) {
    console.error(
      `gh ${args[0]} ${args[1]} failed: ${result.stderr.toString().trim()}`,
    );
    process.exit(1);
  }
  return result.stdout.toString();
}

/** Open, update or close one issue per source. */
function syncIssues(
  results: [Freshness, boolean][],
  today: string,
  runUrl: string | null,
): void {
  gh(
    "label",
    "create",
    LABEL,
    "--force",
    "--color",
    "d93f0b",
    "--description",
    "A data source has had no new data for longer than it should",
  );
  const openIssues = new Map(
    (
      JSON.parse(
        gh(
          "issue",
          "list",
          "--label",
          LABEL,
          "--state",
          "open",
          "--limit",
          "100",
          "--json",
          "number,title",
        ),
      ) as { number: number; title: string }[]
    ).map((issue) => [issue.title, issue.number]),
  );
  for (const [freshness, stale] of results) {
    const title = `${TITLE_PREFIX}${freshness.source}`;
    const number = openIssues.get(title);
    if (stale) {
      const body = issueBody(freshness, today, runUrl);
      if (number === undefined) {
        console.log(`Opening an issue: ${title}`);
        gh(
          "issue",
          "create",
          "--title",
          title,
          "--label",
          LABEL,
          "--body",
          body,
        );
      } else {
        console.log(`Updating issue #${number}: ${title}`);
        gh("issue", "edit", String(number), "--body", body);
      }
    } else if (number !== undefined) {
      console.log(`Closing issue #${number}: ${title}`);
      gh(
        "issue",
        "close",
        String(number),
        "--comment",
        `New data arrived: the newest ${freshness.source} data is now from ${freshness.newest}.`,
      );
    }
  }
}

function main(): number {
  const { values } = parseArgs({
    options: {
      github: { type: "boolean" },
      json: { type: "string" },
      today: { type: "string" },
    },
  });
  if (values.today !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(values.today)) {
    throw new Error(`--today takes a day as YYYY-MM-DD, not ${values.today}`);
  }
  const today = values.today ?? new Date().toISOString().slice(0, 10);

  const results: [Freshness, boolean][] = [];
  for (const check of [...CHECKS, () => policyNotices(today)]) {
    const freshness = check();
    const stale = today >= freshness.staleFrom;
    results.push([freshness, stale]);
    console.log(
      `${freshness.source}: newest ${freshness.newest}, ${stale ? "STALE since" : "stale from"} ${freshness.staleFrom}`,
    );
    if (stale)
      console.log(
        `::warning::${freshness.source} data is stale: the newest is ${freshness.newest}`,
      );
  }

  if (values.json !== undefined) {
    writeFileSync(
      values.json,
      `${JSON.stringify(
        reportRows(
          results.map(([freshness]) => freshness),
          today,
        ),
        null,
        2,
      )}\n`,
    );
    console.log(`Wrote ${values.json}`);
  }

  if (values.github) {
    const runId = process.env.GITHUB_RUN_ID;
    syncIssues(
      results,
      today,
      runId ? `${REPOSITORY_URL}/actions/runs/${runId}` : null,
    );
  }
  return 0;
}

if (import.meta.main) process.exit(main());
