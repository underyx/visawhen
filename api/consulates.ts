import { join } from "path";
import sqlite3 from "sqlite3";
import { open } from "sqlite";

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

export async function getVisaClass(
  visaClassSlug: string,
): Promise<VisaClassRow | undefined> {
  const db = await openDb();
  return await db.get<VisaClassRow>(
    `
      SELECT "Visa Class" AS visaClass, "Visa Class Slug" AS visaClassSlug, "Description" AS description
      FROM visa_slugs WHERE "Visa Class Slug" = ?
    `,
    visaClassSlug,
  );
}

export async function getAllVisaClasses(): Promise<VisaClassRow[]> {
  const db = await openDb();
  return await db.all<VisaClassRow[]>(
    `
      SELECT "Visa Class" AS visaClass, "Visa Class Slug" AS visaClassSlug, "Description" AS description
      FROM visa_slugs
    `,
  );
}
export interface BaselineRow {
  issuances: number;
}

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
export interface ConsulateBaselineRow extends BaselineRow {
  postSlug: string;
}
export async function getConsulateBaselines(): Promise<ConsulateBaselineRow[]> {
  const db = await openDb();
  return await db.all<ConsulateBaselineRow[]>(
    `
    SELECT "Post Slug" AS postSlug, sum("Issuances") AS issuances
    FROM baselines
    GROUP BY 1
  `,
  );
}
export interface VisaClassBaselineRow extends BaselineRow {
  visaClassSlug: string;
}

export async function getVisaClassBaselines(
  postSlug: string,
): Promise<VisaClassBaselineRow[]> {
  const db = await openDb();
  return await db.all<VisaClassBaselineRow[]>(
    `
    SELECT "Visa Class Slug" AS visaClassSlug, "Issuances" AS issuances
    FROM baselines
    WHERE "Post Slug" = ?
  `,
    postSlug,
  );
}

export interface BacklogRow {
  month: string;
  issuances: number;
  backlog: number | null;
  monthsAhead: number | null;
  expectedDelta: number | null;
}

export async function getBacklog(
  postSlug: string,
  visaClassSlug: string,
): Promise<BacklogRow[]> {
  const db = await openDb();
  const rows = await db.all<BacklogRow[]>(
    `
    SELECT "Month" AS month, "Issuances" AS issuances, "Backlog" AS backlog, "Months Ahead" AS monthsAhead, "Expected Delta" AS expectedDelta
    FROM backlogs
    WHERE "Post Slug" = ? AND "Visa Class Slug" = ?
    ORDER BY "Month"
  `,
    postSlug,
    visaClassSlug,
  );
  return rows.map((row) => ({
    ...row,
    month: row.month.replace(" ", "T") + ".000Z",
    backlog: row.backlog ?? null,
    monthsAhead: row.monthsAhead ?? null,
    expectedDelta: row.expectedDelta ?? null,
  }));
}
