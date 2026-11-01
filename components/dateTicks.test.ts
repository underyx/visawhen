import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { dateTicks } from "./dateTicks";

/** A scale `width` pixels wide from `start` to `end` */
function scale(start: Date, end: Date, width: number) {
  return (date: Date) =>
    ((date.getTime() - start.getTime()) / (end.getTime() - start.getTime())) *
    width;
}

function labels(start: string, end: string, width: number): string[] {
  const from = new Date(start);
  const to = new Date(end);
  return dateTicks(from, to, scale(from, to, width)).map(({ label }) => label);
}

describe("dateTicks", () => {
  it("labels each year among the months on a wide chart", () => {
    assert.deepEqual(labels("2021-11-03", "2026-10-28", 800), [
      "2022",
      "Jul",
      "2023",
      "Jul",
      "2024",
      "Jul",
      "2025",
      "Jul",
      "2026",
      "Jul",
    ]);
  });

  it("labels only the years on a phone", () => {
    assert.deepEqual(labels("2021-11-03", "2026-10-28", 280), [
      "2022",
      "2023",
      "2024",
      "2025",
      "2026",
    ]);
  });

  it("skips years when even those do not fit", () => {
    assert.deepEqual(labels("2015-10-01", "2026-11-01", 250), [
      "2016",
      "2018",
      "2020",
      "2022",
      "2024",
      "2026",
    ]);
  });

  it("keeps the year's label over the last year", () => {
    assert.deepEqual(labels("2025-10-28", "2026-10-28", 280), [
      "Nov",
      "2026",
      "Mar",
      "May",
      "Jul",
      "Sep",
    ]);
  });

  it("gives the first label its year when no year starts in the chart", () => {
    assert.deepEqual(labels("2026-02-10", "2026-10-28", 600), [
      "Mar 2026",
      "Apr",
      "May",
      "Jun",
      "Jul",
      "Aug",
      "Sep",
      "Oct",
    ]);
  });

  it("puts each label where the scale says", () => {
    const from = new Date("2024-01-01");
    const to = new Date("2026-01-01");
    const ticks = dateTicks(from, to, scale(from, to, 100), 40);
    assert.deepEqual(ticks, [
      { x: 0, label: "2024" },
      { x: (366 / 731) * 100, label: "2025" },
      { x: 100, label: "2026" },
    ]);
  });
});
