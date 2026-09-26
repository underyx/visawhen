// Backtest the /nvc document review range (components/nvcReview.ts) against
// NVC's own timeframes, running the site's code itself:
//
//   yarn node data/nvc/backtest.mjs [YYYY-MM-DD ...]
//
// For each day with a reading at most 14 days old, documents are submitted
// that day and the range is worked out from the readings published up to
// it, starting no earlier than that day, as the page shows it. NVC reached
// them after the later of that day and the last reading whose front (as-of
// date minus days) was before it, and by the first reading whose front was
// on or after it. The check counts the days where those two readings are a
// week or so apart (9 days at most), and whether the middle of that stretch
// fell in the range. Dates given on the command line print the range for
// documents submitted that day, from the readings up to it.
import { readFileSync } from "node:fs";
import ts from "typescript";

const root = new URL("../../", import.meta.url);

/** A TypeScript file of the site as a module to import */
function load(path, replacements) {
  let source = ts.transpileModule(readFileSync(new URL(path, root), "utf-8"), {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  for (const [from, to] of replacements) {
    if (!source.includes(from)) throw new Error(`${path}: no ${from}`);
    source = source.replace(from, to);
  }
  return `data:text/javascript;base64,${Buffer.from(source).toString(
    "base64",
  )}`;
}

// Freshness's hook is not needed here, and React would be
const freshness = load("components/Freshness.tsx", [
  [
    'import { useSyncExternalStore } from "react";',
    "const useSyncExternalStore = () => null;",
  ],
]);
const { addDays, daysBetween } = await import(freshness);
const { reviewRange, front } = await import(
  load("components/nvcReview.ts", [['"./Freshness"', `"${freshness}"`]])
);

const all = Object.entries(
  JSON.parse(readFileSync(new URL("data/nvc/data.json", root), "utf-8")).review,
);
const MAX_AGE_DAYS = 14;

/** [after, by]: the readings between which NVC reached documents submitted on
 * a date, or null when it has not yet; after is null before the first */
function reached(submitted) {
  let previous = null;
  for (const reading of all) {
    if (front(reading) >= submitted) return [previous, reading[0]];
    previous = reading[0];
  }
  return null;
}

function seriesUntil(date) {
  return Object.fromEntries(all.filter(([day]) => day <= date));
}

const rows = [];
let withheld = 0;
for (
  let day = all[0][0];
  day <= all[all.length - 1][0];
  day = addDays(day, 1)
) {
  const series = seriesUntil(day);
  const readings = Object.entries(series);
  if (daysBetween(readings[readings.length - 1][0], day) > MAX_AGE_DAYS)
    continue;
  const truth = reached(day);
  if (truth === null || truth[0] === null) continue;
  const range = reviewRange(series, day);
  if (range === null) {
    withheld++;
    continue;
  }
  if (daysBetween(truth[0], truth[1]) > 9) continue;
  const lower = range.lower < day ? day : range.lower;
  const after = truth[0] < day ? day : truth[0];
  const middle = addDays(after, Math.round(daysBetween(after, truth[1]) / 2));
  rows.push({
    day,
    in: lower <= middle && middle <= range.upper,
    later: middle > range.upper,
    sooner: middle < lower,
    growing: range.growing,
    gap: range.gap !== null,
    width: daysBetween(lower, range.upper),
  });
}

function summary(name, subset) {
  if (subset.length === 0) return `${name}: none`;
  const share = (key) =>
    `${(
      (100 * subset.filter((row) => row[key]).length) /
      subset.length
    ).toFixed(1)}%`;
  const width = subset.reduce((sum, row) => sum + row.width, 0) / subset.length;
  return `${name}: ${subset.length} days, ${share("in")} in the range, ${share(
    "later",
  )} later, ${share("sooner")} sooner, ${width.toFixed(0)} days wide`;
}

console.log(`No estimate (stalled) on ${withheld} days`);
console.log(summary("All", rows));
console.log(
  summary(
    "Growing queue",
    rows.filter((row) => row.growing),
  ),
);
console.log(
  summary(
    "Other",
    rows.filter((row) => !row.growing),
  ),
);
console.log(
  summary(
    "After a gap",
    rows.filter((row) => row.gap),
  ),
);
console.log(
  summary(
    "After a gap, growing",
    rows.filter((row) => row.gap && row.growing),
  ),
);
for (let year = Number(all[0][0].slice(0, 4)); ; year++) {
  const subset = rows.filter((row) => row.day.startsWith(String(year)));
  if (subset.length === 0) break;
  console.log(summary(`  ${year}`, subset));
}
for (const day of process.argv.slice(2))
  console.log(day, JSON.stringify(reviewRange(seriesUntil(day), day)));
