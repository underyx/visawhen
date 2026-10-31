// Builds data/consulates/consulates.sqlite from its dump in
// data/consulates/dump/ (`bun run ensure-db`, before every build). The dump is
// what sqlite-diffable writes (data/consulates/baselines.py makes it): per table,
// <table>.metadata.json with its columns and schema, and <table>.ndjson
// (backlogs.ndjson.gz, gzipped) with one row per line as a JSON array.
import { Database } from "bun:sqlite";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";

const dir = join(import.meta.dir, "../data/consulates");
const TABLES = ["backlogs", "post_slugs", "visa_slugs"];

async function rows(table: string): Promise<unknown[][]> {
  const gzipped = Bun.file(join(dir, "dump", `${table}.ndjson.gz`));
  const text = (await gzipped.exists())
    ? gunzipSync(await gzipped.bytes()).toString("utf8")
    : await Bun.file(join(dir, "dump", `${table}.ndjson`)).text();
  return text
    .split("\n")
    .filter((line) => line !== "")
    .map((line) => JSON.parse(line) as unknown[]);
}

const path = join(dir, "consulates.sqlite");
rmSync(path, { force: true });
const db = new Database(path, { create: true });
for (const table of TABLES) {
  const { columns, schema } = (await Bun.file(
    join(dir, "dump", `${table}.metadata.json`),
  ).json()) as { columns: string[]; schema: string };
  db.run(schema);
  const insert = db.prepare(
    `INSERT INTO "${table}" VALUES (${columns.map(() => "?").join(", ")})`,
  );
  const all = await rows(table);
  db.transaction(() => {
    for (const row of all) insert.run(...(row as never[]));
  })();
  console.log(`${table}: ${all.length} rows`);
}
// The consulate pages look their rows up by post and visa class.
db.run(
  `CREATE INDEX backlogs_post_visa ON backlogs("Post Slug", "Visa Class Slug")`,
);
db.close();
