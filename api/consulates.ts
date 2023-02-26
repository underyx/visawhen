import { join } from "path";
import sqlite3 from "sqlite3";
import { open } from "sqlite";

const dataDir = join(process.cwd(), "data");

async function openDb() {
  return open({
    filename: join(dataDir, `consulates/consulates.sqlite`),
    driver: sqlite3.Database,
  });
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
