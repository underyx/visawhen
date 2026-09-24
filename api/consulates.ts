import { readFile } from "fs/promises";
import { join } from "path";
import sqlite3 from "sqlite3";
import { open } from "sqlite";
import type { IvCategory, IvSchedule } from "../components/consulates";

const dataDir = join(process.cwd(), "data");

type Db = Awaited<ReturnType<typeof open>>;
let dbPromise: Promise<Db> | undefined;

// One connection per process, opened lazily. `next build` renders the ~15,000
// consulate pages in parallel worker processes, each of which gets its own
// connection; before this every getStaticProps call opened a fresh one.
function openDb(): Promise<Db> {
  if (dbPromise === undefined) {
    dbPromise = open({
      filename: join(dataDir, `consulates/consulates.sqlite`),
      driver: sqlite3.Database,
    }).then(async (db) => {
      // The build workers race to create the indexes; wait for the lock
      // instead of failing with SQLITE_BUSY.
      db.configure("busyTimeout", 60_000);
      // `yarn ensure-db` rebuilds the database from the dump, and
      // sqlite-diffable does not recreate indexes, so every per-page query
      // used to full-scan the 1.3M-row backlogs table. Creating them here
      // takes a few seconds once and makes the page lookups instant.
      await db.exec(`
        CREATE INDEX IF NOT EXISTS backlogs_post_visa
          ON backlogs("Post Slug", "Visa Class Slug");
        CREATE INDEX IF NOT EXISTS baselines_post_visa
          ON baselines("Post Slug", "Visa Class Slug");
      `);
      return db;
    });
  }
  return dbPromise;
}

export interface SlugPairRow {
  postSlug: string;
  visaClassSlug: string;
}

export async function getSlugPairs(): Promise<SlugPairRow[]> {
  const db = await openDb();
  return await db.all<SlugPairRow[]>(`
    SELECT DISTINCT "Post Slug" AS postSlug, "Visa Class Slug" AS visaClassSlug
    FROM backlogs
  `);
}

export async function getVisaClassSlugsForPost(
  postSlug: string,
): Promise<string[]> {
  const db = await openDb();
  const rows = await db.all<{ visaClassSlug: string }[]>(
    `
    SELECT DISTINCT "Visa Class Slug" AS visaClassSlug
    FROM backlogs WHERE "Post Slug" = ?
    `,
    postSlug,
  );
  return rows.map((row) => row.visaClassSlug);
}

export interface PostRow {
  post: string;
  postSlug: string;
}

export async function getPost(postSlug: string): Promise<PostRow | undefined> {
  const db = await openDb();
  return await db.get<PostRow>(
    `
      SELECT "Post" AS post, "Post Slug" AS postSlug
      FROM post_slugs WHERE "Post Slug" = ?
    `,
    postSlug,
  );
}

export async function getAllPosts(): Promise<PostRow[]> {
  const db = await openDb();
  return await db.all<PostRow[]>(
    `
      SELECT "Post" AS post, "Post Slug" AS postSlug
      FROM post_slugs
    `,
  );
}

export interface VisaClassRow {
  visaClass: string;
  visaClassSlug: string;
  description: string | null;
}

// The scraper folds some immigrant classes into nonimmigrant classes that
// share their symbol, and some nonimmigrant classes into immigrant ones (see
// the `replace` map in data/consulates/baselines.ipynb): E2 also counts EB-2
// (E21-E2C), E3 also counts EB-3 (E31-E3P), and CW1/IW1 and CW2/IW2 also
// count the CW-1 Northern Mariana Islands workers and their families. The
// descriptions from the spreadsheet only name one side, so say what the
// numbers really cover until the consulate data rebuild splits them apart.
const DESCRIPTION_OVERRIDES: Record<string, string> = {
  e2: "EB-2 immigrant visas for people with advanced degrees or exceptional ability, counted together with E-2 visas for treaty investors and their spouses and children",
  e3: "EB-3 immigrant visas for skilled workers and professionals, counted together with E-3 Australian professional visas",
  cw1iw1:
    "IW1 visas for widows and widowers of U.S. citizens, counted together with CW-1 Northern Mariana Islands worker visas",
  cw2iw2:
    "IW2 visas for children of IW1 visa holders, counted together with CW-2 visas for CW-1 workers' families",
};

function withDescriptionOverride(row: VisaClassRow): VisaClassRow {
  return {
    ...row,
    description: DESCRIPTION_OVERRIDES[row.visaClassSlug] ?? row.description,
  };
}

export async function getVisaClass(
  visaClassSlug: string,
): Promise<VisaClassRow | undefined> {
  const db = await openDb();
  const row = await db.get<VisaClassRow>(
    `
      SELECT "Visa Class" AS visaClass, "Visa Class Slug" AS visaClassSlug, "Description" AS description
      FROM visa_slugs WHERE "Visa Class Slug" = ?
    `,
    visaClassSlug,
  );
  return row === undefined ? undefined : withDescriptionOverride(row);
}

export async function getAllVisaClasses(): Promise<VisaClassRow[]> {
  const db = await openDb();
  const rows = await db.all<VisaClassRow[]>(
    `
      SELECT "Visa Class" AS visaClass, "Visa Class Slug" AS visaClassSlug, "Description" AS description
      FROM visa_slugs
    `,
  );
  return rows.map(withDescriptionOverride);
}

export interface BaselineRow {
  issuances: number;
}

/** The 2017-2020 average the pages used to compare against. The pages no
 * longer show it, but a pair only gets a page if it has one, which keeps the
 * set of consulate pages (and URLs) unchanged. */
export async function getBaseline(
  postSlug: string,
  visaClassSlug: string,
): Promise<BaselineRow | undefined> {
  const db = await openDb();
  return await db.get<BaselineRow>(
    `
    SELECT "Issuances" AS issuances
    FROM baselines
    WHERE "Post Slug" = ? AND "Visa Class Slug" = ?
  `,
    postSlug,
    visaClassSlug,
  );
}

/** The months are stored as "2025-09-01 00:00:00", in UTC. */
function toIsoMonth(month: string): string {
  return month.replace(" ", "T") + ".000Z";
}

export interface RecentWindow {
  /** The first of the last 12 months in the data, "2024-10-01T00:00:00.000Z" */
  from: string;
  /** The newest month in the data, "2025-09-01T00:00:00.000Z" */
  to: string;
}

interface StoredRecentWindow {
  /** The first of the last 12 months in the data, as stored: "2024-10-01 00:00:00" */
  from: string;
  /** The newest month in the data, as stored: "2025-09-01 00:00:00" */
  to: string;
}

let recentWindowPromise: Promise<StoredRecentWindow> | undefined;

// The last 12 months in the data, which are the same for every pair: each one
// has a (zero-filled) row for every month. "Month" has no index, so finding
// the newest one takes a full scan of the backlogs table, and every consulate
// page asks for it; do it once per process, like opening the connection.
function getStoredRecentWindow(): Promise<StoredRecentWindow> {
  if (recentWindowPromise === undefined) {
    recentWindowPromise = openDb().then(async (db) => {
      const row = await db.get<{ from: string | null; to: string | null }>(
        `SELECT datetime(MAX("Month"), '-11 months') AS "from", MAX("Month") AS "to" FROM backlogs`,
      );
      if (row === undefined || row.from === null || row.to === null)
        throw new Error("The backlogs table is empty");
      return { from: row.from, to: row.to };
    });
  }
  return recentWindowPromise;
}

export async function getRecentWindow(): Promise<RecentWindow> {
  const { from, to } = await getStoredRecentWindow();
  return { from: toIsoMonth(from), to: toIsoMonth(to) };
}

export interface RecentPostIssuancesRow {
  postSlug: string;
  /** Visas issued in the last 12 months of the data */
  issuances: number;
}

export async function getRecentIssuancesByPost(): Promise<
  RecentPostIssuancesRow[]
> {
  const db = await openDb();
  const { from } = await getStoredRecentWindow();
  return await db.all<RecentPostIssuancesRow[]>(
    `
    SELECT "Post Slug" AS postSlug, SUM("Issuances") AS issuances
    FROM backlogs
    WHERE "Month" >= ?
    GROUP BY 1
  `,
    from,
  );
}

export interface RecentVisaClassIssuancesRow {
  visaClassSlug: string;
  /** Visas issued in the last 12 months of the data */
  issuances: number;
}

export async function getRecentIssuancesByClass(
  postSlug: string,
): Promise<RecentVisaClassIssuancesRow[]> {
  const db = await openDb();
  const { from } = await getStoredRecentWindow();
  return await db.all<RecentVisaClassIssuancesRow[]>(
    `
    SELECT "Visa Class Slug" AS visaClassSlug, SUM("Issuances") AS issuances
    FROM backlogs
    WHERE "Post Slug" = ? AND "Month" >= ?
    GROUP BY 1
  `,
    postSlug,
    from,
  );
}

export interface IssuancesRow {
  /** "2025-09-01T00:00:00.000Z" */
  month: string;
  issuances: number;
}

/** Visas issued each month, oldest first, with a row for every month in the
 * data (zero when none were issued). */
export async function getMonthlyIssuances(
  postSlug: string,
  visaClassSlug: string,
): Promise<IssuancesRow[]> {
  const db = await openDb();
  const rows = await db.all<IssuancesRow[]>(
    `
    SELECT "Month" AS month, "Issuances" AS issuances
    FROM backlogs
    WHERE "Post Slug" = ? AND "Visa Class Slug" = ?
    ORDER BY "Month"
  `,
    postSlug,
    visaClassSlug,
  );
  return rows.map((row) => ({ ...row, month: toIsoMonth(row.month) }));
}

/** data/consulates/iv_schedule.json, written by iv_schedule.py */
interface IvScheduleData {
  source: string;
  /** State's updates by date, "2026-09-23", each by post slug */
  snapshots: Record<
    string,
    Record<string, Record<IvCategory, string | null> & { name: string }>
  >;
}

let ivScheduleDataPromise: Promise<IvScheduleData> | undefined;

function readIvScheduleData(): Promise<IvScheduleData> {
  if (ivScheduleDataPromise === undefined) {
    ivScheduleDataPromise = readFile(
      join(dataDir, "consulates", "iv_schedule.json"),
      "utf-8",
    ).then((contents) => JSON.parse(contents));
  }
  return ivScheduleDataPromise;
}

/** The date of State's newest update of its IV Scheduling Status Tool that
 * we have, "2026-09-23" */
export async function getIvScheduleAsOf(): Promise<string> {
  const { snapshots } = await readIvScheduleData();
  const dates = Object.keys(snapshots).sort();
  if (dates.length === 0)
    throw new Error("data/consulates/iv_schedule.json has no snapshots");
  return dates[dates.length - 1];
}

/** A post's line in the newest update of State's IV Scheduling Status Tool,
 * or null when that update does not list the post. */
export async function getIvSchedule(
  postSlug: string,
): Promise<IvSchedule | null> {
  const { snapshots } = await readIvScheduleData();
  const asOf = await getIvScheduleAsOf();
  const row = snapshots[asOf][postSlug];
  if (row === undefined) return null;
  return {
    asOf,
    relative: row.relative,
    preference: row.preference,
    employment: row.employment,
  };
}
