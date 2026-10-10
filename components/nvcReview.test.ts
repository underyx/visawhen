import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { addDays } from "./dates";
import { front, getStall, type Reading, reviewRange } from "./nvcReview";

/** Weekly readings from a Monday, with the days of each */
function weekly(from: string, days: number[]): Record<string, number> {
  return Object.fromEntries(
    days.map((count, week): Reading => [addDays(from, 7 * week), count]),
  );
}

describe("front", () => {
  it("is the as-of date minus the days", () => {
    assert.equal(front(["2026-02-09", 30]), "2026-01-10");
  });
});

describe("getStall", () => {
  it("is null while the front moves", () => {
    assert.equal(getStall(weekly("2026-01-05", [30, 30, 30])), null);
  });

  it("finds the run of readings over which the front barely moved", () => {
    // the front stands at 2025-12-13 from the second reading on
    const series = weekly("2026-01-05", [30, 30, 37, 44, 51]);
    assert.deepEqual(getStall(series), {
      from: ["2026-01-12", 30],
      to: ["2026-02-02", 51],
    });
  });

  it("does not look back across a gap in the readings", () => {
    const series = {
      "2026-01-05": 30,
      // 28 days later: not a consecutive weekly update
      "2026-02-02": 58,
      "2026-02-09": 65,
    };
    assert.deepEqual(getStall(series), {
      from: ["2026-02-02", 58],
      to: ["2026-02-09", 65],
    });
  });
});

describe("reviewRange", () => {
  it("is null when the front has stalled", () => {
    assert.equal(
      reviewRange(weekly("2026-01-05", [30, 37, 44]), "2026-01-20"),
      null,
    );
  });

  it("estimates from the queue and NVC's pace, with a margin", () => {
    // six weekly readings of 30 days: the front moves a week a week
    const series = weekly("2026-01-05", [30, 30, 30, 30, 30, 30]);
    const range = reviewRange(series, "2026-01-20");
    assert.ok(range !== null);
    assert.deepEqual(range.latest, ["2026-02-09", 30]);
    assert.equal(range.queueDate, "2026-02-19");
    assert.deepEqual(range.pace, {
      from: ["2026-01-12", 30],
      date: "2026-02-19",
    });
    assert.equal(range.burstDays, null);
    // 40% of the 30-day wait on each side
    assert.equal(range.lower, "2026-02-07");
    assert.equal(range.upper, "2026-03-03");
    assert.equal(range.growing, false);
    assert.equal(range.gap, null);
  });

  it("uses a week as the margin for a short wait", () => {
    const series = weekly("2026-01-05", [10, 10, 10, 10, 10]);
    const range = reviewRange(series, "2026-02-01");
    assert.ok(range !== null);
    assert.equal(range.queueDate, "2026-02-11");
    assert.equal(range.lower, "2026-02-04");
    assert.equal(range.upper, "2026-02-18");
  });

  it("reaches later when the queue is growing", () => {
    // the days grow by 3 a week: the front moves only 4 days a week
    const series = weekly("2026-01-05", [30, 33, 36, 39, 42, 45]);
    const range = reviewRange(series, "2026-01-20");
    assert.ok(range !== null);
    assert.equal(range.growing, true);
    assert.equal(range.queueDate, "2026-03-06");
    assert.ok(range.pace !== null);
    assert.ok(range.pace.date > range.queueDate);
    assert.equal(range.upper > range.pace.date, true);
  });

  it("has no pace without a reading four weeks back", () => {
    const range = reviewRange(weekly("2026-01-05", [30, 30, 30]), "2026-01-20");
    assert.ok(range !== null);
    assert.equal(range.pace, null);
    assert.equal(range.growing, false);
  });

  it("reaches to the longest review time after a still week", () => {
    // the front stood still for a week, then jumped, and the days fell
    const series = {
      "2026-01-05": 30,
      "2026-01-12": 37,
      "2026-01-19": 20,
      "2026-01-26": 20,
      "2026-02-02": 20,
      "2026-02-09": 20,
    };
    const range = reviewRange(series, "2026-01-25");
    assert.ok(range !== null);
    assert.equal(range.queueDate, "2026-02-14");
    assert.equal(range.burstDays, 37);
    // 37 days after submission, plus a 40% margin of 15 days
    assert.equal(range.upper, "2026-03-18");
  });

  it("reports a gap in the readings it rests on", () => {
    const series = {
      "2025-12-01": 30,
      "2026-01-05": 65,
      "2026-01-12": 65,
      "2026-01-19": 65,
      "2026-01-26": 65,
      "2026-02-02": 65,
      "2026-02-09": 65,
    };
    const range = reviewRange(series, "2026-01-20");
    assert.ok(range !== null);
    assert.deepEqual(range.gap, ["2025-12-01", "2026-01-05"]);
  });
});
