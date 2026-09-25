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

/** "IV" for immigrant visas, "NIV" for nonimmigrant ones */
export type VisaType = "IV" | "NIV";

export interface VisaClassRow {
  visaClass: string;
  visaClassSlug: string;
  visaType: VisaType;
  description: string | null;
}

export async function getVisaClass(
  visaClassSlug: string,
): Promise<VisaClassRow | undefined> {
  const db = await openDb();
  return await db.get<VisaClassRow>(
    `
      SELECT "Visa Class" AS visaClass, "Visa Class Slug" AS visaClassSlug, "Visa Type" AS visaType, "Description" AS description
      FROM visa_slugs WHERE "Visa Class Slug" = ?
    `,
    visaClassSlug,
  );
}

export async function getAllVisaClasses(): Promise<VisaClassRow[]> {
  const db = await openDb();
  return await db.all<VisaClassRow[]>(
    `
      SELECT "Visa Class" AS visaClass, "Visa Class Slug" AS visaClassSlug, "Visa Type" AS visaType, "Description" AS description
      FROM visa_slugs
    `,
  );
}

/** The months are stored as "2025-09-01 00:00:00", in UTC. */
function toIsoMonth(month: string): string {
  return month.replace(" ", "T") + ".000Z";
}

export interface RecentWindow {
  /** The oldest month in the data, "2017-03-01T00:00:00.000Z" */
  first: string;
  /** The first of the last 12 months in the data, "2025-03-01T00:00:00.000Z" */
  from: string;
  /** The newest month in the data, "2026-02-01T00:00:00.000Z" */
  to: string;
}

interface StoredRecentWindow {
  /** The oldest month in the data, as stored: "2017-03-01 00:00:00" */
  first: string;
  /** The first of the last 12 months in the data, as stored: "2025-03-01 00:00:00" */
  from: string;
  /** The newest month in the data, as stored: "2026-02-01 00:00:00" */
  to: string;
}

let recentWindowPromise: Promise<StoredRecentWindow> | undefined;

// The months in the data, and the last 12 of them, which are the same for
// every pair: each one has a (zero-filled) row for every month. "Month" has
// no index, so finding the newest one takes a full scan of the backlogs
// table, and every consulate page asks for it; do it once per process, like
// opening the connection.
function getStoredRecentWindow(): Promise<StoredRecentWindow> {
  if (recentWindowPromise === undefined) {
    recentWindowPromise = openDb().then(async (db) => {
      const row = await db.get<{
        first: string | null;
        from: string | null;
        to: string | null;
      }>(
        `SELECT MIN("Month") AS "first", datetime(MAX("Month"), '-11 months') AS "from", MAX("Month") AS "to" FROM backlogs`,
      );
      if (
        row === undefined ||
        row.first === null ||
        row.from === null ||
        row.to === null
      )
        throw new Error("The backlogs table is empty");
      return { first: row.first, from: row.from, to: row.to };
    });
  }
  return recentWindowPromise;
}

export async function getRecentWindow(): Promise<RecentWindow> {
  const { first, from, to } = await getStoredRecentWindow();
  return {
    first: toIsoMonth(first),
    from: toIsoMonth(from),
    to: toIsoMonth(to),
  };
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

export interface PostActivity {
  /** The newest month in which the post issued any visa, or null if it never
   * did: "2019-02-01T00:00:00.000Z" */
  lastIssued: string | null;
  /** The newest month in which it issued an immigrant visa, or null */
  lastImmigrantIssued: string | null;
}

let postActivityPromise: Promise<Map<string, PostActivity>> | undefined;

// Scans the whole backlogs table, so it is done once per process, like the
// recent window.
function getPostActivityBySlug(): Promise<Map<string, PostActivity>> {
  if (postActivityPromise === undefined) {
    postActivityPromise = openDb().then(async (db) => {
      const rows = await db.all<
        {
          postSlug: string;
          lastIssued: string;
          lastImmigrantIssued: string | null;
        }[]
      >(`
        SELECT
          b."Post Slug" AS postSlug,
          MAX(b."Month") AS lastIssued,
          MAX(CASE WHEN v."Visa Type" = 'IV' THEN b."Month" END) AS lastImmigrantIssued
        FROM backlogs b
        JOIN visa_slugs v ON v."Visa Class Slug" = b."Visa Class Slug"
        WHERE b."Issuances" > 0
        GROUP BY 1
      `);
      return new Map(
        rows.map(({ postSlug, lastIssued, lastImmigrantIssued }) => [
          postSlug,
          {
            lastIssued: toIsoMonth(lastIssued),
            lastImmigrantIssued:
              lastImmigrantIssued === null
                ? null
                : toIsoMonth(lastImmigrantIssued),
          },
        ]),
      );
    });
  }
  return postActivityPromise;
}

/** When a post last issued any visa, and any immigrant visa */
export async function getPostActivity(postSlug: string): Promise<PostActivity> {
  const activity = (await getPostActivityBySlug()).get(postSlug);
  return activity ?? { lastIssued: null, lastImmigrantIssued: null };
}

/** When each post last issued any visa, by post slug; posts that never did
 * are left out. */
export async function getLastIssuedByPost(): Promise<Record<string, string>> {
  const bySlug: Record<string, string> = {};
  for (const [postSlug, { lastIssued }] of await getPostActivityBySlug())
    if (lastIssued !== null) bySlug[postSlug] = lastIssued;
  return bySlug;
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
