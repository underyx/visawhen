import { join } from "path";
import { readFile } from "fs/promises";

const dataDir = join(process.cwd(), "data");

/** A cutoff: a date, "2007-08-22", or "C" (current) or "U" (unavailable) */
export type Cutoff = string;

/** One of a bulletin's charts: category ("F4") -> area ("philippines") ->
 * cutoff */
export type BulletinChart = Record<string, Record<string, Cutoff>>;

export interface Bulletin {
  url: string;
  finalAction: BulletinChart;
  datesForFiling: BulletinChart;
}

export interface VisaBulletinData {
  /** State's page listing the bulletins */
  source: string;
  /** Per month, "2026-10" */
  bulletins: Record<string, Bulletin>;
}

export async function getData(): Promise<VisaBulletinData> {
  const contents = await readFile(
    join(dataDir, "visa_bulletin", "data.json"),
    "utf-8",
  );
  return JSON.parse(contents);
}
