import { join } from "path";
import { readFile } from "fs/promises";

const dataDir = join(process.cwd(), "data");

export interface NvcSeries {
  [index: string]: number;
}

export interface NvcData {
  creation: NvcSeries;
  inquiry: NvcSeries;
  review: NvcSeries;
}

export async function getData(): Promise<NvcData> {
  const contents = await readFile(join(dataDir, "nvc", "data.json"), "utf-8");
  return JSON.parse(contents);
}
